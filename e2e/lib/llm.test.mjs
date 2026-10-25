import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  HARNESSES, TOOL_PROFILES, answerJson, callLlm, composeRunArgs, dockerRunArgs, isCliQuota, isInterrupt, isQuotaError, oneShotCommand, parseOneShot,
} from './llm.mjs';

const fixture = (name) => readFileSync(path.join(import.meta.dirname, 'fixtures', 'llm', `${name}.jsonl`), 'utf8');
const COMMON = ['claude', '-p', '--model', 'm', '--output-format', 'stream-json', '--verbose', '--setting-sources', 'user', '--strict-mcp-config'];
const PW_JSON = '{"mcpServers":{"playwright":{"command":"playwright-mcp","args":["--headless","--browser","chromium","--isolated"]}}}';
const CODEX = ['codex', 'exec', '--json', '--skip-git-repo-check', '--ephemeral', '-o', '/tmp/adw-last.txt'];
const CODEX_PW = ['-c', 'mcp_servers.playwright.command="playwright-mcp"', '-c', 'mcp_servers.playwright.args=["--headless","--browser","chromium","--isolated"]'];
const ocConfig = (cmd) => JSON.parse(cmd.env.OPENCODE_CONFIG_CONTENT);

test('the harnesses and tool profiles', () => {
  assert.deepEqual(HARNESSES, ['claude-code', 'codex', 'opencode']);
  assert.deepEqual(TOOL_PROFILES, ['none', 'read', 'verify']);
  assert.throws(() => oneShotCommand({ harness: 'gemini', tools: 'none' }), /unknown harness gemini/);
  assert.throws(() => oneShotCommand({ harness: 'codex', tools: 'all' }), /unknown tool profile all/);
});

test('claude-code one-shot argv per profile', () => {
  const cmd = (tools, o = {}) => oneShotCommand({ harness: 'claude-code', model: 'm', tools, ...o });
  assert.deepEqual(cmd('none'), { argv: [...COMMON, '--tools', ''], env: {} });
  assert.deepEqual(cmd('read').argv, [...COMMON, '--allowedTools', 'Read,Grep,Glob', '--disallowedTools', 'Bash,Edit,Write,NotebookEdit,Task,WebFetch,WebSearch']);
  assert.deepEqual(cmd('verify', { playwright: true }).argv, [...COMMON, '--mcp-config', PW_JSON,
    '--allowedTools', 'Bash,Read,Grep,Glob,mcp__playwright', '--disallowedTools', 'Edit,Write,NotebookEdit,Task,WebFetch,WebSearch']);
  assert.deepEqual(cmd('verify').argv, [...COMMON, '--allowedTools', 'Bash,Read,Grep,Glob', '--disallowedTools', 'Edit,Write,NotebookEdit,Task,WebFetch,WebSearch'],
    'no browser without playwright');
  assert.deepEqual(cmd('read', { addDirs: ['/diff'] }).argv.slice(COMMON.length, COMMON.length + 2), ['--add-dir', '/diff']);
  assert.ok(!oneShotCommand({ harness: 'claude-code', tools: 'none' }).argv.includes('--model'), 'null model: the CLI default');
});

test('codex one-shot argv per profile: the prompt is stdin', () => {
  const cmd = (tools, o = {}) => oneShotCommand({ harness: 'codex', model: 'm', tools, ...o });
  assert.deepEqual(cmd('none'), { argv: [...CODEX, '-m', 'm', '-s', 'read-only', '-'], env: {} });
  assert.deepEqual(cmd('read').argv, [...CODEX, '-m', 'm', '-s', 'read-only', '-']);
  assert.deepEqual(cmd('verify', { playwright: true }).argv, [...CODEX, '-m', 'm', '-s', 'danger-full-access', ...CODEX_PW, '-']);
  assert.deepEqual(oneShotCommand({ harness: 'codex', tools: 'verify' }).argv, [...CODEX, '-s', 'danger-full-access', '-']);
});

