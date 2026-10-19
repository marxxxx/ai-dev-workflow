import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ACP_VERSIONS } from '../lib/fingerprint.mjs';
import { scanForSecrets } from '../lib/secrets.mjs';
import { acpCommand, acpxConfig, composeEnv, composeProject, listening, parseEnvFile, stageCredentials, startSession } from './session.mjs';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'adw-session-'));

test('acpCommand per harness, with and without a model or the image CLI', () => {
  assert.deepEqual(acpCommand('claude-code', null), ['env', '-u', 'CLAUDECODE', 'claude-code-acp']);
  assert.deepEqual(acpCommand('claude-code', 'opus', { cli: '/usr/local/bin/claude' }),
    ['env', '-u', 'CLAUDECODE', 'ANTHROPIC_MODEL=opus', 'CLAUDE_CODE_EXECUTABLE=/usr/local/bin/claude', 'claude-code-acp']);
  assert.deepEqual(acpCommand('codex', null), ['env', 'NO_BROWSER=1', 'INITIAL_AGENT_MODE=agent-full-access', 'codex-acp']);
  assert.deepEqual(acpCommand('codex', 'openai/gpt-5', { cli: '/usr/local/bin/codex' }),
    ['env', 'NO_BROWSER=1', 'INITIAL_AGENT_MODE=agent-full-access', 'CODEX_CONFIG={"model":"gpt-5"}', 'CODEX_PATH=/usr/local/bin/codex', 'codex-acp']);
  assert.deepEqual(acpCommand('opencode', null), ['env', 'OPENCODE_FAKE_VCS=git', 'opencode', 'acp']);
  assert.deepEqual(acpCommand('opencode', 'anthropic/x'), ['env', 'OPENCODE_FAKE_VCS=git', 'OPENCODE_CONFIG=/home/dev/.adw-e2e/opencode.json', 'opencode', 'acp']);
  assert.throws(() => acpCommand('gemini', null), /unknown harness/);
});

test('the product image pins acpx and the adapters at ACP_VERSIONS', () => {
  const { npmPackages } = JSON.parse(readFileSync(new URL('../../docker/tools/inventory.json', import.meta.url), 'utf8'));
  assert.equal(npmPackages.acpx, ACP_VERSIONS.acpx);
  assert.equal(npmPackages['@zed-industries/claude-code-acp'], ACP_VERSIONS.claudeCodeAcp);
  assert.equal(npmPackages['@agentclientprotocol/codex-acp'], ACP_VERSIONS.codexAcp);
});

test('acpxConfig shape', () => {
  assert.deepEqual(acpxConfig(['env', 'NO_BROWSER=1', 'codex-acp'], 900), {
    agents: { target: { command: 'env', args: ['NO_BROWSER=1', 'codex-acp'] } },
    defaultAgent: 'target', defaultPermissions: 'approve-all', ttl: 0, timeout: 900, format: 'quiet',
  });
  assert.equal(acpxConfig(['x']).timeout, 1800);
});

test('composeProject sanitizes and stays within 63 chars', () => {
  assert.equal(composeProject('/src/My Repo', 't1'), 'adw-e2e-my-repo-t1');
  assert.equal(composeProject('/src/repo', '2026-10-16T0742Z-1'), 'adw-e2e-repo-2026-10-16t0742z-1');
  const long = composeProject(`/src/${'A'.repeat(100)}`, 'abc');
  assert.ok(long.length <= 63);
  assert.match(long, /^adw-e2e-a+-abc$/);
});

test('parseEnvFile mirrors ai-dev.sh', () => {
  const text = '# c\r\n\nexport A=1\nB="two"\nC=\'3\'\n9X=no\nbad line\nD-E=no\nE=a=b\r\n';
  assert.deepEqual(parseEnvFile(text), { A: '1', B: 'two', C: '3', E: 'a=b' });
});

