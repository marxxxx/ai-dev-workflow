import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAKED_CLIS, FAKE_PR_URL, fakeCli, parsePrCreate } from './image/pr-cli.mjs';

const SCRIPT = fileURLToPath(new URL('./image/pr-cli.mjs', import.meta.url));
const INCLUDES = fileURLToPath(new URL('../../agent-src/includes/', import.meta.url));

test('parsePrCreate reads draft, title, base and head of each faked CLI, and null for anything else', () => {
  assert.deepEqual(parsePrCreate('gh', ['pr', 'create', '--draft', '--base', 'main', '--head', '7_x', '--title', '7: X', '--body-file', 'b']),
    { draft: true, title: '7: X', base: 'main', head: '7_x' });
  assert.deepEqual(parsePrCreate('gh', ['pr', 'create', '-t', '7: X', '-B', 'main']), { draft: false, title: '7: X', base: 'main', head: null });
  assert.deepEqual(parsePrCreate('gh', ['pr', 'create', '--title=7: X', '-d']), { draft: true, title: '7: X', base: null, head: null });
  assert.deepEqual(parsePrCreate('tea', ['pulls', 'create', '--login', 'l', '--base', 'main', '--head', '7_x', '--title', 'WIP: 7: X', '--description', 'd']),
    { draft: true, title: '7: X', base: 'main', head: '7_x' });
  assert.deepEqual(parsePrCreate('tea', ['pr', 'c', '-t', '7: X']), { draft: false, title: '7: X', base: null, head: null });
  assert.deepEqual(parsePrCreate('az', ['repos', 'pr', 'create', '--target-branch', 'main', '--source-branch', '7_x', '--draft', 'true', '--title', '7: X']),
    { draft: true, title: '7: X', base: 'main', head: '7_x' });
  assert.equal(parsePrCreate('az', ['repos', 'pr', 'create', '--draft', 'false', '--title', 'T']).draft, false);
  assert.equal(parsePrCreate('az', ['repos', 'pr', 'create', '--draft', '--title', 'T']).draft, true);
  assert.equal(parsePrCreate('gh', ['issue', 'create', '--title', 'T']), null);
  assert.equal(parsePrCreate('az', ['boards', 'work-item', 'create']), null);
});

test('fakeCli: a pr create is recorded and answered with the fake link; view and list find it; auth and logins pass', () => {
  const created = fakeCli('gh', ['pr', 'create', '--draft', '--title', '7: X'], { prs: [], branch: '7_x' });
  assert.equal(created.status, 0);
  assert.equal(created.stdout.trim(), FAKE_PR_URL);
  assert.deepEqual(created.record, { tool: 'gh', branch: '7_x', draft: true, title: '7: X', base: null, head: null,
    args: ['pr', 'create', '--draft', '--title', '7: X'] });
  const prs = [created.record];
  assert.equal(fakeCli('gh', ['pr', 'view', '--json', 'url'], { prs }).stdout.includes(FAKE_PR_URL), true);
  assert.equal(fakeCli('gh', ['pr', 'list'], { prs: [] }).status, 0);
  assert.equal(fakeCli('gh', ['auth', 'status'], { prs: [] }).status, 0);
  assert.equal(fakeCli('tea', ['logins', 'list'], { prs: [] }).status, 0);
  const az = fakeCli('az', ['repos', 'pr', 'create', '--draft', 'true', '--title', '7: X', '--source-branch', '7_x'], { prs: [], branch: 'main' });
  assert.equal(JSON.parse(az.stdout).isDraft, true);
  assert.equal(az.record.branch, '7_x', 'the named head branch wins over the checked-out one');
  for (const [tool, args] of [['gh', ['issue', 'list']], ['tea', ['issues']], ['az', ['boards', 'query']], ['gh', ['pr', 'merge']]]) {
    const r = fakeCli(tool, args, { prs });
    assert.equal(r.status, 1, `${tool} ${args.join(' ')}`);
    assert.match(r.stderr, /not available in the adw e2e sandbox/);
    assert.equal(r.record, undefined);
  }
});

test('the script records into the common git dir of the checkout it runs in, also from a worktree', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-pr-fake-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const g = (args, cwd = dir) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']);
  writeFileSync(path.join(dir, 'a'), 'a');
  g(['add', '-A']); g(['commit', '-qm', 'a']);
  g(['worktree', 'add', '-q', '-b', '7_x', path.join(dir, 'wt')]);
  const r = spawnSync(process.execPath, [SCRIPT, 'gh', 'pr', 'create', '--draft', '--title', '7: X'], { cwd: path.join(dir, 'wt'), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), FAKE_PR_URL);
  const lines = readFileSync(path.join(dir, '.git', 'adw-e2e', 'pr.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => [l.tool, l.branch, l.draft, l.title]), [['gh', '7_x', true, '7: X']]);
  const view = spawnSync(process.execPath, [SCRIPT, 'gh', 'pr', 'view'], { cwd: dir, encoding: 'utf8' });
  assert.equal(view.status, 0);
  assert.ok(view.stdout.includes(FAKE_PR_URL));
});

// The commands in fenced bash blocks and inline code, `\` continuations joined, shell-quoted words split.
function documentedCommands(markdown) {
  const code = [...markdown.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1].replace(/\\\n\s*/g, ' ')).join('\n').split('\n');
  const inline = [...markdown.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
  return [...code, ...inline].map((line) => [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]));
}

// Guard: a ticketing backend whose PR command is not faked would reach the real host, or leave the e2e run waiting.
test('every PR command a ticketing include documents is faked, and the fake sees its draft and title', () => {
  const files = readdirSync(INCLUDES).filter((f) => /^ticketing-.*\.md$/.test(f));
  assert.ok(files.length >= 4);
  let found = 0;
  for (const file of files) {
    for (const words of documentedCommands(readFileSync(path.join(INCLUDES, file), 'utf8'))) {
      const i = words.findIndex((w, k) => /^(pr|pulls)$/.test(w) && words[k + 1] === 'create');
      if (i < 1) continue;
      const tool = words[i - 1] === 'repos' ? words[i - 2] : words[i - 1];
      assert.ok(FAKED_CLIS.includes(tool), `${file}: ${tool} has no fake in e2e/local/image/pr-cli.mjs`);
      const pr = parsePrCreate(tool, words.slice(words.indexOf(tool) + 1));
      assert.ok(pr?.draft, `${file}: the fake does not see the draft in: ${words.join(' ')}`);
      assert.ok(pr.title, `${file}: the fake does not see the title in: ${words.join(' ')}`);
      found += 1;
    }
  }
  assert.ok(found >= 4, `found ${found} PR commands`);
});