test('opencode one-shot argv and permission config per profile: the prompt is stdin', () => {
  const cmd = (tools, o = {}) => oneShotCommand({ harness: 'opencode', model: 'p/m', tools, ...o });
  const denyAll = { edit: 'deny', bash: 'deny', webfetch: 'deny' };
  assert.deepEqual(cmd('none').argv, ['opencode', 'run', '--format', 'json', '-m', 'p/m']);
  assert.deepEqual(ocConfig(cmd('none')), { permission: denyAll, mcp: {} });
  assert.deepEqual(ocConfig(cmd('read')), { permission: denyAll, mcp: {} });
  assert.deepEqual(ocConfig(cmd('verify', { playwright: true })), { permission: { edit: 'deny', bash: 'allow', webfetch: 'deny' },
    mcp: { playwright: { type: 'local', command: ['playwright-mcp', '--headless', '--browser', 'chromium', '--isolated'] } } });
  assert.deepEqual(ocConfig(cmd('read', { addDirs: ['/diff'] })).permission.external_directory, { '/diff/*': 'allow' },
    'opencode run auto-rejects reads outside the workspace');
  assert.deepEqual(oneShotCommand({ harness: 'opencode', tools: 'none' }).argv, ['opencode', 'run', '--format', 'json']);
});

test('parseOneShot reads the answer text of each recorded CLI', () => {
  for (const h of HARNESSES) assert.deepEqual(parseOneShot(h, fixture(`${h}-ok`)), { text: '{"ok":true}', error: null }, h);
});

test('parseOneShot: an opencode error followed by assistant text (a retry that succeeded) is no failure', () => {
  const lines = (...o) => o.map((x) => JSON.stringify(x)).join('\n');
  const part = (messageID, text) => ({ type: 'text', part: { type: 'text', messageID, text } });
  const err = { type: 'error', error: { name: 'APIError', data: { message: 'Rate limit exceeded.', statusCode: 429, isRetryable: true } } };
  assert.deepEqual(parseOneShot('opencode', lines(err, part('m2', '{"ok":true}'))), { text: '{"ok":true}', error: null });
  assert.deepEqual(parseOneShot('opencode', lines(part('m1', 'half'), err)), { text: null, error: 'APIError: Rate limit exceeded. (HTTP 429)' });
});

test('parseOneShot reports each CLI\'s quota error, and isCliQuota classifies it per harness', () => {
  for (const h of HARNESSES) {
    const { text, error } = parseOneShot(h, fixture(`${h}-quota`));
    assert.equal(text, null, h);
    assert.ok(isCliQuota(h, error), `${h}: ${error}`);
  }
  assert.equal(parseOneShot('opencode', fixture('opencode-quota')).error, 'APIError: Rate limit exceeded. Please try again later. (HTTP 429)');
});

test('parseOneShot: codex takes the last agent message and a failed turn; opencode the last assistant message', () => {
  const lines = (...o) => o.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n');
  const msg = (text) => ({ type: 'item.completed', item: { type: 'agent_message', text } });
  assert.deepEqual(parseOneShot('codex', lines(msg('first'), { type: 'item.completed', item: { type: 'command_execution' } }, msg('last'))), { text: 'last', error: null });
  assert.deepEqual(parseOneShot('codex', lines({ type: 'error', message: 'Reconnecting... 1/5' }, msg('ok'), { type: 'turn.completed' })), { text: 'ok', error: null },
    'a recovered stream error is no failure');
  assert.equal(parseOneShot('codex', lines(msg('half'), { type: 'turn.failed', error: { message: 'boom' } })).error, 'boom');
  const part = (messageID, text) => ({ type: 'text', part: { type: 'text', messageID, text } });
  assert.deepEqual(parseOneShot('opencode', lines('banner text', part('m1', 'thinking aloud'), part('m2', 'a'), part('m2', 'b'))), { text: 'a\nb', error: null });
  assert.deepEqual(parseOneShot('opencode', lines({ type: 'error', error: { name: 'UnknownError', data: { message: 'Unexpected server error.' } } })),
    { text: null, error: 'UnknownError: Unexpected server error.' });
  for (const h of HARNESSES) assert.deepEqual(parseOneShot(h, 'not json\n'), { text: null, error: null }, h);
});