test('composeEnv reads .env.ai-dev without overriding set vars, then sets PROJECT_ROOT and ids', () => {
  const root = tmp();
  try {
    writeFileSync(path.join(root, '.env.ai-dev'), 'AGENT_CA_DIR=/ca\nHTTP_PROXY=file\nPROJECT_ROOT=/nope\n');
    const env = composeEnv({ root, work: '/w', env: { HTTP_PROXY: '' }, uid: 11, gid: 12 });
    assert.equal(env.AGENT_CA_DIR, '/ca');
    assert.equal(env.HTTP_PROXY, '');
    assert.equal(env.PROJECT_ROOT, '/w');
    assert.equal(env.HOST_UID, '11');
    assert.equal(env.HOST_GID, '12');
    assert.equal(composeEnv({ root, work: '/w', env: { HOST_UID: '5' }, uid: 11, gid: 12 }).HOST_UID, '5');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('stageCredentials is a pure lookup per harness', () => {
  const home = tmp();
  try {
    let c = stageCredentials({ harnesses: ['claude-code', 'codex', 'opencode'], env: {}, home });
    assert.deepEqual(c.missing.map((m) => m.harness), ['claude-code', 'codex']);
    assert.match(c.missing[1].what, /~\/\.codex\/auth\.json or OPENAI_API_KEY/);

    mkdirSync(path.join(home, '.codex'));
    writeFileSync(path.join(home, '.codex/auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'AT1', account_id: 'acc' } }));
    mkdirSync(path.join(home, '.local/share/opencode'), { recursive: true });
    writeFileSync(path.join(home, '.local/share/opencode/auth.json'), JSON.stringify({ anthropic: { type: 'oauth', refresh: 'RT2' } }));
    c = stageCredentials({ harnesses: ['claude-code', 'codex', 'opencode', 'codex'], env: { CLAUDE_CODE_OAUTH_TOKEN: 'TOK' }, home });
    assert.deepEqual(c.missing, []);
    assert.deepEqual(c.envNames, ['CLAUDE_CODE_OAUTH_TOKEN']);
    assert.deepEqual(c.authFiles, [
      { harness: 'codex', from: path.join(home, '.codex/auth.json'), to: '/home/dev/.codex/auth.json' },
      { harness: 'opencode', from: path.join(home, '.local/share/opencode/auth.json'), to: '/home/dev/.local/share/opencode/auth.json' },
    ]);
    assert.deepEqual(c.secrets.sort(), ['AT1', 'RT2', 'TOK']);

    c = stageCredentials({ harnesses: ['claude-code', 'codex'], env: { CLAUDE_CODE_USE_BEDROCK: '1', OPENAI_API_KEY: 'sk' }, home: tmp() });
    assert.deepEqual(c.missing, []);
    assert.deepEqual(c.envNames, ['CLAUDE_CODE_USE_BEDROCK', 'OPENAI_API_KEY']);
    assert.deepEqual(c.secrets, ['sk']);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// Records every call; `fail` maps a predicate over the argv to a thrown error or a failing result.
function recorder({ throwOn, results = () => null } = {}) {
  const calls = [];
  const exec = (cmd, args, opts = {}) => {
    calls.push({ cmd, args, opts });
    if (throwOn?.(args)) throw new Error('boom');
    return results(args) ?? { status: 0, stdout: '', stderr: '' };
  };
  return { calls, exec };
}

function fixture() {
  const dir = tmp();
  const root = path.join(dir, 'root');
  const work = path.join(dir, 'work');
  mkdirSync(root);
  mkdirSync(work);
  const authFile = path.join(dir, 'codex-auth.json');
  writeFileSync(authFile, '{"tokens":{"access_token":"AT1"}}');
  const creds = {
    envNames: ['CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY'],
    authFiles: [{ harness: 'codex', from: authFile, to: '/home/dev/.codex/auth.json' }, { harness: 'opencode', from: authFile, to: '/x' }],
    secrets: ['AT1'],
    missing: [],
  };
  return { dir, root, work, creds };
}

test('startSession starts the compose run container, stages auth by stdin and ensures the acpx session', () => {
  const { dir, root, work, creds } = fixture();
  try {
    const { calls, exec } = recorder({ results: (a) => (a.includes('command -v codex') ? { status: 0, stdout: '/usr/local/bin/codex\n' } : null) });
    startSession({ root, work, harness: 'codex', model: 'gpt-5', project: 'p1', creds, envNames: ['AZURE_X'], exec, env: { AGENT_CA_DIR: '/ca' }, turnTimeoutSec: 60 });
    const compose = ['compose', '-f', path.join(root, 'compose.ai-dev.yml'), '-f', path.join(root, 'compose.ai-dev.certs.yml'), '-p', 'p1'];
    assert.deepEqual(calls[0].args, [...compose, 'run', '-d', '--name', 'p1-agent', '-e', 'OPENAI_API_KEY', '-e', 'AZURE_X', 'ai-dev-workflow', 'sleep', 'infinity']);
    assert.equal(calls[0].opts.env.PROJECT_ROOT, work);
    assert.deepEqual(calls[1].args.slice(0, 4), ['exec', '-u', 'dev', 'p1-agent']);
    // Only the codex auth file, by stdin, never on argv.
    const staged = calls.filter((c) => c.opts.input !== undefined);
    assert.equal(staged.length, 1);
    assert.deepEqual(staged[0].args.slice(0, 5), ['exec', '-i', '-u', 'dev', 'p1-agent']);
    assert.equal(staged[0].args.at(-1), '/home/dev/.codex/auth.json');
    assert.ok(!staged[0].args.join(' ').includes('AT1'));
    assert.deepEqual(calls.at(-1).args, ['exec', '-u', 'dev', '-w', '/workspace', 'p1-agent', 'acpx', 'sessions', 'ensure']);
    const rc = JSON.parse(readFileSync(path.join(work, '.acpxrc.json'), 'utf8'));
    assert.deepEqual(calls.find((c) => c.args.includes('command -v codex')).args, ['exec', '-u', 'dev', 'p1-agent', 'sh', '-c', 'command -v codex']);
    assert.deepEqual(rc.agents.target, { command: 'env',
      args: ['NO_BROWSER=1', 'INITIAL_AGENT_MODE=agent-full-access', 'CODEX_CONFIG={"model":"gpt-5"}', 'CODEX_PATH=/usr/local/bin/codex', 'codex-acp'] });
    assert.equal(rc.timeout, 60);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('claude-code: the model is merged into settings.json, the image claude is the executable', () => {
  const { dir, root, work, creds } = fixture();
  try {
    const { calls, exec } = recorder({ results: (a) => (a.includes('command -v claude') ? { status: 0, stdout: '/usr/local/bin/claude\n' }
      : a.at(-1) === '/home/dev/.claude/settings.json' && a.includes('sh') && !a.includes('-i') ? { status: 0, stdout: '{"theme":"dark","model":"old"}' } : null) });
    startSession({ root, work, harness: 'claude-code', model: 'opus', project: 'p1', creds, exec, env: {} });
    const write = calls.find((c) => c.opts.input !== undefined && c.args.at(-1) === '/home/dev/.claude/settings.json');
    assert.deepEqual(JSON.parse(write.opts.input), { theme: 'dark', model: 'opus' });
    const rc = JSON.parse(readFileSync(path.join(work, '.acpxrc.json'), 'utf8'));
    assert.deepEqual(rc.agents.target.args, ['-u', 'CLAUDECODE', 'ANTHROPIC_MODEL=opus', 'CLAUDE_CODE_EXECUTABLE=/usr/local/bin/claude', 'claude-code-acp']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('opencode: the model goes into an OPENCODE_CONFIG file; nothing written without a model', () => {
  const { dir, root, work, creds } = fixture();
  try {
    let r = recorder();
    startSession({ root, work, harness: 'opencode', model: 'anthropic/x', project: 'p1', creds: { ...creds, authFiles: [] }, exec: r.exec, env: {} });
    const write = r.calls.find((c) => c.opts.input !== undefined);
    assert.equal(write.args.at(-1), '/home/dev/.adw-e2e/opencode.json');
    assert.deepEqual(JSON.parse(write.opts.input), { model: 'anthropic/x' });
    assert.ok(!r.calls.some((c) => c.args.some((a) => String(a).startsWith('command -v'))));
    r = recorder();
    startSession({ root, work, harness: 'claude-code', model: null, project: 'p1', creds, exec: r.exec, env: {} });
    assert.ok(!r.calls.some((c) => c.opts.input !== undefined || c.args.includes('/home/dev/.claude/settings.json')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('startSession forwards the claude token by name and tears down when ensure fails', () => {
  const { dir, root, work, creds } = fixture();
  try {
    const { calls, exec } = recorder({ results: (a) => (a.includes('ensure') ? { status: 1, stdout: '', stderr: 'nope' } : null) });
    assert.throws(() => startSession({ root, work, harness: 'claude-code', model: null, project: 'p1', creds, exec, env: {} }), /nope/);
    assert.ok(calls[0].args.includes('CLAUDE_CODE_OAUTH_TOKEN'));
    assert.ok(!calls[0].args.includes('OPENAI_API_KEY'));
    assert.equal(calls[0].args.filter((a) => a === '-f').length, 1, 'no certs overlay without AGENT_CA_DIR');
    assert.deepEqual(calls.at(-1).args.slice(-2), ['down', '-v']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('startSession fails fast with the logs when the container stops, and tears down', () => {
  const { dir, root, work, creds } = fixture();
  try {
    const { calls, exec } = recorder({ results: (a) => (a.includes('-c') && a[0] === 'exec' ? { status: 1, stdout: '', stderr: 'container abc is not running' }
      : a[0] === 'logs' ? { status: 0, stdout: 'agent runtime: bad workspace\n', stderr: '' } : null) });
    assert.throws(() => startSession({ root, work, harness: 'codex', model: null, project: 'p1', creds, exec, env: {} }), /not running \| agent runtime: bad workspace/);
    assert.deepEqual(calls.at(-1).args.slice(-2), ['down', '-v']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('prompt returns stdout and rejects on timeout or failure, quota labelled', async () => {
  const { dir, root, work, creds } = fixture();
  try {
    let next = { status: 0, stdout: 'Fertig.\n', stderr: '' };
    const { calls, exec } = recorder({ results: (a) => (a.includes('prompt') ? next : null) });
    const s = startSession({ root, work, harness: 'codex', model: null, project: 'p1', creds, exec, env: {}, turnTimeoutSec: 60 });
    assert.equal(await s.prompt('Hallo'), 'Fertig.');
    assert.deepEqual(calls.at(-1).args, ['exec', '-i', '-u', 'dev', '-w', '/workspace', 'p1-agent', 'acpx', 'prompt', 'Hallo']);
    assert.ok(calls.at(-1).opts.timeout > 60_000);
    next = { status: null, error: Object.assign(new Error('t'), { code: 'ETIMEDOUT' }) };
    await assert.rejects(s.prompt('x'), /timed out/);
    next = { status: 1, stdout: '', stderr: 'You hit your usage limit' };
    await assert.rejects(s.prompt('x'), /^Error: agent \(codex\): quota: /);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('close copies the harness logs, removes auth copies, scrubs secrets, and always runs down -v', () => {
  const { dir, root, work, creds } = fixture();
  try {
    const trialDir = path.join(dir, 'trial');
    // docker cp stands in: writes a session log with a secret plus an auth.json copy.
    const { calls, exec } = recorder({ results: (a) => {
      if (a[0] !== 'cp') return null;
      const dest = a[2];
      mkdirSync(dest, { recursive: true });
      writeFileSync(path.join(dest, 'auth.json'), '{"x":"AT1"}');
      writeFileSync(path.join(dest, 'rollout-1.jsonl'), '{"token":"AT1"}\n');
      return null;
    } });
    const s = startSession({ root, work, harness: 'opencode', model: null, project: 'p1', creds, exec, env: {} });
    s.close(trialDir);
    const cp = calls.find((c) => c.args[0] === 'cp');
    assert.deepEqual(cp.args, ['cp', 'p1-agent:/home/dev/.local/share/opencode/.', path.join(trialDir, 'agent/opencode/xdg-data/opencode')]);
    assert.ok(!existsSync(path.join(trialDir, 'agent/opencode/xdg-data/opencode/auth.json')));
    assert.deepEqual(scanForSecrets(path.join(trialDir, 'agent'), creds.secrets), []);
    assert.deepEqual(calls.at(-1).args.slice(-2), ['down', '-v']);
    const closeIdx = calls.findIndex((c) => c.args.includes('close'));
    assert.ok(closeIdx >= 0 && closeIdx < calls.indexOf(cp));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('close maps claude-code and codex logs into the metrics layout', () => {
  for (const [harness, src, dest] of [
    ['claude-code', '/home/dev/.claude/projects/.', 'agent/sessions/projects'],
    ['codex', '/home/dev/.codex/sessions/.', 'agent/sessions'],
  ]) {
    const { dir, root, work, creds } = fixture();
    try {
      const { calls, exec } = recorder();
      startSession({ root, work, harness, model: null, project: 'p1', creds, exec, env: {} }).close(path.join(dir, 't'));
      assert.deepEqual(calls.find((c) => c.args[0] === 'cp').args, ['cp', `p1-agent:${src}`, path.join(dir, 't', dest)]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('close skips a missing log dir and runs down -v after a throwing cp', () => {
  const { dir, root, work, creds } = fixture();
  try {
    let r = recorder({ results: (a) => (a.includes('test') ? { status: 1, stdout: '', stderr: '' } : null) });
    startSession({ root, work, harness: 'codex', model: null, project: 'p1', creds, exec: r.exec, env: {} }).close(path.join(dir, 't'));
    assert.ok(!r.calls.some((c) => c.args[0] === 'cp'));

    // A partial copy leaves an auth copy and a secret behind before cp fails: both must go.
    const t2 = path.join(dir, 't2');
    r = recorder({ throwOn: (a) => {
      if (a[0] !== 'cp') return false;
      mkdirSync(a[2], { recursive: true });
      writeFileSync(path.join(a[2], 'auth.json'), '{"x":"AT1"}');
      writeFileSync(path.join(a[2], 'rollout-1.jsonl'), '{"token":"AT1"}\n');
      return true;
    } });
    const s = startSession({ root, work, harness: 'codex', model: null, project: 'p1', creds, exec: r.exec, env: {} });
    assert.throws(() => s.close(t2), /boom/);
    assert.ok(!existsSync(path.join(t2, 'agent/sessions/auth.json')));
    assert.deepEqual(scanForSecrets(path.join(t2, 'agent'), creds.secrets), []);
    assert.deepEqual(r.calls.at(-1).args.slice(-2), ['down', '-v']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('listening parses /proc/net/tcp LISTEN sockets', () => {
  const tcp = [
    '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
    '   0: 00000000:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 1',
    '   1: 0100007F:1F90 0100007F:9C40 01 00000000:00000000 00:00000000 00000000  1000        0 2',
  ].join('\n');
  assert.equal(listening(tcp, 3000), 1);
  assert.equal(listening(tcp, 8080), 0);
});

test('appListening and cliVersion exec in the agent container', () => {
  const { dir, root, work, creds } = fixture();
  try {
    const { calls, exec } = recorder({ results: (a) => (a.includes('--version') ? { status: 0, stdout: 'codex-cli 1.0\n' } : a.some((x) => x.includes('/proc/net/tcp')) ? { status: 0, stdout: '0: 00000000:0BB8 00000000:0000 0A x' } : null) });
    const s = startSession({ root, work, harness: 'codex', model: null, project: 'p1', creds, exec, env: {} });
    assert.equal(s.appListening(3000), 1);
    assert.equal(s.cliVersion('codex'), 'codex-cli 1.0');
    assert.deepEqual(calls.at(-1).args, ['exec', '-u', 'dev', 'p1-agent', '/opt/agent-tools/node_modules/.bin/codex', '--version']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
