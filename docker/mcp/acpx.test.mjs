import assert from 'node:assert/strict';
import test from 'node:test';
import { acpxArgs, defaultExec, joinCommand } from './acpx.mjs';

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

test('acpxArgs takes the timeout as a string and defaults it to 1800', () => {
  assert.deepEqual(acpxArgs({ agent: 'a', cwd: '/w', timeoutSec: 60 }).cancel(ID).slice(8, 10), ['--timeout', '60']);
  assert.deepEqual(acpxArgs({ agent: 'a', cwd: '/w' }).cancel(ID).slice(8, 10), ['--timeout', '1800']);
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