test('isCliQuota knows each CLI\'s limit wording; claude-code keeps only usage_limit_reached', () => {
  for (const e of ['usageLimitExceeded', 'usage_limit', 'You\'ve hit your usage limit.', 'HTTP 429', 'rate limit', 'Rate-limit hit', 'insufficient_quota']) assert.ok(isCliQuota('codex', e), e);
  for (const e of ['APIError: x (HTTP 429)', 'Rate limit exceeded', 'insufficient_quota']) assert.ok(isCliQuota('opencode', e), e);
  assert.ok(isCliQuota('claude-code', 'usage_limit_reached: x'));
  for (const e of ['rate limit', 'HTTP 429', 'quota']) assert.equal(isCliQuota('claude-code', e), false, e);
  for (const h of HARNESSES) assert.equal(isCliQuota(h, null), false, h);
});

test('isQuotaError recognises a marked judge error and claude\'s usage_limit_reached, never answer text', () => {
  for (const e of ['verifier (codex): quota: You\'ve hit your usage limit', 'review (opencode): quota: exit 1: APIError', 'verifier exit 1: usage_limit_reached: limit']) {
    assert.ok(isQuotaError(e), e);
  }
  for (const e of [null, undefined, '', 'verifier (codex): exit 1: boom', 'review (claude-code): answer holds no JSON object',
    'verifier (claude-code): answer holds no JSON object; answer ends: "the API has a rate limit of 429 per quota"',
    'verifier (codex): answer holds no JSON object; answer ends: "x): quota: y"', fixture('claude-code-ok')]) assert.equal(isQuotaError(e), false, String(e));
});

test('answerJson extracts the fenced, whole or brace-span JSON object', () => {
  assert.deepEqual(answerJson('x\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(answerJson('{"a":2}'), { a: 2 });
  assert.deepEqual(answerJson('see {"a":3} here'), { a: 3 });
  assert.throws(() => answerJson(''), /answer was empty/);
});

const stubArgs = ({ name, checkout, readOnly, mounts, argv, env }) => ['run', name, readOnly ? `${checkout}:ro` : checkout, ...mounts, JSON.stringify(env), ...argv];
const base = { role: 'verifier', tools: 'verify', input: 'PROMPT', buildArgs: stubArgs, name: 'n', checkout: '/c', mounts: ['/d:/diff:ro'], timeoutMs: 5000 };

test('callLlm runs the container argv on docker with the prompt on stdin and returns the answer object', () => {
  let seen;
  const r = callLlm({ ...base, harness: 'codex', model: 'm', playwright: true, env: { A: '1' },
    run: (cmd, args, o) => { seen = { cmd, args, ...o }; return { status: 0, stdout: fixture('codex-ok') }; } });
  assert.deepEqual(r, { ok: true });
  assert.equal(seen.cmd, 'docker');
  assert.deepEqual(seen.args, ['run', 'n', '/c', '/d:/diff:ro', '{}', ...oneShotCommand({ harness: 'codex', model: 'm', tools: 'verify', playwright: true }).argv]);
  assert.deepEqual([seen.input, seen.timeout, seen.env.A], ['PROMPT', 5000, '1']);
  assert.ok(seen.env.PATH);
});

test('callLlm labels a missing JSON answer with role and harness, and keeps the transcript', () => {
  const seen = [];
  const stdout = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'I could not decide.' } });
  assert.throws(() => callLlm({ ...base, harness: 'codex', onStdout: (s) => seen.push(s), run: () => ({ status: 0, stdout }) }),
    (e) => e.message === 'verifier (codex): answer holds no JSON object; answer ends: "I could not decide."');
  assert.deepEqual(seen, [stdout]);
  assert.throws(() => callLlm({ ...base, harness: 'opencode', run: () => ({ status: 0, stdout: 'nothing' }) }), /^Error: verifier \(opencode\): no answer in the opencode output$/);
});

