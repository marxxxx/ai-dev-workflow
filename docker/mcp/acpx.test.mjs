import assert from 'node:assert/strict';
import test from 'node:test';
import { acpxArgs, acpxFor, acpxSettings, defaultExec, joinCommand } from './acpx.mjs';

const ID = '11111111-1111-4111-8111-111111111111';
const prefix = (agent) => ['acpx', '--agent', agent, '--approve-all', '--format', 'quiet', '--ttl', '0', '--timeout', '1800', '--cwd', '/workspace'];

test('acpxArgs share one global-flag prefix and differ only in the subcommand', () => {
  const agent = 'env claude-agent-acp';
  const args = acpxArgs({ agent, cwd: '/workspace', timeoutSec: 1800 });
  assert.deepEqual(args.ensure(ID), [...prefix(agent), 'sessions', 'ensure', '-s', ID]);
  assert.deepEqual(args.prompt(ID), [...prefix(agent), 'prompt', '-s', ID, '-f', '-']);
  assert.deepEqual(args.cancel(ID), [...prefix(agent), 'cancel', '-s', ID]);
  assert.deepEqual(args.close(ID), [...prefix(agent), 'sessions', 'close', ID]);
});

test('acpxArgs takes the timeout as a string and defaults it to 14400 (4 h)', () => {
  assert.deepEqual(acpxArgs({ agent: 'a', cwd: '/w', timeoutSec: 60 }).cancel(ID).slice(8, 10), ['--timeout', '60']);
  assert.deepEqual(acpxArgs({ agent: 'a', cwd: '/w' }).cancel(ID).slice(8, 10), ['--timeout', '14400']);
});

test('acpxSettings reads the turn timeout from ADW_MCP_TURN_TIMEOUT_SEC, and every call of a session uses it', () => {
  assert.equal(acpxSettings({}).timeoutSec, 14400);
  assert.equal(acpxSettings({ ADW_MCP_TURN_TIMEOUT_SEC: '' }).timeoutSec, 14400);
  const settings = acpxSettings({ ADW_MCP_TURN_TIMEOUT_SEC: '7200' });
  assert.equal(settings.timeoutSec, 7200);
  const args = acpxFor('opencode', settings, '');
  for (const argv of [args.ensure(ID), args.prompt(ID), args.cancel(ID), args.close(ID)]) {
    assert.deepEqual(argv.slice(8, 10), ['--timeout', '7200']);
  }
  assert.throws(() => acpxSettings({ ADW_MCP_TURN_TIMEOUT_SEC: '30' }), { message: 'ADW_MCP_TURN_TIMEOUT_SEC must be an integer from 60 to 86400' });
});

test('the prompt text never enters argv (it goes in on stdin)', () => {
  const text = '--help; $(x)\nnext';
  const argv = acpxArgs({ agent: 'a', cwd: '/w' }).prompt(ID, text);
  assert.ok(!argv.some((part) => part.includes('--help') || part.includes('next')));
});

// The splitter of acpx 0.22.0 for --agent (agent-registry splitCommandLine), reduced to what joinCommand must survive.
function split(value) {
  const parts = [];
  let current = '';
  let quote = null;
  let escaping = false;
  let has = false;
  for (const ch of value) {
    if (escaping) { current += ch; escaping = false; has = true; }
    else if (ch === '\\' && quote !== "'") escaping = true;
    else if (quote) { if (ch === quote) quote = null; else current += ch; has = true; }
    else if (ch === "'" || ch === '"') { quote = ch; has = true; }
    else if (/\s/.test(ch)) { if (has) { parts.push(current); current = ''; has = false; } }
    else { current += ch; has = true; }
  }
  if (has) parts.push(current);
  return parts;
}

test('joinCommand survives acpx --agent parsing for values with spaces, quotes, backslashes and newlines', () => {
  const argv = ['env', 'CODEX_CONFIG={"model":"a b","x":"it\'s \\"q\\" \\\\"}', 'NO_BROWSER=1', '', 'a\nb', '$(x) `y`; z', 'codex-acp'];
  assert.deepEqual(split(joinCommand(argv)), argv);
});

test('joinCommand leaves plain words unquoted', () => {
  assert.equal(joinCommand(['env', '-u', 'CLAUDECODE', 'CLAUDE_CODE_EXECUTABLE=/usr/local/bin/claude', 'claude-agent-acp']),
    'env -u CLAUDECODE CLAUDE_CODE_EXECUTABLE=/usr/local/bin/claude claude-agent-acp');
});

test('defaultExec returns status, output and writes stdin without a shell', async () => {
  const code = 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.stdout.write("got:"+s);process.stderr.write("err");process.exit(3)})';
  const r = await defaultExec(['node', '-e', code], { input: '$(echo hi)\n' });
  assert.equal(r.status, 3);
  assert.equal(r.stdout.toString('utf8'), 'got:$(echo hi)\n');
  assert.equal(r.stderr.toString('utf8'), 'err');
});

test('defaultExec reports a missing command and a timeout as an error', async () => {
  const missing = await defaultExec(['adw-no-such-command-xyz']);
  assert.equal(missing.error?.code, 'ENOENT');
  const slow = await defaultExec(['node', '-e', 'setTimeout(()=>{}, 30000)'], { timeoutMs: 200 });
  assert.equal(slow.error?.code, 'ETIMEDOUT');
});