test('callLlm keeps the end of stderr: a container that never started reports its error after compose\'s progress lines', () => {
  const stderr = `${' Volume x_agent-home Creating\n'.repeat(50)}Error response from daemon: Bind for 127.0.0.1:8026 failed: port is already allocated\n`;
  assert.throws(() => callLlm({ ...base, harness: 'claude-code', run: () => ({ status: 1, stdout: '', stderr }) }),
    (e) => e.message.startsWith('verifier (claude-code): exit 1: ') && e.message.endsWith('port is already allocated'));
});

test('callLlm labels a non-zero exit with the CLI\'s own error event, and quota stays recognisable', () => {
  assert.throws(() => callLlm({ ...base, role: 'review', harness: 'opencode', run: () => ({ status: 1, stderr: 'warn', stdout: fixture('opencode-quota') }) }),
    (e) => /^review \(opencode\): quota: exit 1: APIError: Rate limit exceeded/.test(e.message) && e.message.endsWith(' | warn') && isQuotaError(e.message));
  assert.throws(() => callLlm({ ...base, harness: 'claude-code', run: () => ({ status: 1, stderr: 'agent runtime: warning', stdout: fixture('claude-code-quota') }) }),
    (e) => /^verifier \(claude-code\): quota: exit 1: usage_limit_reached: /.test(e.message) && isQuotaError(e.message));
  assert.throws(() => callLlm({ ...base, harness: 'codex', run: () => ({ status: 0, stdout: fixture('codex-quota') }) }),
    (e) => /^verifier \(codex\): quota: You've hit your usage limit/.test(e.message) && isQuotaError(e.message), 'an error event with exit 0 is still an error');
});

test('callLlm never classifies answer text or the raw claude stream as quota', () => {
  const claudeAnswer = (result) => `${JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } })}\n${JSON.stringify({ type: 'result', result })}`;
  assert.throws(() => callLlm({ ...base, harness: 'claude-code', run: () => ({ status: 0, stdout: claudeAnswer('The API enforces a rate limit (HTTP 429) per quota.') }) }),
    (e) => /answer holds no JSON object/.test(e.message) && !isQuotaError(e.message));
  assert.throws(() => callLlm({ ...base, harness: 'claude-code', run: () => ({ status: 1, stdout: fixture('claude-code-ok') }) }),
    (e) => /^verifier \(claude-code\): exit 1: /.test(e.message) && !isQuotaError(e.message), 'a normal stream with rate_limit_event is no quota');
  const codexAnswer = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'rate limit 429 quota' } });
  assert.throws(() => callLlm({ ...base, harness: 'codex', run: () => ({ status: 0, stdout: codexAnswer }) }), (e) => !isQuotaError(e.message));
  assert.throws(() => callLlm({ ...base, harness: 'codex', run: () => ({ status: 1, stdout: codexAnswer }) }), (e) => !isQuotaError(e.message),
    'the raw output of a failed call is no CLI error');
});

test('callLlm names a timeout and a spawn failure, and an interrupt is no verdict', () => {
  const timedOut = () => ({ status: null, error: Object.assign(new Error('spawnSync docker ETIMEDOUT'), { code: 'ETIMEDOUT' }) });
  assert.throws(() => callLlm({ ...base, harness: 'codex', timeoutMs: 900000, run: timedOut }), /^Error: verifier \(codex\): timed out after 900 s$/);
  assert.throws(() => callLlm({ ...base, harness: 'codex', run: () => ({ error: new Error('spawn docker ENOENT') }) }), /^Error: verifier \(codex\): spawn docker ENOENT$/);
  for (const [r, signal] of [[{ status: null, signal: 'SIGINT' }, 'SIGINT'], [{ status: 130 }, 'SIGINT'], [{ status: 143 }, 'SIGTERM']]) {
    assert.throws(() => callLlm({ ...base, harness: 'opencode', run: () => r }), (e) => isInterrupt(e) && e.signal === signal);
  }
});

const ARGV = ['codex', 'exec', '-'];

test('dockerRunArgs: a fresh task container, provider env and auth by name, auth files read-only', () => {
  const build = dockerRunArgs({ image: 'img', uid: 1000, gid: 1001, envNames: ['OPENAI_API_KEY'], authMounts: ['/h/auth.json:/home/dev/.codex/auth.json'] });
  const args = build({ name: 'n', checkout: '/c', mounts: ['/d:/diff:ro'], argv: ARGV, env: { OPENCODE_CONFIG_CONTENT: '{}' } });
  assert.deepEqual(args.slice(0, 5), ['run', '--rm', '-i', '--name', 'n']);
  for (const e of ['HOST_UID=1000', 'HOST_GID=1001', 'E2E_VERIFY=1', 'AGENT_TOOLSTACK_ONLY=1', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_FORCE_OAUTH', 'OPENAI_API_KEY',
    'OPENCODE_CONFIG_CONTENT={}']) assert.equal(args[args.indexOf(e) - 1], '-e', e);
  for (const v of ['/c:/workspace', '/d:/diff:ro', '/h/auth.json:/home/dev/.codex/auth.json:ro']) assert.equal(args[args.indexOf(v) - 1], '-v', v);
  assert.deepEqual(args.slice(-4), ['img', ...ARGV]);
  const ro = build({ name: 'n', checkout: '/c', readOnly: true, argv: ARGV });
  assert.equal(ro[ro.indexOf('/c:/workspace:ro') - 1], '-v', 'a read-only checkout');
  assert.ok(!ro.includes('/c:/workspace'));
});

test('composeRunArgs: the project\'s compose service, last before the argv; env by name only; auth files read-only', () => {
  const build = composeRunArgs({ composeFile: '/p/compose.ai-dev.yml', certsFile: '/p/compose.ai-dev.certs.yml', project: 'adw-e2e-1', uid: 1, gid: 2,
    envNames: ['OPENAI_API_KEY'], authMounts: ['/h/auth.json:/home/dev/.local/share/opencode/auth.json'] });
  const args = build({ name: 'n', checkout: '/c', mounts: [], argv: ARGV, env: {} });
  assert.deepEqual(args.slice(0, 7), ['compose', '-f', '/p/compose.ai-dev.yml', '-f', '/p/compose.ai-dev.certs.yml', '-p', 'adw-e2e-1']);
  assert.deepEqual(args.slice(7, 12), ['run', '--rm', '-T', '--name', 'n']);
  assert.deepEqual(args.slice(-4), ['ai-dev-workflow', ...ARGV]);
  assert.equal(args[args.indexOf('OPENAI_API_KEY') - 1], '-e');
  assert.ok(!args.slice(0, -ARGV.length).some((a) => /^(OPENAI_API_KEY|CLAUDE_CODE_OAUTH_TOKEN)=/.test(a)), 'no provider value on argv');
  for (const e of ['HOST_UID=1', 'HOST_GID=2', 'E2E_VERIFY=1', 'AGENT_TOOLSTACK_ONLY=1']) assert.equal(args[args.indexOf(e) - 1], '-e', e);
  assert.equal(args[args.indexOf('/c:/workspace') - 1], '-v');
  assert.equal(args[args.indexOf('/h/auth.json:/home/dev/.local/share/opencode/auth.json:ro') - 1], '-v');
  const plain = composeRunArgs({ composeFile: 'c.yml', project: 'p', service: 'app', uid: 1, gid: 1 })({ name: 'n', checkout: '/c', mounts: [], argv: ARGV, env: {} });
  assert.deepEqual(plain.slice(0, 5), ['compose', '-f', 'c.yml', '-p', 'p']);
  assert.equal(plain.at(-ARGV.length - 1), 'app');
  const ro = build({ name: 'n', checkout: '/c', readOnly: true, argv: ARGV });
  assert.equal(ro[ro.indexOf('/c:/workspace:ro') - 1], '-v', 'a read-only checkout');
});

test('composeRunArgs: an override file comes last among the compose files', () => {
  const args = composeRunArgs({ composeFile: 'c.yml', certsFile: 'certs.yml', overrideFile: '/run/o.yml', project: 'p', uid: 1, gid: 1 })(
    { name: 'n', checkout: '/c', argv: ARGV });
  assert.deepEqual(args.slice(0, 9), ['compose', '-f', 'c.yml', '-f', 'certs.yml', '-f', '/run/o.yml', '-p', 'p']);
});
