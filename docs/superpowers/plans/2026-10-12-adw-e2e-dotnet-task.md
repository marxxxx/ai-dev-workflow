# ADW E2E .NET Demo Task Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second E2E demo task, `demo-todo-dotnet` (the same ticket as a Blazor Server app with an HTTP API), runs on every `run` beside `demo-todo`, with results, baselines and calibrations kept per task.

**Architecture:** Stack-neutral task files move to `e2e/tasks/_shared/` and are mirrored into each task directory (git-ignored copies) by `e2e/lib/tasks.mjs` before Harbor, an image build or calibration reads them. The runner loops harness × task and stores results under `docs/adw-e2e/<ts>/<task>/<harness>/`. The .NET task brings its own seed app, task image and five calibration patches, verified with `dotnet test` and the deterministic Playwright oracle before any LLM run.

**Tech Stack:** Node ≥ 24 ESM, zero dependencies, `node:test`; Harbor 0.24.0; Docker; .NET 10 SDK (image `ai-dev-workflow-dotnet`), Blazor Web App (interactive server), xUnit, `Microsoft.AspNetCore.Mvc.Testing`.

**Spec:** `docs/superpowers/specs/2026-10-12-adw-e2e-dotnet-task-design.md` (extends `2026-10-11-adw-e2e-self-test-design.md` and `2026-10-12-adw-e2e-agentic-verification-design.md`).

## Global Constraints

- Branch `feat/adw-e2e-dotnet-task`. Work directly on it; no new branch or worktree.
- Zero runtime dependencies on the Node side (builtins only), Node ≥ 24, ESM, `node:test`; LF line endings everywhere.
- Style of `e2e/lib`: compact ESM, 2-space indent, single quotes, semicolons, dependencies injected (`exec`, `git`, `run`) for tests.
- Never run anything that uses LLM quota (`node e2e/run.mjs run|verify|calibrate`, any real `claude`/`codex`/`opencode` call) without the user's explicit approval. Docker without an LLM is allowed where a task says so.
- Never stage or commit `e2e/.env`, auth files, `e2e/jobs/`, `.superpowers/`, mirrored copies under `e2e/tasks/<task>/` (they are git-ignored), or build output (`bin/`, `obj/`). Stage only explicit paths; never `git add -A` or `git add .`.
- Never push.
- Commit messages end with exactly these two lines (after a blank line):
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Xt655q14GXqAK7gQKxf525
  ```
- Checks cover only `agent-dev`'s own contract and observable outcomes — never superpowers internals.
- Acceptance criteria AC1–AC7, persona, instruction and issue text stay byte-identical (they move to `_shared/`).
- The Gitea repository is `adw/demo-todo` in both tasks; the app listens on port 3000 in both tasks.
- The .NET seed app's page talks to the store only over the Blazor circuit (DI); it never calls the app's own HTTP API.
- `npm test` stays green after every task.

## Review Focus

1. A compose project of `demo-todo-dotnet` (`demo-todo-dotnet__…`) must never be matched by the `demo-todo` prefix, and vice versa — Ctrl-C/cleanup of one task must not tear down the other's containers (Task 2, `cleanupCompose` test).
2. A shared file that is also tracked in a task directory must stop the run with a clear error instead of being silently overwritten (Task 1, clash test).
3. Mirrored copies must never be committable: every shared path is git-ignored inside each task and not ignored in `_shared/` (Task 3, repository test).
4. Local .NET build output (`bin/`, `obj/`) in a task's seed repo must not change the fingerprint's task hash, or every developer build would look like a task change (Task 2, `TASK_EXCLUDE` test).
5. `compare` and `verify` across tasks must refuse instead of producing a meaningless verdict (Task 4, smoke with fixture run.json files).

---

## File Structure

| Path | Responsibility |
|---|---|
| `e2e/lib/tasks.mjs` (new) | Task names, directories, seed repo path, `--task` selection, mirroring `_shared/` into a task dir |
| `e2e/lib/tasks.test.mjs` (new) | Unit tests for `tasks.mjs`, plus repository checks (no shared file tracked in a task, mirrored copies ignored, Dockerfile `FROM` = configured base image, calibration patches present) |
| `e2e/tasks/_shared/**` (moved) | Stack-neutral task files, the only tracked copy |
| `e2e/tasks/demo-todo/**` | Node-specific: `task.toml`, `environment/Dockerfile`, `environment/seed/repo/`, `calibration/*.patch` |
| `e2e/tasks/demo-todo-dotnet/**` (new) | .NET-specific: the same set for Blazor Server |
| `e2e/.gitignore` | Generated seed-repo files and mirrored copies for every task |
| `e2e/config.json` | `tasks` map (name → `baseImage`) replaces `task` and `image` |
| `e2e/lib/{harbor,fingerprint,postverify,bundle,preflight,compare,report}.mjs` | Take a task name instead of reading `config.task`/`config.image` |
| `e2e/run.mjs` | Loops harness × task, `--task`, per-task result/calibration layout, per-task verify/compare |
| `docs/adw-e2e/README.md`, `AGENTS.md` | Two tasks, `_shared/`, layout, costs |
| `docs/adw-e2e/calibration/demo-todo/2026-10-12T1323Z/` (moved) | The existing passing Node calibration |

Ruling (spec deviation, recorded here so reviewers do not flag it): the spec names `"tasks": [...]` plus an image list. The plan uses one map, `"tasks": { "<name>": { "baseImage": "<image>" } }`, because the fingerprint (`image.ref`, `image.id`) and the preflight need the base image *per task*. Task 2 amends the spec's Runner section accordingly.

---

### Task 1: `e2e/lib/tasks.mjs` — task paths, selection and mirroring

**Files:**
- Create: `e2e/lib/tasks.mjs`
- Test: `e2e/lib/tasks.test.mjs`

**Interfaces:**
- Consumes: `walk(dir)` from `e2e/lib/fsutil.mjs` (returns absolute file paths, recursive, files only).
- Produces:
  - `SHARED = '_shared'`
  - `tasksRoot(config) → string` (`<root>/e2e/tasks`)
  - `taskNames(config) → string[]` (keys of `config.tasks`)
  - `taskDir(config, name) → string`
  - `seedRepo(config, name) → string` (`<taskDir>/environment/seed/repo`)
  - `selectTasks(config, requested: string[]) → string[]` (all when empty; throws `unknown task: …` otherwise)
  - `sharedFiles(sharedDir) → string[]` (sorted, relative)
  - `syncShared({ sharedDir, dir, tracked: Set<string> }) → string[]` (copies; throws on a clash or a missing `sharedDir`)
  - `prepareTaskDir(config, name, { tracked }?) → string[]` (mirrors `_shared/` into the task; `tracked` defaults to `git ls-files` of the task dir)

- [ ] **Step 1: Write the failing tests**

`e2e/lib/tasks.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareTaskDir, seedRepo, selectTasks, sharedFiles, syncShared, taskDir, taskNames } from './tasks.mjs';

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'adw-tasks-'));
  const shared = path.join(root, 'e2e/tasks/_shared');
  for (const [p, c] of [['instruction.md', 'I'], ['tests/verify.mjs', 'V'], ['environment/seed/seed.sh', '#!/bin/sh\n']]) {
    mkdirSync(path.dirname(path.join(shared, p)), { recursive: true });
    writeFileSync(path.join(shared, p), c);
  }
  chmodSync(path.join(shared, 'environment/seed/seed.sh'), 0o755);
  mkdirSync(path.join(root, 'e2e/tasks/a/environment/seed/repo'), { recursive: true });
  return { root, shared, config: { root, tasks: { a: { baseImage: 'img-a' }, b: { baseImage: 'img-b' } } } };
}

test('task names, dirs and seed repos come from config.tasks', () => {
  const { root, config } = fixture();
  try {
    assert.deepEqual(taskNames(config), ['a', 'b']);
    assert.equal(taskDir(config, 'b'), path.join(root, 'e2e/tasks/b'));
    assert.equal(seedRepo(config, 'a'), path.join(root, 'e2e/tasks/a/environment/seed/repo'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('selectTasks defaults to all tasks, keeps a requested subset and rejects unknown names', () => {
  const config = { tasks: { a: {}, b: {} } };
  assert.deepEqual(selectTasks(config, []), ['a', 'b']);
  assert.deepEqual(selectTasks(config, ['b']), ['b']);
  assert.throws(() => selectTasks(config, ['b', 'nope']), /unknown task: nope \(known: a, b\)/);
});

test('syncShared mirrors every shared file, overwrites a stale copy and keeps the executable bit', () => {
  const { root, shared, config } = fixture();
  try {
    const dir = taskDir(config, 'a');
    mkdirSync(path.join(dir, 'tests'), { recursive: true });
    writeFileSync(path.join(dir, 'tests/verify.mjs'), 'stale');
    const files = syncShared({ sharedDir: shared, dir, tracked: new Set() });
    assert.deepEqual(files, ['environment/seed/seed.sh', 'instruction.md', 'tests/verify.mjs']);
    assert.deepEqual(sharedFiles(shared), files);
    assert.equal(readFileSync(path.join(dir, 'tests/verify.mjs'), 'utf8'), 'V');
    assert.equal(readFileSync(path.join(dir, 'instruction.md'), 'utf8'), 'I');
    assert.ok(statSync(path.join(dir, 'environment/seed/seed.sh')).mode & 0o100, 'seed.sh stays executable');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a shared path tracked in the task dir is an error, and nothing is copied', () => {
  const { root, shared, config } = fixture();
  try {
    const dir = taskDir(config, 'a');
    assert.throws(() => syncShared({ sharedDir: shared, dir, tracked: new Set(['instruction.md', 'task.toml']) }),
      /tracked files shadow _shared\/ .*: instruction\.md$/);
    assert.throws(() => readFileSync(path.join(dir, 'tests/verify.mjs')), /ENOENT/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a missing _shared dir is an error', () => {
  const { root, config } = fixture();
  try {
    rmSync(path.join(root, 'e2e/tasks/_shared'), { recursive: true });
    assert.throws(() => prepareTaskDir(config, 'a', { tracked: new Set() }), /_shared is missing/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `node --test e2e/lib/tasks.test.mjs`
Expected: FAIL — `Cannot find module '.../e2e/lib/tasks.mjs'`.

- [ ] **Step 3: Implement `e2e/lib/tasks.mjs`**

```js
// E2E tasks: e2e/tasks/<name>/ holds what is stack-specific, e2e/tasks/_shared/ what every task shares.
// prepareTaskDir mirrors _shared/ into a task before Harbor, an image build or a calibration reads it;
// the copies are git-ignored (e2e/.gitignore), so _shared/ stays the only tracked copy.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { walk } from './fsutil.mjs';

export const SHARED = '_shared';
export const tasksRoot = (config) => path.join(config.root, 'e2e', 'tasks');
export const taskNames = (config) => Object.keys(config.tasks);
export const taskDir = (config, name) => path.join(tasksRoot(config), name);
export const seedRepo = (config, name) => path.join(taskDir(config, name), 'environment', 'seed', 'repo');

export function selectTasks(config, requested = []) {
  const known = taskNames(config);
  const unknown = requested.filter((t) => !known.includes(t));
  if (unknown.length) throw new Error(`unknown task: ${unknown.join(', ')} (known: ${known.join(', ')})`);
  return requested.length ? requested : known;
}

export function sharedFiles(sharedDir) {
  return walk(sharedDir).map((f) => path.relative(sharedDir, f)).sort();
}

export function syncShared({ sharedDir, dir, tracked }) {
  if (!existsSync(sharedDir)) throw new Error(`${sharedDir} is missing`);
  const files = sharedFiles(sharedDir);
  const clash = files.filter((f) => tracked.has(f));
  if (clash.length) throw new Error(`${dir}: tracked files shadow _shared/ (keep the only copy in _shared/): ${clash.join(', ')}`);
  for (const f of files) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    cpSync(path.join(sharedDir, f), path.join(dir, f));
  }
  return files;
}

const gitTracked = (root, dir) => new Set(execFileSync('git', ['-C', root, 'ls-files', '-z', '--', dir], { encoding: 'utf8' })
  .split('\0').filter(Boolean).map((f) => path.relative(dir, path.join(root, f))));

export function prepareTaskDir(config, name, { tracked } = {}) {
  const dir = taskDir(config, name);
  return syncShared({ sharedDir: path.join(tasksRoot(config), SHARED), dir, tracked: tracked ?? gitTracked(config.root, dir) });
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `node --test e2e/lib/tasks.test.mjs`
Expected: PASS (5 tests). Then `npm test`: all green.

- [ ] **Step 5: Commit**

```bash
git add e2e/lib/tasks.mjs e2e/lib/tasks.test.mjs
git commit -m "feat(e2e): task paths, --task selection and mirroring of shared task files

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xt655q14GXqAK7gQKxf525"
```

---

### Task 2: `config.tasks`, and the lib modules take a task name

**Files:**
- Modify: `e2e/config.json`, `e2e/lib/harbor.mjs`, `e2e/lib/fingerprint.mjs`, `e2e/lib/postverify.mjs`, `e2e/lib/bundle.mjs`, `e2e/lib/preflight.mjs`, `e2e/lib/compare.mjs`, `e2e/lib/report.mjs`, `docs/superpowers/specs/2026-10-12-adw-e2e-dotnet-task-design.md` (Runner → Config bullet)
- Test: `e2e/lib/harbor.test.mjs`, `e2e/lib/fingerprint.test.mjs`, `e2e/lib/postverify.test.mjs`, `e2e/lib/bundle.test.mjs`, `e2e/lib/preflight.test.mjs`, `e2e/lib/compare.test.mjs`, `e2e/lib/report.test.mjs`, `e2e/lib/criteria.test.mjs`

**Interfaces:**
- Consumes: `taskDir(config, name)`, `seedRepo(config, name)` from Task 1.
- Produces (exact signatures later tasks call):
  - `config.tasks = { "demo-todo": { "baseImage": "ai-dev-workflow-node:latest" } }`; `config.task` and `config.image` are gone.
  - `buildHarborArgs({ config, task, harness, jobName, jobsDir })` — `task` is a task name.
  - `cleanupCompose({ prefixes, exec? })` — downs compose projects named `<prefix>__…` for each prefix (task names).
  - `buildFingerprint({ config, harness, task, verifierHash, seed?, exec? })` — `seed` defaults to `seedRepo(config, task)`; `image.ref` is `config.tasks[task].baseImage`; exports `TASK_EXCLUDE`.
  - `taskImage(task) → 'adw-e2e-<task>'`; `buildTaskImage({ config, task, exec? }) → image name`.
  - `createCalibrationBundle({ root, seedRepo, patch, out, name, git? })` — the seed commit message is `Initial <name>`.
  - `runPreflight({ config, harnesses, tasks, … })` — checks the base image of every listed task once.
  - `findBaseline({ resultsDir, task, harness, before, isAncestor })` — looks in `<resultsDir>/<ts>/<task>/<harness>/`.
  - `renderRunReport(run)` titles `# E2E <task> · <harness>`; `renderSummary(runs: run[])` has a Task column; `renderCompare({ task, harness, base, cand, result, calibrated })` titles `# Compare <task> · <harness>: **<verdict>**`.
  - Run records gain a top-level `task` field (written by Task 4).

- [ ] **Step 1: `e2e/config.json`** — replace the line `"task": "tasks/demo-todo",` with

```json
  "tasks": {
    "demo-todo": { "baseImage": "ai-dev-workflow-node:latest" }
  },
```

and delete the line `"image": "ai-dev-workflow-node:latest",`.

- [ ] **Step 2: Update the tests first**

`e2e/lib/harbor.test.mjs` — change the import to `import { buildHarborArgs, cleanupCompose, runHarbor } from './harbor.mjs';`, in the first test call `buildHarborArgs({ config, task: 'demo-todo', harness: 'codex', jobName: 'codex-1', jobsDir: '/j' })`, add after its last assertion:

```js
  assert.match(pair('--user-persona-path'), /e2e\/tasks\/demo-todo\/persona\.md$/);
```

and append:

```js
test('cleanupCompose downs only the given tasks\' compose projects; demo-todo never matches demo-todo-dotnet', () => {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push(args.join(' '));
    return args[0] === 'ps' ? 'demo-todo__codex-1\ndemo-todo-dotnet__codex-1\nother__x\n\n' : '';
  };
  assert.deepEqual(cleanupCompose({ prefixes: ['demo-todo'], exec }), ['demo-todo__codex-1']);
  assert.deepEqual(calls.filter((c) => c.startsWith('compose')), ['compose -p demo-todo__codex-1 down -v --remove-orphans']);
  assert.deepEqual(cleanupCompose({ prefixes: ['demo-todo', 'demo-todo-dotnet'], exec }).sort(), ['demo-todo-dotnet__codex-1', 'demo-todo__codex-1']);
});
```

`e2e/lib/fingerprint.test.mjs` — change the import to `import { TASK_EXCLUDE, buildFingerprint, diffFingerprints } from './fingerprint.mjs';`; in the first test call `buildFingerprint({ config, harness: 'codex', task: 'demo-todo', seed: repo, verifierHash: 'vh', exec })` and add:

```js
    assert.equal(fp.image.ref, config.tasks['demo-todo'].baseImage);
    assert.match(fp.task, /^[0-9a-f]{64}$/);
```

and append:

```js
test('generated agent files and local build output are no part of the task hash', () => {
  for (const p of ['environment/seed/repo/.claude/skills/agent-dev/SKILL.md', 'environment/seed/repo/.mcp.json',
    'environment/seed/repo/src/DemoTodo/bin/Debug/net10.0/DemoTodo.dll', 'environment/seed/repo/obj/project.assets.json']) {
    assert.ok(TASK_EXCLUDE.test(p), p);
  }
  for (const p of ['environment/seed/repo/src/app.mjs', 'environment/seed/repo/src/DemoTodo/Program.cs', 'environment/Dockerfile']) {
    assert.ok(!TASK_EXCLUDE.test(p), p);
  }
});
```

`e2e/lib/postverify.test.mjs` — replace the test `'the task image is built from the task environment as adw-e2e-<task>'` with:

```js
test('the task image is built from the task environment as adw-e2e-<task>', () => {
  let call;
  assert.equal(buildTaskImage({ config, task: 'demo-todo', exec: (cmd, args) => { call = [cmd, ...args]; } }), 'adw-e2e-demo-todo');
  assert.equal(taskImage('demo-todo-dotnet'), 'adw-e2e-demo-todo-dotnet');
  const env = path.join(config.root, 'e2e/tasks/demo-todo/environment');
  assert.deepEqual(call, ['docker', 'build', '-t', 'adw-e2e-demo-todo', '-f', path.join(env, 'Dockerfile'), env]);
});
```

`e2e/lib/bundle.test.mjs` — every `createCalibrationBundle(...)` call gets `name: 'demo-todo'` — five call sites: `{ root, seedRepo: seed, patch, out }` at lines ~40, ~80, ~164, the one wrapped in `withGlobalConfig(globalCfg, () => createCalibrationBundle({ root, seedRepo: seed, patch, out }))` at ~153, and the relative-paths call `{ root: '.', seedRepo: 'seed', patch: 'v.patch', out: 'v.bundle' }` at ~182. In the first test add after `assert.equal(branch, '1_calibration');`:

```js
    assert.equal(git(co, 'log', '-1', '--format=%s', 'origin/main').trim(), 'Initial demo-todo');
```

`e2e/lib/preflight.test.mjs` — every `runPreflight({ config, harnesses: [...], …` gets `tasks: ['demo-todo'],` right after `harnesses`. Append:

```js
test('preflight checks the base image of every selected task once and names the image on drift', () => {
  const cfg = { ...config, tasks: { a: { baseImage: 'img-a' }, b: { baseImage: 'img-b' }, c: { baseImage: 'img-a' } } };
  const runs = [];
  const execTwo = (cmd, args) => {
    if (cmd === 'docker' && args[0] === 'run') { runs.push(args.at(-3)); return args.at(-3) === 'img-b' ? 'nothing pinned' : exec(cmd, args); }
    return exec(cmd, args);
  };
  const r = runPreflight({ config: cfg, harnesses: ['codex'], tasks: ['a', 'b', 'c'], exec: execTwo, probe: () => null, authPresent: () => true,
    platform: 'linux', root: '/home/u/adw' });
  assert.deepEqual(runs, ['img-a', 'img-b']);
  assert.deepEqual(r.problems, [`codex: img-b does not carry pinned ${versions.codex} (rebuild with node docker/build.mjs)`]);
});
```

(`args.at(-3)` is the image: the run args end with `<image>, '-lc', '<versions command>'`.)

`e2e/lib/compare.test.mjs` — in `'findBaseline picks the newest earlier run whose sha is on main'` every `path.join(dir, ts, 'codex'…)` / `path.join(dir, '2026-…', 'codex'…)` gets the task segment: `path.join(dir, ts, 'demo-todo', 'codex')` etc., every `findBaseline({ resultsDir: dir, harness: … })` gets `task: 'demo-todo',`, and the expected paths become `path.join(dir, '2026-10-01T0900Z', 'demo-todo', 'codex')`. Do the same in the test `'schema-1 runs are never a baseline and cannot be compared'` (its fixture path gets the `'demo-todo'` segment, its `findBaseline` call gets `task: 'demo-todo',`) — otherwise it fails with `The "path" argument must be of type string`. In the first findBaseline test append one assertion before the `finally`:

```js
    assert.equal(findBaseline({ resultsDir: dir, task: 'demo-todo-dotnet', harness: 'codex', before: '2026-10-03T0900Z', isAncestor: () => true }), null,
      'another task is never a baseline');
```

`e2e/lib/report.test.mjs` — the shared `run` fixture gets `task: 'demo-todo',` (after `schema: 2,`). In the first test replace `'# E2E codex'` with `'# E2E demo-todo · codex'`. Replace `renderSummary({ codex: aborted })` with `renderSummary([aborted])` and its expected match with `/\| demo-todo \| codex \(aborted: quota\) \|/`. Replace the summary test with:

```js
test('summary puts tasks and harnesses side by side with review medians', () => {
  const md = renderSummary([run, { ...run, harness: 'opencode' }, { ...run, task: 'demo-todo-dotnet' }]);
  assert.match(md, /\| Task \| Harness \| Reward rate/);
  assert.match(md, /Review medians/);
  assert.match(md, /\| demo-todo \| codex \| 0 \|/);
  assert.match(md, /\| demo-todo \| opencode \| 0 \|/);
  assert.match(md, /\| demo-todo-dotnet \| codex \| 0 \|/);
});
```

In the compare-report test call `renderCompare({ task: 'demo-todo', harness: 'codex', … })` and add `'# Compare demo-todo · codex: **worse**'` to the list of expected strings.

`e2e/lib/criteria.test.mjs` — line 19 becomes `const criteria = loadCriteria(path.join(taskDir(config, 'demo-todo'), 'acceptance-criteria.md'));` with `import { taskDir } from './tasks.mjs';` added (Task 3 points it at `_shared/`).

- [ ] **Step 3: Run the changed tests to confirm they fail**

Run: `node --test e2e/lib/harbor.test.mjs e2e/lib/fingerprint.test.mjs e2e/lib/postverify.test.mjs e2e/lib/bundle.test.mjs e2e/lib/preflight.test.mjs e2e/lib/compare.test.mjs e2e/lib/report.test.mjs`
Expected: FAIL — e.g. `TASK_EXCLUDE` not exported, `cleanupCompose` filters by `demo-todo__` only, `# E2E codex` instead of `# E2E demo-todo · codex`, bundle message `Initial demo-todo` passes already (fine), findBaseline paths without the task segment.

- [ ] **Step 4: Implement**

`e2e/lib/harbor.mjs` — add `import { taskDir } from './tasks.mjs';` and replace `buildHarborArgs` and `cleanupCompose`:

```js
export function buildHarborArgs({ config, task, harness, jobName, jobsDir }) {
  const h = config.harnesses[harness];
  const u = config.simulatedUser;
  const dir = taskDir(config, task);
  return ['run', '-p', dir, '-a', h.agent, '-m', h.model,
    '--ak', `version=${harnessVersion(config, harness)}`,
    ...Object.entries(h.agentKwargs).flatMap(([k, v]) => ['--ak', `${k}=${v}`]),
    '--user-agent', u.agent, '--user-model', u.model,
    '--uk', `disallowed_tools=${u.disallowedTools}`, '--uk', `append_system_prompt=${u.appendSystemPrompt}`,
    '--user-persona-path', path.join(dir, 'persona.md'),
    '--bridge', 'acp', '--bridge-prompt-path', path.join(dir, 'bridge-prompt.md'),
    '-o', jobsDir, '--job-name', jobName];
}
```

```js
// Harbor names a trial's compose project `<task>__<trial>`: the double underscore keeps `demo-todo`
// from matching `demo-todo-dotnet`.
export function cleanupCompose({ prefixes, exec = (c, a) => execFileSync(c, a, { encoding: 'utf8' }) }) {
  const projects = new Set(exec('docker', ['ps', '-a', '--format', '{{.Label "com.docker.compose.project"}}'])
    .split('\n').filter((p) => prefixes.some((t) => p.startsWith(`${t}__`))));
  for (const p of projects) {
    try { exec('docker', ['compose', '-p', p, 'down', '-v', '--remove-orphans']); } catch { /* already gone */ }
  }
  return [...projects];
}
```

`e2e/lib/fingerprint.mjs` — add `import { seedRepo, taskDir } from './tasks.mjs';`, add above `buildFingerprint`:

```js
// Generated agent files and local build output are no part of the task.
export const TASK_EXCLUDE = /(^|\/)(\.claude|\.agents|\.opencode|\.codex|bin|obj)\/|\.mcp\.json$/;
```

and change `buildFingerprint` to:

```js
export function buildFingerprint({ config, harness, task, verifierHash, seed = seedRepo(config, task),
  exec = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', cwd: config.root }) }) {
  const root = config.root;
  const inventory = path.join(root, 'docker/tools/inventory.json');
  const inv = JSON.parse(readFileSync(inventory, 'utf8'));
  const baseImage = config.tasks[task].baseImage;
  const skill = (p) => sha256File(path.join(seed, p, 'skills/agent-dev/SKILL.md'));
  const includes = walk(path.join(seed, '.agents/includes')).sort().map(sha256File).join(':');
  return {
    adw: { version: JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version,
      sha: exec('git', ['rev-parse', 'HEAD']).trim(), dirty: exec('git', ['status', '--porcelain']).trim() !== '' },
    skill: { claude: skill('.claude'), codex: skill('.agents'), opencode: skill('.opencode'), includes },
    image: { ref: baseImage, id: exec('docker', ['image', 'inspect', '--format', '{{.Id}}', baseImage]).trim(),
      inventory: sha256File(inventory), harnessVersion: harnessVersion(config, harness, inventory),
      superpowers: inv.sourceRevisions.superpowers },
    harbor: { version: exec('harbor', ['--version']).trim(), ...ACP_VERSIONS },
    code: { agents: sha256Dir(path.join(root, 'e2e/agents'), { exclude: /__pycache__/ }),
      lib: sha256Dir(path.join(root, 'e2e/lib'), { exclude: /(^|\/)fixtures\/|\.test\.mjs$/ }) },
    config: configHash(config),
    verifierHash,
    models: { target: config.harnesses[harness].model, subagents: config.harnesses[harness].subagentModel ?? null,
      simulatedUser: config.simulatedUser.model, verifier: config.verifier.model, review: config.review.model },
    task: sha256Dir(taskDir(config, task), { exclude: TASK_EXCLUDE }),
  };
}
```

`e2e/lib/postverify.mjs` — add `import { taskDir } from './tasks.mjs';` and replace `taskImage`/`buildTaskImage`:

```js
export const taskImage = (task) => `adw-e2e-${task}`;

// The verifier runs in the task's own image; the Docker layer cache makes rebuilding cheap.
export function buildTaskImage({ config, task, exec = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] }) }) {
  const dir = path.join(taskDir(config, task), 'environment');
  exec('docker', ['build', '-t', taskImage(task), '-f', path.join(dir, 'Dockerfile'), dir]);
  return taskImage(task);
}
```

`e2e/lib/bundle.mjs` — `createCalibrationBundle({ root, seedRepo, patch, out, name, git = defaultGit })`, and the seed commit becomes `git([...COMMIT, '-C', dir, 'commit', '-qm', \`Initial ${name}\`]);`.

`e2e/lib/preflight.mjs` — `runPreflight({ config, harnesses, tasks, exec = defaultExec, … })`; replace the block from `if (tryExec('docker', ['image', 'inspect', …` to its closing `}` with:

```js
  for (const image of new Set(tasks.map((t) => config.tasks[t].baseImage))) {
    if (!tryExec('docker', ['image', 'inspect', '--format', '{{.Id}}', image])) continue;
    const out = tryExec('docker', ['run', '--rm', '-e', 'AGENT_TOOLSTACK_ONLY=1', '--entrypoint', 'bash', image, '-lc',
      'claude --version; codex --version; opencode --version']) ?? '';
    for (const h of harnesses) {
      const v = harnessVersion(config, h);
      if (!out.includes(v)) problems.push(`${h}: ${image} does not carry pinned ${v} (rebuild with node docker/build.mjs)`);
    }
  }
```

`e2e/lib/compare.mjs` — `findBaseline({ resultsDir, task, harness, before, isAncestor })`, and `const file = path.join(resultsDir, ts, task, harness, 'run.json');`.

`e2e/lib/report.mjs`:
- in `renderRunReport` the first line becomes `` `# E2E ${run.task} · ${run.harness}` ``;
- `renderSummary` becomes:

```js
export function renderSummary(runs) {
  const rows = runs.map((r) => `| ${r.task} | ${r.harness}${r.aborted ? ` (aborted: ${r.aborted})` : ''} | ${n(r.summary.rewardRate)} | ${n(r.summary.median.tokens)} | ${n(r.summary.median.agent)} | ${Object.values(r.summary.reviewMedian).map(n).join(' / ')} | ${r.summary.errorClasses.join(', ') || 'none'} |`);
  return `# E2E summary\n\n| Task | Harness | Reward rate | Median tokens | Median agent s | Review medians | Errors |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
}
```

- `renderCompare({ task, harness, base, cand, result, calibrated })` and its first line `` `# Compare ${task} · ${harness}: **${result.verdict}**` ``.

- [ ] **Step 5: Amend the spec** — in `docs/superpowers/specs/2026-10-12-adw-e2e-dotnet-task-design.md`, section "Runner", replace the whole `**Config:**` bullet with:

```markdown
- **Config:** `config.json` replaces `task` and `image` with one map, `"tasks": { "demo-todo": { "baseImage":
  "ai-dev-workflow-node:latest" }, "demo-todo-dotnet": { "baseImage": "ai-dev-workflow-dotnet:latest" } }`.
  The base image is per task because the fingerprint and the preflight's pinned-tools check need it per task.
```

- [ ] **Step 6: Run the tests**

Run: `node --test e2e/lib/harbor.test.mjs e2e/lib/fingerprint.test.mjs e2e/lib/postverify.test.mjs e2e/lib/bundle.test.mjs e2e/lib/preflight.test.mjs e2e/lib/compare.test.mjs e2e/lib/report.test.mjs e2e/lib/criteria.test.mjs`
Expected: PASS. Then `npm test`: all green. (`e2e/run.mjs` still reads `config.task`; it is not run by `npm test` and is rewritten in Task 4 — do not run the CLI until then.)

- [ ] **Step 7: Commit**

```bash
git add e2e/config.json e2e/lib/harbor.mjs e2e/lib/fingerprint.mjs e2e/lib/postverify.mjs e2e/lib/bundle.mjs e2e/lib/preflight.mjs \
  e2e/lib/compare.mjs e2e/lib/report.mjs e2e/lib/harbor.test.mjs e2e/lib/fingerprint.test.mjs e2e/lib/postverify.test.mjs \
  e2e/lib/bundle.test.mjs e2e/lib/preflight.test.mjs e2e/lib/compare.test.mjs e2e/lib/report.test.mjs e2e/lib/criteria.test.mjs \
  docs/superpowers/specs/2026-10-12-adw-e2e-dotnet-task-design.md
git commit -m "refactor(e2e): config.tasks maps each task to its base image; lib modules take a task name

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xt655q14GXqAK7gQKxf525"
```

---

### Task 3: Split `demo-todo` into `_shared/` and `demo-todo/`; ignore rules; repository checks

**Files:**
- Move (`git mv`) from `e2e/tasks/demo-todo/` to `e2e/tasks/_shared/` (same relative path): `instruction.md`, `persona.md`, `bridge-prompt.md`, `acceptance-criteria.md`, `tests/test.sh`, `tests/verify.mjs`, `tests/checks.mjs`, `tests/checks.test.mjs`, `environment/docker-compose.yaml`, `environment/gitea-init.sh`, `environment/seed/seed.sh`, `environment/seed/issue.md`, `environment/seed/answers.json`, `calibration/spec.md`, `calibration/summary.md`, `calibration/expected.json`
- Modify: `e2e/.gitignore`, `package.json` (`test` script), `e2e/lib/criteria.test.mjs`, `e2e/lib/tasks.test.mjs` (append)

**Interfaces:**
- Consumes: `taskNames`, `taskDir`, `seedRepo`, `sharedFiles`, `SHARED`, `tasksRoot` (Task 1); `config.tasks` (Task 2).
- Produces: `e2e/tasks/_shared/` is the only tracked copy of the files above; their copies in any `e2e/tasks/<task>/` are git-ignored.

- [ ] **Step 1: Write the failing repository checks** — append to `e2e/lib/tasks.test.mjs` (merge the imports into the existing import lines: add `existsSync` to the `node:fs` import and `SHARED, tasksRoot` to the `./tasks.mjs` import; add the two new import lines below):

```js
import { execFileSync } from 'node:child_process';
import { loadConfig } from './config.mjs';

const repo = loadConfig();
const gitIn = (...a) => execFileSync('git', ['-C', repo.root, ...a], { encoding: 'utf8' });
const ignored = (p) => { try { gitIn('check-ignore', '-q', '--no-index', p); return true; } catch { return false; } };
const rel = (p) => path.relative(repo.root, p);

test('every configured task has its stack-specific files, and its Dockerfile builds on the configured base image', () => {
  const expected = JSON.parse(readFileSync(path.join(tasksRoot(repo), SHARED, 'calibration/expected.json'), 'utf8'));
  for (const name of taskNames(repo)) {
    const dir = taskDir(repo, name);
    for (const f of ['task.toml', 'environment/Dockerfile', ...Object.keys(expected).map((v) => `calibration/${v}.patch`)]) {
      assert.ok(existsSync(path.join(dir, f)), `${name}: ${f}`);
    }
    assert.ok(existsSync(seedRepo(repo, name)), `${name}: seed repo`);
    const from = readFileSync(path.join(dir, 'environment/Dockerfile'), 'utf8').match(/^FROM\s+(\S+)/m)?.[1];
    assert.equal(from, repo.tasks[name].baseImage, `${name}: Dockerfile FROM`);
  }
});

test('shared files are tracked only in _shared/, and their mirrored copies are git-ignored in every task', () => {
  const shared = sharedFiles(path.join(tasksRoot(repo), SHARED));
  assert.ok(shared.includes('acceptance-criteria.md') && shared.includes('tests/verify.mjs'));
  for (const name of taskNames(repo)) {
    const dir = rel(taskDir(repo, name));
    const tracked = new Set(gitIn('ls-files', '-z', '--', dir).split('\0').filter(Boolean).map((f) => path.relative(dir, f)));
    for (const f of shared) {
      assert.ok(!tracked.has(f), `${name}/${f} is tracked: keep the only copy in _shared/`);
      assert.ok(ignored(path.join(dir, f)), `${name}/${f} must be git-ignored`);
    }
  }
  for (const f of shared) assert.ok(!ignored(rel(path.join(tasksRoot(repo), SHARED, f))), `_shared/${f} must not be ignored`);
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `node --test e2e/lib/tasks.test.mjs`
Expected: FAIL — `ENOENT … e2e/tasks/_shared/calibration/expected.json`.

- [ ] **Step 3: Move the shared files**

```bash
cd e2e/tasks
mkdir -p _shared/tests _shared/environment/seed _shared/calibration
for f in instruction.md persona.md bridge-prompt.md acceptance-criteria.md \
  tests/test.sh tests/verify.mjs tests/checks.mjs tests/checks.test.mjs \
  environment/docker-compose.yaml environment/gitea-init.sh \
  environment/seed/seed.sh environment/seed/issue.md environment/seed/answers.json \
  calibration/spec.md calibration/summary.md calibration/expected.json; do
  git mv "demo-todo/$f" "_shared/$f"
done
cd ../..
```

- [ ] **Step 4: Replace `e2e/.gitignore`** with exactly:

```gitignore
jobs/
.env
# Generated into every task's seed repo by run.mjs (agent-src/generate.mjs).
tasks/*/environment/seed/repo/.claude/
tasks/*/environment/seed/repo/.agents/
tasks/*/environment/seed/repo/.opencode/
tasks/*/environment/seed/repo/.mcp.json
tasks/*/environment/seed/repo/.codex/
tasks/*/environment/seed/repo/ai-project.json
# Mirrored from tasks/_shared/ into every task by e2e/lib/tasks.mjs: never commit the copies.
tasks/*/instruction.md
tasks/*/persona.md
tasks/*/bridge-prompt.md
tasks/*/acceptance-criteria.md
tasks/*/tests/test.sh
tasks/*/tests/verify.mjs
tasks/*/tests/checks.mjs
tasks/*/tests/checks.test.mjs
tasks/*/environment/docker-compose.yaml
tasks/*/environment/gitea-init.sh
tasks/*/environment/seed/seed.sh
tasks/*/environment/seed/issue.md
tasks/*/environment/seed/answers.json
tasks/*/calibration/spec.md
tasks/*/calibration/summary.md
tasks/*/calibration/expected.json
!tasks/_shared/**
__pycache__/
```

- [ ] **Step 5: `package.json`** — in the `test` script replace `e2e/tasks/demo-todo/tests/checks.test.mjs` with `e2e/tasks/_shared/tests/checks.test.mjs`.

- [ ] **Step 6: `e2e/lib/criteria.test.mjs`** — the criteria path becomes `path.join(config.root, 'e2e/tasks/_shared/acceptance-criteria.md')` (drop the now unused `taskDir` import), and the test title `'demo-todo has AC1 to AC7 …'` becomes `'the shared criteria have AC1 to AC7 and name no endpoint, query parameter or field'`.

- [ ] **Step 7: Run the tests**

Run: `node --test e2e/lib/tasks.test.mjs e2e/lib/criteria.test.mjs e2e/tasks/_shared/tests/checks.test.mjs`
Expected: PASS. Then `npm test`: all green.

- [ ] **Step 8: Commit**

```bash
git add e2e/tasks e2e/.gitignore package.json e2e/lib/criteria.test.mjs e2e/lib/tasks.test.mjs
git status --short   # only the 16 renames and the four modified files; no untracked copies
git commit -m "refactor(e2e): stack-neutral task files move to tasks/_shared and are mirrored into each task

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xt655q14GXqAK7gQKxf525"
```

(`git add e2e/tasks` is an explicit path; it stages the renames. Mirrored copies are ignored and cannot be picked up.)

---

### Task 4: The CLI runs harness × task; per-task results, calibrations, verify and compare; docs

**Files:**
- Modify: `e2e/run.mjs` (full replacement below), `docs/adw-e2e/README.md`, `AGENTS.md` ("E2E self-test" paragraph)
- Move: `docs/adw-e2e/calibration/2026-10-12T1323Z/` → `docs/adw-e2e/calibration/demo-todo/2026-10-12T1323Z/`

**Interfaces:**
- Consumes: everything Task 1–3 produce (`selectTasks`, `prepareTaskDir`, `taskDir`, `seedRepo`; the new lib signatures; `config.tasks`).
- Produces (CLI contract):
  - `run [--harness h]... [--task t]... [--repetitions n]` → `docs/adw-e2e/<ts>/<task>/<harness>/{run.json,report.md,evidence/,compare.md}`, `docs/adw-e2e/<ts>/summary.md`; jobs under `e2e/jobs/<ts>/<task>/<harness>-<i>/`.
  - `calibrate [--task t]... [--runs n]` → `docs/adw-e2e/calibration/<task>/<ts>/`.
  - `verify <docs/adw-e2e/<ts>/<task>/<harness>> [--trial id]` (task from the path, must match `run.json`'s `task`).
  - `compare <baseDir> <candDir>` refuses runs of different tasks.
  - `preflight [--task t]...` checks the base images of the selected tasks.
  - Run records carry `task`; calibration records carry `task`.

This task has no new unit tests: `run.mjs` is top-level CLI code (as before). Its logic moved into the tested lib modules in Tasks 1–3; this task is verified by smoke runs and a Docker build without an LLM.

- [ ] **Step 1: Replace `e2e/run.mjs`** with exactly:

```js
#!/usr/bin/env node
// ADW E2E self-test CLI. See docs/adw-e2e/README.md.
import { execFileSync } from 'node:child_process';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from './lib/config.mjs';
import { buildFingerprint } from './lib/fingerprint.mjs';
import { buildHarborArgs, cleanupCompose, runHarbor } from './lib/harbor.mjs';
import { runPreflight } from './lib/preflight.mjs';
import { stageSecrets, scanForSecrets, redactSecrets, scrubSecretsInTree, removeOpenCodeAuthCopies } from './lib/secrets.mjs';
import { applyPostVerification, buildTrialRecord, emptyOutcome, section, unjudgedOutcome } from './lib/trial.mjs';
import { summarizeTrials } from './lib/summary.mjs';
import { compareRuns, findBaseline } from './lib/compare.mjs';
import { renderCompare, renderRunReport, renderSummary } from './lib/report.mjs';
import { loadCriteria } from './lib/criteria.mjs';
import { buildTaskImage, postVerify, verifierHash } from './lib/postverify.mjs';
import { bundleLeaks, createCalibrationBundle } from './lib/bundle.mjs';
import { evaluateCalibration, findCalibration, renderCalibrationReport } from './lib/calibration.mjs';
import { isInterrupt, isQuota } from './lib/claude.mjs';
import { prepareTaskDir, seedRepo, selectTasks, taskDir } from './lib/tasks.mjs';

const config = loadConfig();
const { positionals, values: opts } = parseArgs({ allowPositionals: true,
  options: { harness: { type: 'string', multiple: true }, task: { type: 'string', multiple: true }, repetitions: { type: 'string' },
    trial: { type: 'string' }, runs: { type: 'string' } } });
const [command, ...rest] = positionals;
const harnesses = opts.harness?.length ? opts.harness : Object.keys(config.harnesses);
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(2); };
const unknown = harnesses.filter((h) => !Object.hasOwn(config.harnesses, h));
if (unknown.length) fail(`unknown harness: ${unknown.join(', ')} (known: ${Object.keys(config.harnesses).join(', ')})`);
let tasks;
try { tasks = selectTasks(config, opts.task ?? []); } catch (e) { fail(e.message); }
for (const name of ['repetitions', 'runs']) {
  if (opts[name] !== undefined && !/^[1-9]\d*$/.test(opts[name])) fail(`--${name} must be a positive integer, got "${opts[name]}"`);
}
const git = (...a) => execFileSync('git', a, { cwd: config.root, encoding: 'utf8' }).trim();
const timestamp = () => new Date().toISOString().replace(/:\d\d\.\d+Z$/, 'Z').replace(/:/g, '');
const resultsDir = path.join(config.root, config.resultsDir);
// postVerify blocks the event loop (spawnSync), so a Ctrl-C handler cannot run during it: yield once
// afterwards, before anything is written, so a pending signal handler gets its turn first.
const tick = () => new Promise((resolve) => setImmediate(resolve));
const acLine = (x) => Object.entries(x.acceptanceCriteria).map(([id, v]) => `${id} ${v ?? '—'}`).join(' · ');

// Mirrors _shared/ into the task directory, then reads what the task is judged against. Every task has
// its own calibrations: the verifier hash is the same for tasks with the same criteria, the stack is not.
function loadTask(name) {
  try { prepareTaskDir(config, name); } catch (e) { fail(e.message); }
  const dir = taskDir(config, name);
  const criteria = loadCriteria(path.join(dir, 'acceptance-criteria.md'));
  const hash = verifierHash({ config, criteria });
  const calibrationDir = path.join(resultsDir, 'calibration', name);
  return { name, dir, seed: seedRepo(config, name), criteria, hash, calibrationDir,
    calibration: () => findCalibration({ dir: calibrationDir, hash }) };
}

// Every text file under the results dir goes through here so known secret values never reach disk.
let secretValues = [];
function writeResult(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, redactSecrets(text, secretValues));
}
const readRun = (dir) => JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8'));
function writeRun(dir, record) {
  writeResult(path.join(dir, 'run.json'), `${JSON.stringify(record, null, 2)}\n`);
  writeResult(path.join(dir, 'report.md'), renderRunReport(record));
}
// summary.md covers every task × harness of one result set (<ts>/<task>/<harness>/run.json).
function writeSummary(outRoot) {
  const runs = readdirSync(outRoot, { withFileTypes: true }).filter((t) => t.isDirectory())
    .flatMap((t) => readdirSync(path.join(outRoot, t.name)).map((h) => path.join(outRoot, t.name, h)))
    .filter((d) => existsSync(path.join(d, 'run.json'))).map(readRun);
  writeResult(path.join(outRoot, 'summary.md'), renderSummary(runs));
}

function safeCleanupCompose() {
  try { cleanupCompose({ prefixes: tasks }); } catch (e) { console.warn(`! compose cleanup failed: ${e.message}`); }
}

function preflight() {
  const staged = stageSecrets({ config, invocationDir: path.join(config.root, config.jobsDir, 'preflight') });
  const has = { 'claude-code': 'CLAUDE_CODE_OAUTH_TOKEN', codex: 'CODEX_AUTH_JSON_PATH', opencode: 'OPENCODE_AUTH_JSON_PATH' };
  let r;
  try {
    r = runPreflight({ config, harnesses, tasks, env: staged.env, authPresent: (h) => Boolean(staged.env[has[h]]) });
  } finally {
    staged.cleanup();
  }
  for (const w of r.warnings ?? []) console.warn(`! ${w}`);
  for (const p of r.problems) console.error(`✗ ${p}`);
  console.log(r.ok ? 'preflight ok' : 'preflight failed');
  return r.ok;
}

// verify and calibrate need only the Claude login (verifier and review). Ctrl-C removes the staged
// copies (and whatever else `onExit` cleans up), like run() does.
function stageClaude(name, onExit = () => {}) {
  const staged = stageSecrets({ config, invocationDir: path.join(config.root, config.jobsDir, name) });
  if (!staged.env.CLAUDE_CODE_OAUTH_TOKEN) { staged.cleanup(); fail(`claude login missing: put CLAUDE_CODE_OAUTH_TOKEN into ${config.auth.claudeEnvFile}`); }
  secretValues = staged.values;
  process.on('SIGINT', () => { staged.cleanup(); onExit(); process.exit(130); });
  process.on('SIGTERM', () => { staged.cleanup(); onExit(); process.exit(143); });
  return staged;
}

// The E2E verifier and the review judge on one PR head (e2e/lib/postverify.mjs).
function postVerifyTrial(task, bundle, evidenceDir, env, image) {
  const ticket = JSON.parse(readFileSync(path.join(evidenceDir, 'ticket.json'), 'utf8'));
  return postVerify({ config, bundle, criteria: task.criteria, env, image,
    spec: section(ticket.comments, 'Approved Spec'), summary: section(ticket.comments, 'Implementation Summary') });
}
function writeVerdicts(evidenceDir, pv) {
  writeResult(path.join(evidenceDir, 'acceptance.json'),
    `${JSON.stringify({ criteria: pv.acceptanceCriteria, evidence: pv.acceptanceEvidence, error: pv.verifierError }, null, 2)}\n`);
  writeResult(path.join(evidenceDir, 'review.json'), `${JSON.stringify({ scores: pv.review, reasons: pv.reviewReasons, error: pv.reviewError }, null, 2)}\n`);
}

function compareDirs(baseDir, candDir) {
  const base = readRun(baseDir); const cand = readRun(candDir);
  for (const [dir, r] of [[baseDir, base], [candDir, cand]]) {
    if (r.schema !== 2) fail(`${dir}: schema ${r.schema ?? 1} runs cannot be compared (no bundles to re-verify)`);
  }
  if (!base.task || base.task !== cand.task) {
    fail(`only runs of the same task can be compared: ${baseDir} is ${base.task ?? '(no task)'}, ${candDir} is ${cand.task ?? '(no task)'}`);
  }
  const result = compareRuns(base, cand, config.thresholds);
  writeResult(path.join(candDir, 'compare.md'), renderCompare({ task: cand.task, harness: cand.harness, base: baseDir, cand: candDir, result,
    calibrated: Boolean(cand.calibration) }));
  console.log(`${cand.task} · ${cand.harness}: ${result.verdict} (${path.join(candDir, 'compare.md')})`);
  return result;
}

// Last line of defence: no staged secret value may stay under the jobs dir (e.g. in agent logs).
function scrubJobs(jobsDir, values) {
  try {
    const { redacted, skippedWithSecret } = scrubSecretsInTree(jobsDir, values,
      { skip: (f) => path.relative(jobsDir, f).split(path.sep)[0] === '.secrets' });
    if (redacted.length) console.warn(`! redacted secrets in:\n${redacted.join('\n')}`);
    if (skippedWithSecret.length) console.warn(`! secrets in binary/db files left untouched (remove manually):\n${skippedWithSecret.join('\n')}`);
  } catch (e) { console.warn(`! jobs secret scan failed: ${e.message}`); }
}

function reportLeaks(dir, values) {
  const leaks = scanForSecrets(dir, values);
  if (leaks.length) {
    console.error(`✗ secrets found in results despite redaction:\n${leaks.join('\n')}`);
    process.exitCode = 1;
  }
}

// Whether the container verifier saw at least one PR (an unreadable file counts as none).
function hasPull(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')).length > 0; } catch { return false; }
}

async function run() {
  if (!preflight()) process.exit(1);
  const selected = tasks.map(loadTask);
  for (const t of selected) {
    rmSync(path.join(t.seed, 'ai-project.json'), { force: true }); // init --answers needs a fresh tree
    execFileSync('node', ['agent-src/generate.mjs', 'init', '--answers', path.join(t.dir, 'environment/seed/answers.json'), '--root', t.seed],
      { cwd: config.root, stdio: 'inherit', input: '' });
    execFileSync('node', ['agent-src/generate.mjs', 'generate', '--root', t.seed], { cwd: config.root, stdio: 'inherit' });
    t.image = buildTaskImage({ config, task: t.name });
    t.calibrated = t.calibration();
    if (!t.calibrated) console.warn(`! ${t.name}: verifier not calibrated for this verifier hash: run node e2e/run.mjs calibrate --task ${t.name}`);
  }
  const ts = timestamp();
  const jobsDir = path.join(config.root, config.jobsDir, ts);
  const outRoot = path.join(resultsDir, ts);
  mkdirSync(jobsDir, { recursive: true });
  const repetitions = Number(opts.repetitions ?? config.repetitions);
  let aborted = null;
  let staged;
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try { removeOpenCodeAuthCopies(jobsDir); } catch (e) { console.warn(`! auth copy removal failed: ${e.message}`); }
    if (staged) scrubJobs(jobsDir, staged.values);
    staged?.cleanup();
    safeCleanupCompose();
  };
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
  try {
    staged = stageSecrets({ config, invocationDir: jobsDir });
    secretValues = staged.values;
    // Harness outside, task inside: one limit window can run one harness over every task.
    for (const harness of harnesses) {
      for (const t of selected) {
        if (aborted) break;
        const fingerprint = buildFingerprint({ config, harness, task: t.name, verifierHash: t.hash });
        const taskJobs = path.join(jobsDir, t.name);
        mkdirSync(taskJobs, { recursive: true });
        const trials = [];
        for (let i = 1; i <= repetitions; i++) {
          const id = `${harness}-${i}`;
          console.log(`▶ ${t.name} · ${id}`);
          const failed = (harbor) => ({ id, reward: 0, contract: 0, checks: {}, ownTests: 0, ...emptyOutcome(t.criteria),
            errors: { harbor, bridge: null, tool: 0, timeout: false, quota: false } });
          let trial;
          try {
            const log = createWriteStream(path.join(taskJobs, `${id}.log`));
            log.on('error', (e) => console.warn(`! log stream error: ${e.message}`));
            const code = await runHarbor({ args: buildHarborArgs({ config, task: t.name, harness, jobName: id, jobsDir: taskJobs }), cwd: config.root,
              logStream: log, timeoutMs: 7_200_000,
              env: { ...staged.env, PYTHONPATH: path.join(config.root, 'e2e'), E2E_CLAUDE_SUBAGENT_MODEL: config.harnesses[harness].subagentModel ?? '' } });
            log.end();
            safeCleanupCompose();
            const jobDir = path.join(taskJobs, id);
            const trialDir = existsSync(jobDir) ? readdirSync(jobDir).map((d) => path.join(jobDir, d)).find((d) => path.basename(d).startsWith(`${t.name}__`)) : null;
            trial = trialDir ? buildTrialRecord({ id, harness, trialDir, config, criteria: t.criteria }) : failed(`harbor exit ${code}`);
            if (trialDir && code !== 0 && !trial.errors.harbor) trial.errors.harbor = `harbor exit ${code}`;
            // The OpenCode adapter uploads its auth.json into the bind-mounted logs dir: never keep it.
            if (trialDir) rmSync(path.join(trialDir, 'agent/opencode/xdg-data/opencode/auth.json'), { force: true });
            if (trialDir && existsSync(path.join(trialDir, 'verifier'))) {
              const ev = path.join(outRoot, t.name, harness, 'evidence', id);
              mkdirSync(ev, { recursive: true });
              for (const f of ['ticket.json', 'pulls.json', 'pr.diff', 'pr-commits.txt', 'own-tests.txt', 'notes.txt', 'clone-error.txt']) {
                const src = path.join(trialDir, 'verifier', f);
                if (existsSync(src)) writeResult(path.join(ev, f), readFileSync(src, 'utf8'));
              }
              const bundle = path.join(trialDir, 'verifier/pr-head.bundle');
              if (existsSync(bundle)) {
                try {
                  if (bundleLeaks(bundle, staged.values)) {
                    console.error(`✗ ${t.name} · ${id}: a secret occurs in the PR history: bundle not stored, the trial cannot be re-verified`);
                    process.exitCode = 1;
                  } else copyFileSync(bundle, path.join(ev, 'pr-head.bundle'));
                } catch (e) {
                  console.error(`✗ ${t.name} · ${id}: bundle could not be scanned for secrets (${e.message}): not stored, the trial cannot be re-verified`);
                  process.exitCode = 1;
                }
                console.log('  post-verifying (E2E verifier, review)');
                try {
                  const pv = postVerifyTrial(t, bundle, ev, staged.env, t.image);
                  await tick();
                  writeVerdicts(ev, pv);
                  trial = applyPostVerification(trial, pv);
                } catch (e) {
                  if (isInterrupt(e)) throw e; // Ctrl-C is no verdict
                  // A broken verifier is no agent failure: keep the trial, leave it unjudged.
                  const error = `post-verification: ${e.message}`;
                  console.error(`✗ ${t.name} · ${id}: ${error}`);
                  trial = applyPostVerification(trial, unjudgedOutcome(t.criteria, config, error));
                }
                console.log(`  ${acLine(trial)}`);
              } else if (hasPull(path.join(trialDir, 'verifier/pulls.json'))) {
                // A PR exists but its head could not be bundled: a verifier failure, not an agent failure.
                trial = applyPostVerification(trial, unjudgedOutcome(t.criteria, config, 'no PR-head bundle (see clone-error.txt)'));
                console.log(`  ${acLine(trial)}`);
              }
            }
          } catch (e) {
            if (isInterrupt(e)) throw e;
            trial = failed(`runner error: ${e.message}`);
            safeCleanupCompose();
          }
          trials.push(trial);
          console.log(`  reward ${trial.reward} · contract ${trial.contract} · acceptance ${trial.acceptance}`);
          // Every later trial would fail the same way and poison the comparison: stop here.
          if (trial.errors?.quota) {
            aborted = 'quota';
            console.error(`✗ subscription usage limit reached in ${t.name} · ${id}: run aborted, results are not a valid baseline`);
            break;
          }
        }
        const h = config.harnesses[harness];
        const runRecord = { schema: 2, task: t.name, harness, ...(aborted ? { aborted } : {}), fingerprint, calibration: t.calibrated,
          config: { model: h.model, subagentModel: h.subagentModel ?? null, agentKwargs: h.agentKwargs, repetitions },
          trials, summary: summarizeTrials(trials) };
        const dir = path.join(outRoot, t.name, harness);
        writeRun(dir, runRecord);
        try {
          const baseline = findBaseline({ resultsDir, task: t.name, harness, before: ts,
            isAncestor: (sha) => { try { git('merge-base', '--is-ancestor', sha, 'main'); return true; } catch { return false; } } });
          if (baseline && !aborted) compareDirs(baseline, dir);
        } catch (e) { console.warn(`! baseline compare failed: ${e.message}`); }
      }
      if (aborted) break;
    }
    writeSummary(outRoot);
    reportLeaks(outRoot, staged.values);
    if (aborted) process.exitCode = 1;
    console.log(`results: ${outRoot}`);
  } finally {
    cleanup();
  }
}

// Re-runs post-verification from the committed bundles, then rewrites run.json, report.md and summary.md.
async function verify(harnessDir, trialId) {
  if (!existsSync(path.join(harnessDir, 'run.json'))) fail(`${harnessDir}: no run.json — pass a harness dir, e.g. docs/adw-e2e/<ts>/<task>/<harness>`);
  const record = readRun(harnessDir);
  if (record.schema !== 2) fail(`${harnessDir}: schema ${record.schema ?? 1} runs have no bundles to re-verify`);
  const name = path.basename(path.dirname(harnessDir));
  if (record.task !== name) fail(`${harnessDir}: run.json records task ${record.task ?? '(none)'}, but the path says ${name}`);
  if (!Object.hasOwn(config.tasks, name)) fail(`${harnessDir}: task ${name} is not in config.tasks`);
  if (trialId && !record.trials.some((t) => t.id === trialId)) fail(`no trial ${trialId} in ${harnessDir}`);
  const task = loadTask(name);
  const image = buildTaskImage({ config, task: name });
  const staged = stageClaude(`verify-${timestamp()}`);
  try {
    const verified = new Map();
    for (const t of record.trials) {
      if (trialId && t.id !== trialId) continue;
      const ev = path.join(harnessDir, 'evidence', t.id);
      const bundle = path.join(ev, 'pr-head.bundle');
      if (!existsSync(bundle)) { console.log(`- ${t.id}: no bundle (no PR head), kept as is`); continue; }
      console.log(`▶ verify ${name} · ${t.id}`);
      const pv = postVerifyTrial(task, bundle, ev, staged.env, image);
      await tick();
      if (isQuota(pv.verifierError) || isQuota(pv.reviewError)) {
        console.error(`✗ subscription usage limit reached in ${t.id}: nothing written, rerun after the reset`);
        process.exitCode = 1;
        return;
      }
      verified.set(t.id, pv);
      console.log(`  ${acLine(pv)}`);
    }
    for (const [id, pv] of verified) writeVerdicts(path.join(harnessDir, 'evidence', id), pv);
    const trials = record.trials.map((t) => (verified.has(t.id) ? applyPostVerification(t, verified.get(t.id)) : t));
    writeRun(harnessDir, { ...record, calibration: task.calibration(), trials, summary: summarizeTrials(trials),
      fingerprint: { ...record.fingerprint, verifierHash: task.hash,
        models: { ...record.fingerprint.models, verifier: config.verifier.model, review: config.review.model } } });
    writeSummary(path.dirname(path.dirname(harnessDir)));
    reportLeaks(harnessDir, staged.values);
    console.log(`verified: ${harnessDir}`);
  } finally {
    staged.cleanup();
  }
}

// Judges one task's known patch variants (e2e/tasks/<task>/calibration) against expected.json.
// Returns false when a usage limit stopped it (nothing written for this task).
async function calibrateTask(task, { runs, ts, work, staged }) {
  const calDir = path.join(task.dir, 'calibration');
  const expected = JSON.parse(readFileSync(path.join(calDir, 'expected.json'), 'utf8'));
  const spec = readFileSync(path.join(calDir, 'spec.md'), 'utf8');
  const summary = readFileSync(path.join(calDir, 'summary.md'), 'utf8');
  const bundles = Object.fromEntries(Object.keys(expected).map((variant) => {
    const out = path.join(work, `${task.name}-${variant}.bundle`);
    createCalibrationBundle({ root: config.root, seedRepo: task.seed, patch: path.join(calDir, `${variant}.patch`), out, name: task.name });
    return [variant, out];
  }));
  const results = Object.fromEntries(Object.keys(expected).map((v) => [v, []]));
  for (let i = 1; i <= runs; i++) {
    for (const [variant, bundle] of Object.entries(bundles)) {
      console.log(`▶ ${task.name} · ${variant} (run ${i}/${runs})`);
      const pv = postVerify({ config, bundle, criteria: task.criteria, spec, summary, env: staged.env, image: task.image });
      await tick();
      if (isQuota(pv.verifierError) || isQuota(pv.reviewError)) {
        console.error(`✗ subscription usage limit reached: calibration of ${task.name} aborted, nothing written for it`);
        process.exitCode = 1;
        return false;
      }
      results[variant].push(pv);
      console.log(`  ${acLine(pv)}${pv.verifierError ? ` · verifier: ${pv.verifierError}` : ''}${pv.reviewError ? ` · review: ${pv.reviewError}` : ''}`);
    }
  }
  const evaluation = evaluateCalibration({ expected, results, criteria: task.criteria, rubric: config.review.criteria });
  const cal = { schema: 1, task: task.name, ts, hash: task.hash, pass: evaluation.pass, runs,
    models: { verifier: config.verifier.model, review: config.review.model },
    findings: evaluation.findings, reviewMedians: evaluation.reviewMedians, variants: results };
  const out = path.join(task.calibrationDir, ts);
  writeResult(path.join(out, 'calibration.json'), `${JSON.stringify(cal, null, 2)}\n`);
  writeResult(path.join(out, 'report.md'), renderCalibrationReport(cal));
  reportLeaks(out, staged.values);
  console.log(`calibration of ${task.name} ${cal.pass ? 'passed' : 'FAILED'}: ${out}`);
  if (!cal.pass) process.exitCode = 1;
  return true;
}

async function calibrate() {
  const runs = Number(opts.runs ?? 2);
  const selected = tasks.map(loadTask);
  for (const t of selected) t.image = buildTaskImage({ config, task: t.name });
  const ts = timestamp();
  let work;
  const staged = stageClaude(`calibrate-${ts}`, () => work && rmSync(work, { recursive: true, force: true }));
  work = mkdtempSync(path.join(tmpdir(), 'adw-calibrate-'));
  try {
    for (const t of selected) {
      if (!(await calibrateTask(t, { runs, ts, work, staged }))) return;
    }
  } finally {
    staged.cleanup();
    rmSync(work, { recursive: true, force: true });
  }
}

// An interrupt that propagates out of post-verification has already run the finally blocks (staged
// secrets, work dir); nothing was written for the interrupted trial.
try {
  if (command === 'preflight') process.exit(preflight() ? 0 : 1);
  else if (command === 'run') await run();
  else if (command === 'verify' && rest.length === 1) await verify(path.resolve(rest[0]), opts.trial);
  else if (command === 'calibrate' && rest.length === 0) await calibrate();
  else if (command === 'compare' && rest.length === 2) compareDirs(path.resolve(rest[0]), path.resolve(rest[1]));
  else if (command === 'report' && rest.length === 1) {
    const r = JSON.parse(readFileSync(path.join(rest[0], 'run.json'), 'utf8'));
    writeFileSync(path.join(rest[0], 'report.md'), renderRunReport(r));
  } else {
    console.error('usage: node e2e/run.mjs preflight [--task t]... | run [--harness h]... [--task t]... [--repetitions n] | verify <harnessDir> [--trial id] | calibrate [--task t]... [--runs n] | compare <baseDir> <candDir> | report <harnessDir>');
    process.exit(2);
  }
} catch (e) {
  if (!isInterrupt(e)) throw e;
  console.error(`✗ ${e.message}: stopped, nothing written for the interrupted trial`);
  process.exit(e.signal === 'SIGTERM' ? 143 : 130);
}
```

- [ ] **Step 2: Move the passing Node calibration**

```bash
mkdir -p docs/adw-e2e/calibration/demo-todo
git mv docs/adw-e2e/calibration/2026-10-12T1323Z docs/adw-e2e/calibration/demo-todo/2026-10-12T1323Z
```

It stays valid: the verifier hash depends on prompts, tools, models, rubric and criteria, none of which change.

- [ ] **Step 3: `docs/adw-e2e/README.md`**

Replace lines 33–38 (the command block under "## Run") with:

```
    node e2e/run.mjs preflight
    node e2e/run.mjs run                        # every task × harness, 3 trials each
    node e2e/run.mjs run --harness codex --task demo-todo --repetitions 1
    node e2e/run.mjs compare docs/adw-e2e/<old>/<task>/codex docs/adw-e2e/<new>/<task>/codex
    node e2e/run.mjs verify docs/adw-e2e/<ts>/<task>/<harness> [--trial <id>]   # re-judge stored PR heads, no agent run
    node e2e/run.mjs calibrate [--task <task>] [--runs 2]   # judge the known variants per task; needed after any verifier change
```

In the paragraph after it replace `a calibration adds 20. A full run can exhaust the subscription's 5-hour limit: split it per harness across limit windows.` with `a calibration adds 20 per task. A full run (every task × harness) can exhaust the subscription's 5-hour limit: run one harness per limit window (\`--harness\`); it covers every task.` and replace `A \`verify\` or \`calibrate\` that hits a limit writes nothing.` with `A \`verify\` that hits a limit writes nothing; a \`calibrate\` that hits it writes nothing for the task it was on (earlier tasks keep their result).`

Replace `Raw Harbor output: \`e2e/jobs/<ts>/\`` with `Raw Harbor output: \`e2e/jobs/<ts>/<task>/\``, and in the `npm test` line replace `the verifier's \`checks.test.mjs\`` with `the verifier's \`e2e/tasks/_shared/tests/checks.test.mjs\``.

Under "## Read the results" replace `` `docs/adw-e2e/<ts>/<harness>/`: `` with `` `docs/adw-e2e/<ts>/<task>/<harness>/`: ``; replace `The baseline is the newest earlier result on \`main\`.` with `The baseline is the newest earlier result of the same task and harness on \`main\`.`; replace `` `summary.md` puts the harnesses side by side. `` with `` `docs/adw-e2e/<ts>/summary.md` puts tasks and harnesses side by side. ``; replace `` `docs/adw-e2e/calibration/<ts>/`: calibration verdicts `` with `` `docs/adw-e2e/calibration/<task>/<ts>/`: calibration verdicts per task ``.

In the signal table replace `` (`e2e/tasks/<task>/acceptance-criteria.md`) `` with `` (`e2e/tasks/_shared/acceptance-criteria.md`) ``.

Under "## Changing the test" add as the first bullet:

```markdown
- Task files: `e2e/tasks/_shared/` holds everything stack-neutral (instruction, persona, bridge prompt,
  acceptance criteria, the container verifier, Gitea seeding, calibration expectations, spec and summary).
  `e2e/tasks/<task>/` holds only what is stack-specific: `task.toml`, `environment/Dockerfile`, the seed repo and
  the calibration patches. The runner mirrors `_shared/` into each task before use (git-ignored copies): edit
  only `_shared/`; a shared file that is also tracked in a task stops the run.
```

- [ ] **Step 4: `AGENTS.md`** — in the "E2E self-test (`e2e/`)" paragraph replace `in all three harnesses with a
simulated user and a throwaway Gitea; results land in \`docs/adw-e2e/<ts>/\`.` with `in all three harnesses and on every task in \`config.tasks\` with a simulated user and a throwaway Gitea; results land in \`docs/adw-e2e/<ts>/<task>/<harness>/\`. Stack-neutral task files live once in \`e2e/tasks/_shared/\` and are mirrored into each task (git-ignored copies).` Re-wrap the paragraph at ~100 columns like its neighbours.

- [ ] **Step 5: Smoke checks (no LLM, no Docker)**

```bash
node --check e2e/run.mjs
node e2e/run.mjs; echo "exit $?"                                   # usage line, exit 2
node e2e/run.mjs calibrate --task nope; echo "exit $?"             # ✗ unknown task: nope (known: demo-todo), exit 2
node e2e/run.mjs verify docs/adw-e2e; echo "exit $?"               # ✗ …: no run.json — pass a harness dir, e.g. docs/adw-e2e/<ts>/<task>/<harness>, exit 2
S=$(mktemp -d)
mkdir -p $S/a/demo-todo/codex $S/b/other/codex $S/c/wrong/codex
echo '{"schema":2,"task":"demo-todo","harness":"codex"}' > $S/a/demo-todo/codex/run.json
echo '{"schema":2,"task":"other","harness":"codex"}' > $S/b/other/codex/run.json
echo '{"schema":2,"task":"demo-todo","harness":"codex","trials":[]}' > $S/c/wrong/codex/run.json
node e2e/run.mjs compare $S/a/demo-todo/codex $S/b/other/codex; echo "exit $?"   # ✗ only runs of the same task can be compared: …, exit 2
node e2e/run.mjs verify $S/c/wrong/codex; echo "exit $?"           # ✗ …: run.json records task demo-todo, but the path says wrong, exit 2
rm -rf $S
```

Record each output line and exit code in the report. All must exit 2 with the messages shown.

- [ ] **Step 6: Docker plumbing (no LLM)** — the mirrored files must reach the image build context:

```bash
node --input-type=module -e "const {loadConfig}=await import('./e2e/lib/config.mjs');const {prepareTaskDir}=await import('./e2e/lib/tasks.mjs');console.log(prepareTaskDir(loadConfig(),'demo-todo').length)"
docker build -q -t adw-e2e-demo-todo -f e2e/tasks/demo-todo/environment/Dockerfile e2e/tasks/demo-todo/environment
git status --short   # must not list any mirrored copy
```

Expected: `16`, an image id, and a clean `git status` apart from this task's own changes.

- [ ] **Step 7: Run the suite** — `npm test`: all green.

- [ ] **Step 8: Commit**

```bash
git add e2e/run.mjs docs/adw-e2e/README.md AGENTS.md docs/adw-e2e/calibration
git commit -m "feat(e2e): the runner loops harness × task with per-task results, calibrations, verify and compare

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xt655q14GXqAK7gQKxf525"
```

---

### Task 5: The `demo-todo-dotnet` task: seed app, task image, `task.toml`

**Files:**
- Create: `e2e/tasks/demo-todo-dotnet/task.toml`, `e2e/tasks/demo-todo-dotnet/environment/Dockerfile`, `e2e/tasks/demo-todo-dotnet/environment/seed/repo/**` (Appendix A, plus two files taken from the .NET template)

**Interfaces:**
- Consumes: `prepareTaskDir` (Task 1), `buildTaskImage({ config, task })` (Task 2), the mirrored `_shared/` files (Task 3) — `environment/seed/{issue.md,seed.sh}` reach the build context through the mirror.
- Produces: a buildable task image `adw-e2e-demo-todo-dotnet` whose `/workspace` is the seed app; `dotnet test` passes (9 tests) offline from the warm NuGet cache. The task is **not** in `config.tasks` yet (Task 6 adds it together with its calibration patches, which the repository check requires).

The seed app was built and verified before this plan was written (Docker, no LLM): 9/9 tests in `ai-dev-workflow-dotnet:latest` (SDK 10.0.401) and offline in the task image; each checkout builds into its own `bin/`/`obj/`; the five variants of Task 6 pass their own tests and the oracle. Transcribe it exactly — byte-exact via the extractor below, never by hand.

Rulings beyond the spec's wording (made while prototyping; reviewers should not flag them):
- The task image sets `ENV ArtifactsPath=`: the base image's shared `/home/dev/artifacts` is keyed by project name only, so the agent's checkout, its worktrees and the verifier's clone of the PR head would share build output in one container (observed: parallel builds of two checkouts ran the wrong tests). Every checkout builds into its own git-ignored `bin/`/`obj/`.
- The seed `AGENTS.md` carries two stack facts the Node one does not need: JSON bodies need `Content-Type: application/json` (otherwise the template answers 400 with an antiforgery message, which a careless AC3 check would mistake for validation), and the page is interactive only after its Blazor circuit has connected (without waiting, clicks are lost: the reference failed AC7 3/3 in the oracle).
- `task.toml` raises the verifier timeout to 900 s and the build timeout to 1800 s for .NET builds, besides the spec's agent timeout of 2700 s.

- [ ] **Step 1: Save the extractor** (a scratch tool, never committed): `S=$(mktemp -d)`, then write `$S/extract.mjs`:

```js
// Writes every "#### `path`" + four-backtick block of one plan appendix below outDir, byte-exact.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [plan, heading, outDir] = process.argv.slice(2);
const text = readFileSync(plan, 'utf8');
const start = text.indexOf(`\n## ${heading}\n`);
if (start < 0) throw new Error(`no appendix "${heading}"`);
const end = text.indexOf('\n## Appendix ', start + 1); // appendix bodies contain their own '## ' lines
const section = text.slice(start, end < 0 ? undefined : end);
let n = 0;
for (const [, file, body] of section.matchAll(/^#### `([^`]+)`\n\n````[a-z]*\n([\s\S]*?)\n````$/gm)) {
  const out = path.join(outDir, file);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${body}\n`);
  n++;
}
console.log(`${n} files`);
```

- [ ] **Step 2: Write the seed repo from Appendix A**

```bash
D=e2e/tasks/demo-todo-dotnet/environment/seed/repo
node $S/extract.mjs docs/superpowers/plans/2026-10-12-adw-e2e-dotnet-task.md "Appendix A: .NET seed repo" $D
```

Expected: `28 files`.

- [ ] **Step 3: Add the two template files** (binary favicon and the 230 KB Bootstrap stylesheet) from the standard template of the pinned SDK, and check their hashes:

```bash
T=$(mktemp -d)
docker run --rm -e AGENT_TOOLSTACK_ONLY=1 -e PROJECT_ROOT=/workspace -e HOST_UID=$(id -u) -e HOST_GID=$(id -g) -v $T:/workspace \
  ai-dev-workflow-dotnet:latest bash -lc 'cd /workspace && dotnet --version && dotnet new blazor --interactivity Server -n DemoTodo -o src/DemoTodo >/dev/null'
mkdir -p $D/src/DemoTodo/wwwroot/lib/bootstrap/dist/css
cp $T/src/DemoTodo/wwwroot/favicon.png $D/src/DemoTodo/wwwroot/favicon.png
cp $T/src/DemoTodo/wwwroot/lib/bootstrap/dist/css/bootstrap.min.css $D/src/DemoTodo/wwwroot/lib/bootstrap/dist/css/bootstrap.min.css
sha256sum $D/src/DemoTodo/wwwroot/favicon.png $D/src/DemoTodo/wwwroot/lib/bootstrap/dist/css/bootstrap.min.css
```

Expected: `10.0.401`, then exactly
```
e265ac0f2dda1e5dfa65b1adf330722bb3ef7789115283604d8cd19f098f1f08  …/favicon.png
3c8f27e6009ccfd710a905e6dcf12d0ee3c6f2ac7da05b0572d3e0d12e736fc8  …/bootstrap.min.css
```
Only these two files come from the template (the template's other dist files are unreferenced and stay out); everything else is Appendix A.

- [ ] **Step 4: `e2e/tasks/demo-todo-dotnet/task.toml`**

```toml
schema_version = "1.4"
artifacts = []

[task]
name = "adw/demo-todo-dotnet"
version = "1.0.0"
description = "agent-dev end-to-end on .NET: due dates in API and Blazor Server list page via a Gitea ticket"
authors = []
keywords = ["adw", "e2e", "dotnet"]

[metadata]

[verifier]
timeout_sec = 900.0
collect = []

[verifier.env]
TEST_COMMAND = "dotnet test"

[agent]
timeout_sec = 2700.0
user = "dev"

[environment]
network_mode = "public"
build_timeout_sec = 1800.0
os = "linux"
workdir = "/workspace"
mcp_servers = []

[environment.env]

[solution.env]
```

(Versus the Node task: name, description, keywords, `TEST_COMMAND`, agent timeout 2700 s per the spec, and longer verifier/build timeouts for .NET builds.)

- [ ] **Step 5: `e2e/tasks/demo-todo-dotnet/environment/Dockerfile`** — write exactly:

````dockerfile
# E2E task image: the workflow image plus E2E-only tooling. The product image stays unchanged.
FROM ai-dev-workflow-dotnet:latest
ARG TEA_VERSION=0.15.1
RUN curl -fsSL -o /usr/local/bin/tea "https://dl.gitea.com/tea/${TEA_VERSION}/tea-${TEA_VERSION}-linux-amd64" \
    && chmod 0755 /usr/local/bin/tea \
    # Harbor npm-installs its ACP bridge/adapters as the agent user at runtime: preinstall the
    # versions Harbor 0.24.0 pins and let the agent user own the global prefix.
    && npm install -g acpx@0.11.2 @zed-industries/claude-code-acp@0.16.2 @agentclientprotocol/codex-acp@1.12.0 \
    && chown -R 1000:1000 /usr/local/lib/node_modules /usr/local/bin \
    && mkdir -p /workspace /opt/e2e && chown 1000:1000 /workspace
COPY --chown=1000:1000 seed/repo /workspace
# Every checkout builds into its own bin/ and obj/ (git-ignored): the agent may build /workspace and
# worktrees, and the verifier a clone of the PR head, in this one container. The base image's shared
# ArtifactsPath is keyed by project name only, so parallel builds of two checkouts would collide.
ENV ArtifactsPath=
# Warm NuGet cache: restore the seed as the agent user, so the agent's builds, its own tests and the
# verifier need no package download. Packages land in NUGET_PACKAGES (/home/dev/.nuget/packages). The
# restore runs in a throwaway copy, so /workspace ships without obj/ (the entrypoint warns about
# in-tree build output it finds at start).
USER 1000:1000
RUN d="$(mktemp -d)" && cp -r /workspace/. "$d" && cd "$d" && HOME=/home/dev dotnet restore DemoTodo.slnx \
    && cd / && rm -rf "$d"
USER root
COPY seed/issue.md /opt/e2e/issue.md
COPY seed/seed.sh /usr/local/lib/agent-runtime/startup.d/50-e2e-seed
RUN chmod 0755 /usr/local/lib/agent-runtime/startup.d/50-e2e-seed
ENV PROJECT_ROOT=/workspace
WORKDIR /workspace
HEALTHCHECK --interval=3s --timeout=3s --retries=100 CMD test -f /tmp/e2e-ready
````

- [ ] **Step 6: Docker check (no LLM)** — mirror `_shared/`, build the real task image, and run the seed's tests offline in a copy of `/workspace`:

```bash
node --input-type=module -e "const {loadConfig}=await import('./e2e/lib/config.mjs');const {prepareTaskDir}=await import('./e2e/lib/tasks.mjs');console.log(prepareTaskDir(loadConfig(),'demo-todo-dotnet').length)"
node --input-type=module -e "const {loadConfig}=await import('./e2e/lib/config.mjs');const {buildTaskImage}=await import('./e2e/lib/postverify.mjs');console.log(buildTaskImage({config:loadConfig(),task:'demo-todo-dotnet'}))"
docker run --rm --network none -e E2E_VERIFY=1 -e AGENT_TOOLSTACK_ONLY=1 -e HOST_UID=$(id -u) -e HOST_GID=$(id -g) adw-e2e-demo-todo-dotnet bash -lc \
  'd=$(mktemp -d) && cp -r /workspace/. $d && cd $d && git init -q && git add -A && git -c user.name=x -c user.email=x@x commit -qm s && dotnet test 2>&1 | grep -E "Passed!|Failed!|error" ; echo "status: <$(git status --porcelain)>"; ls -d /home/dev/artifacts 2>/dev/null || echo "no shared artifacts"'
git status --short
```

Expected: `16`; `adw-e2e-demo-todo-dotnet`; a `Passed!` line with `Failed: 0` and `Passed: 9` (the numbers are space-padded); `status: <>` (build output is git-ignored); `no shared artifacts`; and `git status --short` lists only the new task files (no mirrored copies, no `bin/`/`obj/`).

- [ ] **Step 7: Run the suite** — `npm test`: all green (the repository checks do not see the task until Task 6 adds it to `config.tasks`).

- [ ] **Step 8: Commit**

```bash
git add e2e/tasks/demo-todo-dotnet/task.toml e2e/tasks/demo-todo-dotnet/environment/Dockerfile e2e/tasks/demo-todo-dotnet/environment/seed/repo
git status --short   # only those paths staged
git commit -m "feat(e2e): demo-todo-dotnet task — Blazor Server seed app, task image with a warm NuGet cache

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xt655q14GXqAK7gQKxf525"
```

---

### Task 6: .NET calibration variants; the task joins `config.tasks`; docs

**Files:**
- Create: `e2e/tasks/demo-todo-dotnet/calibration/{reference,alt-interface,broken-done,broken-ui,messy}.patch` (Appendix B)
- Modify: `e2e/config.json` (`tasks`), `docs/adw-e2e/README.md`, `AGENTS.md`

**Interfaces:**
- Consumes: Task 5's seed app and image; `createCalibrationBundle({ …, name })`, `checkoutBundle` (Task 2 / existing); `_shared/calibration/expected.json` (unchanged: the variants keep the Node intent).
- Produces: `config.tasks["demo-todo-dotnet"] = { "baseImage": "ai-dev-workflow-dotnet:latest" }`; every `run`/`calibrate` now covers both tasks.

Variant intent (identical to the Node task): **reference** — clean solution, store + HTTP + page tests (26 tests); **alt-interface** — field `due`, query `?overdue=1` (14 tests); **broken-done** — done todos still count as overdue in the API filter only, so only AC4 fails (21 tests); **broken-ui** — no overdue marker and a filter control that does nothing, so AC6 and AC7 fail (21 tests); **messy** — works, but logic in the endpoints, no new tests, an existing assertion weakened (9 tests).

- [ ] **Step 1: Write the patches from Appendix B**

```bash
node $S/extract.mjs docs/superpowers/plans/2026-10-12-adw-e2e-dotnet-task.md "Appendix B: .NET calibration patches" e2e/tasks/demo-todo-dotnet/calibration
```

Expected: `5 files`. (`$S/extract.mjs` from Task 5 Step 1; recreate it if `$S` is gone.)

- [ ] **Step 2: `e2e/config.json`** — `tasks` becomes:

```json
  "tasks": {
    "demo-todo": { "baseImage": "ai-dev-workflow-node:latest" },
    "demo-todo-dotnet": { "baseImage": "ai-dev-workflow-dotnet:latest" }
  },
```

- [ ] **Step 3: Verify every variant (Docker, no LLM)** — write Appendix C (the deterministic Playwright oracle and the verify script) to `$S`, then run it:

```bash
node $S/extract.mjs docs/superpowers/plans/2026-10-12-adw-e2e-dotnet-task.md "Appendix C: .NET oracle and verify script" $S
bash $S/verify-dotnet.sh
```

It (1) runs the seed's tests in `ai-dev-workflow-dotnet:latest`, (2) builds the task image from the task's Dockerfile and seed and proves offline per-checkout build output, (3) builds each variant with the real `createCalibrationBundle` + `checkoutBundle`, runs its own tests offline in the task image, tests two checkouts in parallel, runs the oracle, and (4) compares. Expected verdict lines, exactly (each is followed by two `[oracle]` log lines, and the script ends with `ALL VARIANTS AS EXPECTED`):

```
reference {"AC1":true,"AC2":true,"AC3":true,"AC4":true,"AC5":true,"AC6":true,"AC7":true}
broken-done {"AC1":true,"AC2":true,"AC3":true,"AC4":false,"AC5":true,"AC6":true,"AC7":true}
broken-ui {"AC1":true,"AC2":true,"AC3":true,"AC4":true,"AC5":true,"AC6":false,"AC7":false}
messy {"AC1":true,"AC2":true,"AC3":true,"AC4":true,"AC5":true,"AC6":true,"AC7":true}
alt-interface {"AC1":true,"AC2":true,"AC3":true,"AC4":true,"AC5":true,"AC6":true,"AC7":true}
seed-oracle {"AC1":false,"AC2":false,"AC3":false,"AC4":false,"AC5":false,"AC6":false,"AC7":false}
```

and per-variant test counts reference 26, broken-done 21, broken-ui 21, alt-interface 14, messy 9 (all passed); parallel rounds 9 and 26. Record the full output in the report. The oracle and script are throwaway and are not committed. (The Node patches are unchanged by this plan, so the Node oracle is not re-run.)

- [ ] **Step 4: Docs**

`docs/adw-e2e/README.md` — replace the first paragraph's `against the
\`demo-todo\` task (a todo API + list page, ticket #1 in a throwaway Gitea), scores every trial and
compares result sets.` with `against two tasks with the same ticket (#1 in a throwaway Gitea): \`demo-todo\`, a Node
todo API with a list page, and \`demo-todo-dotnet\`, the same app as a .NET 10 Blazor Server app with a minimal API. It
scores every trial and compares result sets.` (re-wrap at ~100 columns), and add a line after the agentic-verification
spec reference: `.NET task: \`docs/superpowers/specs/2026-10-12-adw-e2e-dotnet-task-design.md\`.` Under "Prerequisites"
replace `Docker, and the local image: \`node docker/build.mjs\`` with `Docker, and the local images: \`node docker/build.mjs\` (builds \`ai-dev-workflow-node\` and \`ai-dev-workflow-dotnet\`)`.

`AGENTS.md` — in the "E2E self-test (`e2e/`)" paragraph (re-wrapped in Task 4, so the phrase may span a line break) replace `on every task in \`config.tasks\`` with `on every task in \`config.tasks\` (\`demo-todo\` in Node, \`demo-todo-dotnet\` in Blazor Server)` and re-wrap.

- [ ] **Step 5: Run the suite** — `npm test`: all green. The repository checks now cover `demo-todo-dotnet` (task files, five patches, Dockerfile `FROM ai-dev-workflow-dotnet:latest`, mirrored copies ignored).

- [ ] **Step 6: Smoke (no LLM)** — `node e2e/run.mjs calibrate --task nope; echo "exit $?"` now lists `(known: demo-todo, demo-todo-dotnet)`, exit 2.

- [ ] **Step 7: Commit**

```bash
git add e2e/tasks/demo-todo-dotnet/calibration e2e/config.json docs/adw-e2e/README.md AGENTS.md
git commit -m "feat(e2e): demo-todo-dotnet calibration variants; every run covers both tasks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xt655q14GXqAK7gQKxf525"
```

---

### Task 7: Live acceptance (only with the user's consent)

These steps use the Claude subscription. **Stop and ask the user before each live step**, naming the cost:
- calibrate one task: about 20 Sonnet runs (5 variants × 2 runs × verifier + review);
- one claude-code trial: one Opus agent run (Sonnet subagents), a Sonnet simulated user, 2 Sonnet runs;
- verify one trial: 2 Sonnet runs.

- [ ] **Step 1: Ask, then run** `node e2e/run.mjs calibrate --task demo-todo-dotnet`.
  - Expected: `calibration of demo-todo-dotnet passed: docs/adw-e2e/calibration/demo-todo-dotnet/<ts>`.
  - On `wrong` or `flaky`: read `report.md` and the evidence in `calibration.json` and debug with superpowers:systematic-debugging. A prompt change alters the verifier hash and invalidates the Node calibration too — then ask before recalibrating both.
  - Commit the passing calibration: `git add docs/adw-e2e/calibration/demo-todo-dotnet/<ts>` and `git commit -m "test(e2e): demo-todo-dotnet verifier calibration"` with the trailer lines.
- [ ] **Step 2: Ask, then run** `node e2e/run.mjs run --harness claude-code --task demo-todo-dotnet --repetitions 1`. Check:
  - `docs/adw-e2e/<ts>/demo-todo-dotnet/claude-code/evidence/claude-code-1/acceptance.json` holds 7 verdicts with concrete evidence;
  - `review.json` holds 6 scores with reasons; `own-tests.txt` shows `dotnet test` output;
  - `report.md` is titled `# E2E demo-todo-dotnet · claude-code` and shows `Verifier calibration: \`<ts>\``.
- [ ] **Step 3: Ask, then run** `node e2e/run.mjs verify docs/adw-e2e/<ts>/demo-todo-dotnet/claude-code`. Expected: the same per-AC verdicts as Step 2; report any difference as verifier variance with both evidence texts.
- [ ] **Step 4: Report to the user** — the calibration result, the trial's verdicts and metrics (agent time, tokens) next to the Node trial of 2026-10-12 (612 s, 5.5 M tokens), whether `verify` reproduced them, and the open next step: the baseline on `main` (3 trials per task × harness, one harness per limit window). Ask whether to commit the trial result (one trial is not a baseline) and whether to push.

---

## Appendix A: .NET seed repo

Paths are relative to `e2e/tasks/demo-todo-dotnet/environment/seed/repo/`. `src/DemoTodo/wwwroot/favicon.png` and `src/DemoTodo/wwwroot/lib/bootstrap/dist/css/bootstrap.min.css` are not here: Task 5 Step 3 takes them from the SDK template.

#### `.gitignore`

````text
bin/
obj/
artifacts/
TestResults/
````

#### `AGENTS.md`

````markdown
# AGENTS.md

demo-todo: a .NET 10 Blazor Web App (interactive server render mode) with a minimal JSON API for
todos (in-memory store) and a list page.

## Commands

```bash
dotnet test                                                     # xUnit, from the repo root
dotnet run --project src/DemoTodo --urls http://localhost:3000  # list page at http://localhost:3000/
```

## Layout

- `src/DemoTodo/TodoStore.cs`: the in-memory store, a singleton shared by the API and the page.
- `src/DemoTodo/Program.cs`: the JSON API (`/todos`, `/health`).
- `src/DemoTodo/Components/Pages/Home.razor`: the todo list at `/`. It injects `TodoStore` and calls it
  directly over the Blazor circuit; it never calls the app's own HTTP API.
- `tests/DemoTodo.Tests/`: store tests, and API and page tests through `WebApplicationFactory<Program>`.

## Conventions

- No new NuGet packages.
- Validation errors are `System.ComponentModel.DataAnnotations.ValidationException`, thrown by
  `TodoStore`; `Program.cs` maps them to HTTP 400 `{"error": "..."}`.
- TDD: write a failing test in `tests/` first.
- Every UI element tests rely on carries a `data-testid` attribute; give new elements one too.

## End-to-end testing

- Services: none besides the app itself.
- Start: `dotnet run --project src/DemoTodo --urls http://localhost:3000 &` from the repo root (it
  builds first; allow up to a minute).
- Readiness: `GET http://localhost:3000/health` returns `{"ok":true}`.
- Base URL: `http://localhost:3000` — the todo list page is `/`; the JSON API is under `/todos`.
- Request bodies are JSON and need `Content-Type: application/json`.
- Locators: existing `data-testid`s are `todo-list`, `todo-item`, `todo-title`.
- The page is prerendered and becomes interactive once its Blazor circuit has connected, about a
  second after loading; wait for that before clicking.
- Drive the UI with the Playwright MCP tools; save screenshots outside the repository.
- Stop: kill the background `dotnet run` process.
````

#### `DemoTodo.slnx`

````xml
<Solution>
  <Folder Name="/src/">
    <Project Path="src/DemoTodo/DemoTodo.csproj" />
  </Folder>
  <Folder Name="/tests/">
    <Project Path="tests/DemoTodo.Tests/DemoTodo.Tests.csproj" />
  </Folder>
</Solution>
````

#### `src/DemoTodo/Components/App.razor`

````razor
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <base href="/" />
    <ResourcePreloader />
    <link rel="stylesheet" href="@Assets["lib/bootstrap/dist/css/bootstrap.min.css"]" />
    <link rel="stylesheet" href="@Assets["app.css"]" />
    <link rel="stylesheet" href="@Assets["DemoTodo.styles.css"]" />
    <ImportMap />
    <link rel="icon" type="image/png" href="favicon.png" />
    <HeadOutlet />
</head>

<body>
    <Routes />
    <ReconnectModal />
    <script src="@Assets["_framework/blazor.web.js"]"></script>
</body>

</html>
````

#### `src/DemoTodo/Components/Layout/MainLayout.razor`

````razor
@inherits LayoutComponentBase

<div class="page">
    <div class="sidebar">
        <NavMenu />
    </div>

    <main>
        <div class="top-row px-4">
            <a href="https://learn.microsoft.com/aspnet/core/" target="_blank">About</a>
        </div>

        <article class="content px-4">
            @Body
        </article>
    </main>
</div>

<div id="blazor-error-ui" data-nosnippet>
    An unhandled error has occurred.
    <a href="." class="reload">Reload</a>
    <span class="dismiss">🗙</span>
</div>
````

#### `src/DemoTodo/Components/Layout/MainLayout.razor.css`

````css
.page {
    position: relative;
    display: flex;
    flex-direction: column;
}

main {
    flex: 1;
}

.sidebar {
    background-image: linear-gradient(180deg, rgb(5, 39, 103) 0%, #3a0647 70%);
}

.top-row {
    background-color: #f7f7f7;
    border-bottom: 1px solid #d6d5d5;
    justify-content: flex-end;
    height: 3.5rem;
    display: flex;
    align-items: center;
}

    .top-row ::deep a, .top-row ::deep .btn-link {
        white-space: nowrap;
        margin-left: 1.5rem;
        text-decoration: none;
    }

    .top-row ::deep a:hover, .top-row ::deep .btn-link:hover {
        text-decoration: underline;
    }

    .top-row ::deep a:first-child {
        overflow: hidden;
        text-overflow: ellipsis;
    }

@media (max-width: 640.98px) {
    .top-row {
        justify-content: space-between;
    }

    .top-row ::deep a, .top-row ::deep .btn-link {
        margin-left: 0;
    }
}

@media (min-width: 641px) {
    .page {
        flex-direction: row;
    }

    .sidebar {
        width: 250px;
        height: 100vh;
        position: sticky;
        top: 0;
    }

    .top-row {
        position: sticky;
        top: 0;
        z-index: 1;
    }

    .top-row.auth ::deep a:first-child {
        flex: 1;
        text-align: right;
        width: 0;
    }

    .top-row, article {
        padding-left: 2rem !important;
        padding-right: 1.5rem !important;
    }
}

#blazor-error-ui {
    color-scheme: light only;
    background: lightyellow;
    bottom: 0;
    box-shadow: 0 -1px 2px rgba(0, 0, 0, 0.2);
    box-sizing: border-box;
    display: none;
    left: 0;
    padding: 0.6rem 1.25rem 0.7rem 1.25rem;
    position: fixed;
    width: 100%;
    z-index: 1000;
}

    #blazor-error-ui .dismiss {
        cursor: pointer;
        position: absolute;
        right: 0.75rem;
        top: 0.5rem;
    }
````

#### `src/DemoTodo/Components/Layout/NavMenu.razor`

````razor
<div class="top-row ps-3 navbar navbar-dark">
    <div class="container-fluid">
        <a class="navbar-brand" href="">DemoTodo</a>
    </div>
</div>

<input type="checkbox" title="Navigation menu" class="navbar-toggler" />

<div class="nav-scrollable" onclick="document.querySelector('.navbar-toggler').click()">
    <nav class="nav flex-column">
        <div class="nav-item px-3">
            <NavLink class="nav-link" href="" Match="NavLinkMatch.All">
                <span class="bi bi-house-door-fill-nav-menu" aria-hidden="true"></span> Home
            </NavLink>
        </div>

        <div class="nav-item px-3">
            <NavLink class="nav-link" href="counter">
                <span class="bi bi-plus-square-fill-nav-menu" aria-hidden="true"></span> Counter
            </NavLink>
        </div>

        <div class="nav-item px-3">
            <NavLink class="nav-link" href="weather">
                <span class="bi bi-list-nested-nav-menu" aria-hidden="true"></span> Weather
            </NavLink>
        </div>
    </nav>
</div>

````

#### `src/DemoTodo/Components/Layout/NavMenu.razor.css`

````css
.navbar-toggler {
    appearance: none;
    cursor: pointer;
    width: 3.5rem;
    height: 2.5rem;
    color: white;
    position: absolute;
    top: 0.5rem;
    right: 1rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 30 30'%3e%3cpath stroke='rgba%28255, 255, 255, 0.55%29' stroke-linecap='round' stroke-miterlimit='10' stroke-width='2' d='M4 7h22M4 15h22M4 23h22'/%3e%3c/svg%3e") no-repeat center/1.75rem rgba(255, 255, 255, 0.1);
}

.navbar-toggler:checked {
    background-color: rgba(255, 255, 255, 0.5);
}

.top-row {
    min-height: 3.5rem;
    background-color: rgba(0,0,0,0.4);
}

.navbar-brand {
    font-size: 1.1rem;
}

.bi {
    display: inline-block;
    position: relative;
    width: 1.25rem;
    height: 1.25rem;
    margin-right: 0.75rem;
    top: -1px;
    background-size: cover;
}

.bi-house-door-fill-nav-menu {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='white' class='bi bi-house-door-fill' viewBox='0 0 16 16'%3E%3Cpath d='M6.5 14.5v-3.505c0-.245.25-.495.5-.495h2c.25 0 .5.25.5.5v3.5a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.146-.354L13 5.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293L8.354 1.146a.5.5 0 0 0-.708 0l-6 6A.5.5 0 0 0 1.5 7.5v7a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5Z'/%3E%3C/svg%3E");
}

.bi-plus-square-fill-nav-menu {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='white' class='bi bi-plus-square-fill' viewBox='0 0 16 16'%3E%3Cpath d='M2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H2zm6.5 4.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3a.5.5 0 0 1 1 0z'/%3E%3C/svg%3E");
}

.bi-list-nested-nav-menu {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='white' class='bi bi-list-nested' viewBox='0 0 16 16'%3E%3Cpath fill-rule='evenodd' d='M4.5 11.5A.5.5 0 0 1 5 11h10a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5zm-2-4A.5.5 0 0 1 3 7h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm-2-4A.5.5 0 0 1 1 3h10a.5.5 0 0 1 0 1H1a.5.5 0 0 1-.5-.5z'/%3E%3C/svg%3E");
}

.nav-item {
    font-size: 0.9rem;
    padding-bottom: 0.5rem;
}

    .nav-item:first-of-type {
        padding-top: 1rem;
    }

    .nav-item:last-of-type {
        padding-bottom: 1rem;
    }

    .nav-item ::deep .nav-link {
        color: #d7d7d7;
        background: none;
        border: none;
        border-radius: 4px;
        height: 3rem;
        display: flex;
        align-items: center;
        line-height: 3rem;
        width: 100%;
    }

.nav-item ::deep a.active {
    background-color: rgba(255,255,255,0.37);
    color: white;
}

.nav-item ::deep .nav-link:hover {
    background-color: rgba(255,255,255,0.1);
    color: white;
}

.nav-scrollable {
    display: none;
}

.navbar-toggler:checked ~ .nav-scrollable {
    display: block;
}

@media (min-width: 641px) {
    .navbar-toggler {
        display: none;
    }

    .nav-scrollable {
        /* Never collapse the sidebar for wide screens */
        display: block;

        /* Allow sidebar to scroll for tall menus */
        height: calc(100vh - 3.5rem);
        overflow-y: auto;
    }
}
````

#### `src/DemoTodo/Components/Layout/ReconnectModal.razor`

````razor
<script type="module" src="@Assets["Components/Layout/ReconnectModal.razor.js"]"></script>

<dialog id="components-reconnect-modal" data-nosnippet>
    <div class="components-reconnect-container">
        <div class="components-rejoining-animation" aria-hidden="true">
            <div></div>
            <div></div>
        </div>
        <p class="components-reconnect-first-attempt-visible">
            Rejoining the server...
        </p>
        <p class="components-reconnect-repeated-attempt-visible">
            Rejoin failed... trying again in <span id="components-seconds-to-next-attempt"></span> seconds.
        </p>
        <p class="components-reconnect-failed-visible">
            Failed to rejoin.<br />Please retry or reload the page.
        </p>
        <button id="components-reconnect-button" class="components-reconnect-failed-visible">
            Retry
        </button>
        <p class="components-pause-visible">
            The session has been paused by the server.
        </p>
        <p class="components-resume-failed-visible">
            Failed to resume the session.<br />Please retry or reload the page.
        </p>
        <button id="components-resume-button" class="components-pause-visible components-resume-failed-visible">
            Resume
        </button>
    </div>
</dialog>
````

#### `src/DemoTodo/Components/Layout/ReconnectModal.razor.css`

````css
.components-reconnect-first-attempt-visible,
.components-reconnect-repeated-attempt-visible,
.components-reconnect-failed-visible,
.components-pause-visible,
.components-resume-failed-visible,
.components-rejoining-animation {
    display: none;
}

#components-reconnect-modal.components-reconnect-show .components-reconnect-first-attempt-visible,
#components-reconnect-modal.components-reconnect-show .components-rejoining-animation,
#components-reconnect-modal.components-reconnect-paused .components-pause-visible,
#components-reconnect-modal.components-reconnect-resume-failed .components-resume-failed-visible,
#components-reconnect-modal.components-reconnect-retrying,
#components-reconnect-modal.components-reconnect-retrying .components-reconnect-repeated-attempt-visible,
#components-reconnect-modal.components-reconnect-retrying .components-rejoining-animation,
#components-reconnect-modal.components-reconnect-failed,
#components-reconnect-modal.components-reconnect-failed .components-reconnect-failed-visible {
    display: block;
}


#components-reconnect-modal {
    background-color: white;
    width: 20rem;
    margin: 20vh auto;
    padding: 2rem;
    border: 0;
    border-radius: 0.5rem;
    box-shadow: 0 3px 6px 2px rgba(0, 0, 0, 0.3);
    opacity: 0;
    transition: display 0.5s allow-discrete, overlay 0.5s allow-discrete;
    animation: components-reconnect-modal-fadeOutOpacity 0.5s both;
    &[open]

{
    animation: components-reconnect-modal-slideUp 1.5s cubic-bezier(.05, .89, .25, 1.02) 0.3s, components-reconnect-modal-fadeInOpacity 0.5s ease-in-out 0.3s;
    animation-fill-mode: both;
}

}

#components-reconnect-modal::backdrop {
    background-color: rgba(0, 0, 0, 0.4);
    animation: components-reconnect-modal-fadeInOpacity 0.5s ease-in-out;
    opacity: 1;
}

@keyframes components-reconnect-modal-slideUp {
    0% {
        transform: translateY(30px) scale(0.95);
    }

    100% {
        transform: translateY(0);
    }
}

@keyframes components-reconnect-modal-fadeInOpacity {
    0% {
        opacity: 0;
    }

    100% {
        opacity: 1;
    }
}

@keyframes components-reconnect-modal-fadeOutOpacity {
    0% {
        opacity: 1;
    }

    100% {
        opacity: 0;
    }
}

.components-reconnect-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
}

#components-reconnect-modal p {
    margin: 0;
    text-align: center;
}

#components-reconnect-modal button {
    border: 0;
    background-color: #6b9ed2;
    color: white;
    padding: 4px 24px;
    border-radius: 4px;
}

    #components-reconnect-modal button:hover {
        background-color: #3b6ea2;
    }

    #components-reconnect-modal button:active {
        background-color: #6b9ed2;
    }

.components-rejoining-animation {
    position: relative;
    width: 80px;
    height: 80px;
}

    .components-rejoining-animation div {
        position: absolute;
        border: 3px solid #0087ff;
        opacity: 1;
        border-radius: 50%;
        animation: components-rejoining-animation 1.5s cubic-bezier(0, 0.2, 0.8, 1) infinite;
    }

        .components-rejoining-animation div:nth-child(2) {
            animation-delay: -0.5s;
        }

@keyframes components-rejoining-animation {
    0% {
        top: 40px;
        left: 40px;
        width: 0;
        height: 0;
        opacity: 0;
    }

    4.9% {
        top: 40px;
        left: 40px;
        width: 0;
        height: 0;
        opacity: 0;
    }

    5% {
        top: 40px;
        left: 40px;
        width: 0;
        height: 0;
        opacity: 1;
    }

    100% {
        top: 0px;
        left: 0px;
        width: 80px;
        height: 80px;
        opacity: 0;
    }
}
````

#### `src/DemoTodo/Components/Layout/ReconnectModal.razor.js`

````js
// Set up event handlers
const reconnectModal = document.getElementById("components-reconnect-modal");
reconnectModal.addEventListener("components-reconnect-state-changed", handleReconnectStateChanged);

const retryButton = document.getElementById("components-reconnect-button");
retryButton.addEventListener("click", retry);

const resumeButton = document.getElementById("components-resume-button");
resumeButton.addEventListener("click", resume);

function handleReconnectStateChanged(event) {
    if (event.detail.state === "show") {
        reconnectModal.showModal();
    } else if (event.detail.state === "hide") {
        reconnectModal.close();
    } else if (event.detail.state === "failed") {
        document.addEventListener("visibilitychange", retryWhenDocumentBecomesVisible);
    } else if (event.detail.state === "rejected") {
        location.reload();
    }
}

async function retry() {
    document.removeEventListener("visibilitychange", retryWhenDocumentBecomesVisible);

    try {
        // Reconnect will asynchronously return:
        // - true to mean success
        // - false to mean we reached the server, but it rejected the connection (e.g., unknown circuit ID)
        // - exception to mean we didn't reach the server (this can be sync or async)
        const successful = await Blazor.reconnect();
        if (!successful) {
            // We have been able to reach the server, but the circuit is no longer available.
            // We'll reload the page so the user can continue using the app as quickly as possible.
            const resumeSuccessful = await Blazor.resumeCircuit();
            if (!resumeSuccessful) {
                location.reload();
            } else {
                reconnectModal.close();
            }
        }
    } catch (err) {
        // We got an exception, server is currently unavailable
        document.addEventListener("visibilitychange", retryWhenDocumentBecomesVisible);
    }
}

async function resume() {
    try {
        const successful = await Blazor.resumeCircuit();
        if (!successful) {
            location.reload();
        }
    } catch {
        reconnectModal.classList.replace("components-reconnect-paused", "components-reconnect-resume-failed");
    }
}

async function retryWhenDocumentBecomesVisible() {
    if (document.visibilityState === "visible") {
        await retry();
    }
}
````

#### `src/DemoTodo/Components/Pages/Counter.razor`

````razor
@page "/counter"
@rendermode InteractiveServer

<PageTitle>Counter</PageTitle>

<h1>Counter</h1>

<p role="status">Current count: @currentCount</p>

<button class="btn btn-primary" @onclick="IncrementCount">Click me</button>

@code {
    private int currentCount = 0;

    private void IncrementCount()
    {
        currentCount++;
    }
}
````

#### `src/DemoTodo/Components/Pages/Error.razor`

````razor
@page "/Error"
@using System.Diagnostics

<PageTitle>Error</PageTitle>

<h1 class="text-danger">Error.</h1>
<h2 class="text-danger">An error occurred while processing your request.</h2>

@if (ShowRequestId)
{
    <p>
        <strong>Request ID:</strong> <code>@RequestId</code>
    </p>
}

<h3>Development Mode</h3>
<p>
    Swapping to <strong>Development</strong> environment will display more detailed information about the error that occurred.
</p>
<p>
    <strong>The Development environment shouldn't be enabled for deployed applications.</strong>
    It can result in displaying sensitive information from exceptions to end users.
    For local debugging, enable the <strong>Development</strong> environment by setting the <strong>ASPNETCORE_ENVIRONMENT</strong> environment variable to <strong>Development</strong>
    and restarting the app.
</p>

@code{
    [CascadingParameter]
    private HttpContext? HttpContext { get; set; }

    private string? RequestId { get; set; }
    private bool ShowRequestId => !string.IsNullOrEmpty(RequestId);

    protected override void OnInitialized() =>
        RequestId = Activity.Current?.Id ?? HttpContext?.TraceIdentifier;
}
````

#### `src/DemoTodo/Components/Pages/Home.razor`

````razor
@page "/"
@rendermode InteractiveServer
@inject TodoStore Store

<PageTitle>Todos</PageTitle>

<h1>Todos</h1>

<ul data-testid="todo-list">
    @foreach (var todo in Store.List())
    {
        <li data-testid="todo-item">
            <span data-testid="todo-title">@todo.Title@(todo.Done ? " ✓" : "")</span>
        </li>
    }
</ul>
````

#### `src/DemoTodo/Components/Pages/NotFound.razor`

````razor
@page "/not-found"
@layout MainLayout

<h3>Not Found</h3>
<p>Sorry, the content you are looking for does not exist.</p>
````

#### `src/DemoTodo/Components/Pages/Weather.razor`

````razor
@page "/weather"
@attribute [StreamRendering]

<PageTitle>Weather</PageTitle>

<h1>Weather</h1>

<p>This component demonstrates showing data.</p>

@if (forecasts == null)
{
    <p><em>Loading...</em></p>
}
else
{
    <table class="table">
        <thead>
            <tr>
                <th>Date</th>
                <th aria-label="Temperature in Celsius">Temp. (C)</th>
                <th aria-label="Temperature in Fahrenheit">Temp. (F)</th>
                <th>Summary</th>
            </tr>
        </thead>
        <tbody>
            @foreach (var forecast in forecasts)
            {
                <tr>
                    <td>@forecast.Date.ToShortDateString()</td>
                    <td>@forecast.TemperatureC</td>
                    <td>@forecast.TemperatureF</td>
                    <td>@forecast.Summary</td>
                </tr>
            }
        </tbody>
    </table>
}

@code {
    private WeatherForecast[]? forecasts;

    protected override async Task OnInitializedAsync()
    {
        // Simulate asynchronous loading to demonstrate streaming rendering
        await Task.Delay(500);

        var startDate = DateOnly.FromDateTime(DateTime.Now);
        var summaries = new[] { "Freezing", "Bracing", "Chilly", "Cool", "Mild", "Warm", "Balmy", "Hot", "Sweltering", "Scorching" };
        forecasts = Enumerable.Range(1, 5).Select(index => new WeatherForecast
        {
            Date = startDate.AddDays(index),
            TemperatureC = Random.Shared.Next(-20, 55),
            Summary = summaries[Random.Shared.Next(summaries.Length)]
        }).ToArray();
    }

    private class WeatherForecast
    {
        public DateOnly Date { get; set; }
        public int TemperatureC { get; set; }
        public string? Summary { get; set; }
        public int TemperatureF => 32 + (int)(TemperatureC / 0.5556);
    }
}
````

#### `src/DemoTodo/Components/Routes.razor`

````razor
<Router AppAssembly="typeof(Program).Assembly" NotFoundPage="typeof(Pages.NotFound)">
    <Found Context="routeData">
        <RouteView RouteData="routeData" DefaultLayout="typeof(Layout.MainLayout)" />
        <FocusOnNavigate RouteData="routeData" Selector="h1" />
    </Found>
</Router>
````

#### `src/DemoTodo/Components/_Imports.razor`

````razor
@using System.Net.Http
@using System.Net.Http.Json
@using Microsoft.AspNetCore.Components.Forms
@using Microsoft.AspNetCore.Components.Routing
@using Microsoft.AspNetCore.Components.Web
@using static Microsoft.AspNetCore.Components.Web.RenderMode
@using Microsoft.AspNetCore.Components.Web.Virtualization
@using Microsoft.JSInterop
@using DemoTodo
@using DemoTodo.Components
@using DemoTodo.Components.Layout
````

#### `src/DemoTodo/DemoTodo.csproj`

````xml
<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <BlazorDisableThrowNavigationException>true</BlazorDisableThrowNavigationException>
  </PropertyGroup>

</Project>
````

#### `src/DemoTodo/Program.cs`

````csharp
using System.ComponentModel.DataAnnotations;
using DemoTodo;
using DemoTodo.Components;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();
builder.Services.AddSingleton<TodoStore>();
// Malformed JSON bodies throw in every environment, so the handler below turns them into a 400.
builder.Services.Configure<RouteHandlerOptions>(options => options.ThrowOnBadRequest = true);

var app = builder.Build();

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}
app.UseStatusCodePagesWithReExecute("/not-found", createScopeForStatusCodePages: true);
app.UseHttpsRedirection();

// Validation errors and malformed request bodies map to 400 {"error": "..."}.
app.Use(async (context, next) =>
{
    try
    {
        await next(context);
    }
    catch (Exception ex) when (ex is ValidationException or BadHttpRequestException)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await context.Response.WriteAsJsonAsync(new { error = ex.Message });
    }
});

app.UseAntiforgery();

app.MapStaticAssets();
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

// JSON API on the same store as the list page.
app.MapGet("/health", () => new { ok = true });

var todos = app.MapGroup("/todos");
todos.MapGet("", (TodoStore store) => store.List());
todos.MapPost("", (NewTodo input, TodoStore store) =>
{
    var todo = store.Add(input);
    return Results.Created($"/todos/{todo.Id}", todo);
});
todos.MapGet("/{id:int}", (int id, TodoStore store) =>
    store.Get(id) is { } todo ? Results.Ok(todo) : NotFound());
todos.MapPatch("/{id:int}", (int id, TodoPatch patch, TodoStore store) =>
    store.Update(id, patch) is { } todo ? Results.Ok(todo) : NotFound());
todos.MapDelete("/{id:int}", (int id, TodoStore store) =>
    store.Remove(id) ? Results.NoContent() : NotFound());

app.Run();

static IResult NotFound() => Results.NotFound(new { error = "not found" });

public partial class Program;
````

#### `src/DemoTodo/Properties/launchSettings.json`

````json
{
  "$schema": "https://json.schemastore.org/launchsettings.json",
    "profiles": {
      "http": {
        "commandName": "Project",
        "dotnetRunMessages": true,
        "launchBrowser": true,
        "applicationUrl": "http://localhost:5214",
        "environmentVariables": {
          "ASPNETCORE_ENVIRONMENT": "Development"
        }
      },
      "https": {
        "commandName": "Project",
        "dotnetRunMessages": true,
        "launchBrowser": true,
        "applicationUrl": "https://localhost:7084;http://localhost:5214",
        "environmentVariables": {
          "ASPNETCORE_ENVIRONMENT": "Development"
        }
      }
    }
  }
````

#### `src/DemoTodo/TodoStore.cs`

````csharp
using System.ComponentModel.DataAnnotations;

namespace DemoTodo;

public record Todo(int Id, string Title, bool Done);

public record NewTodo(string? Title);

public record TodoPatch(string? Title, bool? Done);

// In-memory todo store, registered as a singleton: the API and the list page share it.
public class TodoStore
{
    private readonly Lock _lock = new();
    private readonly SortedDictionary<int, Todo> _todos = [];
    private int _nextId = 1;

    public IReadOnlyList<Todo> List()
    {
        lock (_lock) return [.. _todos.Values];
    }

    public Todo? Get(int id)
    {
        lock (_lock) return _todos.GetValueOrDefault(id);
    }

    public Todo Add(NewTodo input)
    {
        var title = input.Title?.Trim();
        if (string.IsNullOrEmpty(title)) throw new ValidationException("title is required");
        lock (_lock)
        {
            var todo = new Todo(_nextId++, title, false);
            _todos[todo.Id] = todo;
            return todo;
        }
    }

    public Todo? Update(int id, TodoPatch patch)
    {
        var title = patch.Title?.Trim();
        if (patch.Title is not null && title == "") throw new ValidationException("title must be a non-empty string");
        lock (_lock)
        {
            if (!_todos.TryGetValue(id, out var todo)) return null;
            todo = todo with { Title = title ?? todo.Title, Done = patch.Done ?? todo.Done };
            _todos[id] = todo;
            return todo;
        }
    }

    public bool Remove(int id)
    {
        lock (_lock) return _todos.Remove(id);
    }
}
````

#### `src/DemoTodo/appsettings.Development.json`

````json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  }
}
````

#### `src/DemoTodo/appsettings.json`

````json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "AllowedHosts": "*"
}
````

#### `src/DemoTodo/wwwroot/app.css`

````css
html, body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
}

a, .btn-link {
    color: #006bb7;
}

.btn-primary {
    color: #fff;
    background-color: #1b6ec2;
    border-color: #1861ac;
}

.btn:focus, .btn:active:focus, .btn-link.nav-link:focus, .form-control:focus, .form-check-input:focus {
  box-shadow: 0 0 0 0.1rem white, 0 0 0 0.25rem #258cfb;
}

.content {
    padding-top: 1.1rem;
}

h1:focus {
    outline: none;
}

.valid.modified:not([type=checkbox]) {
    outline: 1px solid #26b050;
}

.invalid {
    outline: 1px solid #e50000;
}

.validation-message {
    color: #e50000;
}

.blazor-error-boundary {
    background: url(data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTYiIGhlaWdodD0iNDkiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIG92ZXJmbG93PSJoaWRkZW4iPjxkZWZzPjxjbGlwUGF0aCBpZD0iY2xpcDAiPjxyZWN0IHg9IjIzNSIgeT0iNTEiIHdpZHRoPSI1NiIgaGVpZ2h0PSI0OSIvPjwvY2xpcFBhdGg+PC9kZWZzPjxnIGNsaXAtcGF0aD0idXJsKCNjbGlwMCkiIHRyYW5zZm9ybT0idHJhbnNsYXRlKC0yMzUgLTUxKSI+PHBhdGggZD0iTTI2My41MDYgNTFDMjY0LjcxNyA1MSAyNjUuODEzIDUxLjQ4MzcgMjY2LjYwNiA1Mi4yNjU4TDI2Ny4wNTIgNTIuNzk4NyAyNjcuNTM5IDUzLjYyODMgMjkwLjE4NSA5Mi4xODMxIDI5MC41NDUgOTIuNzk1IDI5MC42NTYgOTIuOTk2QzI5MC44NzcgOTMuNTEzIDI5MSA5NC4wODE1IDI5MSA5NC42NzgyIDI5MSA5Ny4wNjUxIDI4OS4wMzggOTkgMjg2LjYxNyA5OUwyNDAuMzgzIDk5QzIzNy45NjMgOTkgMjM2IDk3LjA2NTEgMjM2IDk0LjY3ODIgMjM2IDk0LjM3OTkgMjM2LjAzMSA5NC4wODg2IDIzNi4wODkgOTMuODA3MkwyMzYuMzM4IDkzLjAxNjIgMjM2Ljg1OCA5Mi4xMzE0IDI1OS40NzMgNTMuNjI5NCAyNTkuOTYxIDUyLjc5ODUgMjYwLjQwNyA1Mi4yNjU4QzI2MS4yIDUxLjQ4MzcgMjYyLjI5NiA1MSAyNjMuNTA2IDUxWk0yNjMuNTg2IDY2LjAxODNDMjYwLjczNyA2Ni4wMTgzIDI1OS4zMTMgNjcuMTI0NSAyNTkuMzEzIDY5LjMzNyAyNTkuMzEzIDY5LjYxMDIgMjU5LjMzMiA2OS44NjA4IDI1OS4zNzEgNzAuMDg4N0wyNjEuNzk1IDg0LjAxNjEgMjY1LjM4IDg0LjAxNjEgMjY3LjgyMSA2OS43NDc1QzI2Ny44NiA2OS43MzA5IDI2Ny44NzkgNjkuNTg3NyAyNjcuODc5IDY5LjMxNzkgMjY3Ljg3OSA2Ny4xMTgyIDI2Ni40NDggNjYuMDE4MyAyNjMuNTg2IDY2LjAxODNaTTI2My41NzYgODYuMDU0N0MyNjEuMDQ5IDg2LjA1NDcgMjU5Ljc4NiA4Ny4zMDA1IDI1OS43ODYgODkuNzkyMSAyNTkuNzg2IDkyLjI4MzcgMjYxLjA0OSA5My41Mjk1IDI2My41NzYgOTMuNTI5NSAyNjYuMTE2IDkzLjUyOTUgMjY3LjM4NyA5Mi4yODM3IDI2Ny4zODcgODkuNzkyMSAyNjcuMzg3IDg3LjMwMDUgMjY2LjExNiA4Ni4wNTQ3IDI2My41NzYgODYuMDU0N1oiIGZpbGw9IiNGRkU1MDAiIGZpbGwtcnVsZT0iZXZlbm9kZCIvPjwvZz48L3N2Zz4=) no-repeat 1rem/1.8rem, #b32121;
    padding: 1rem 1rem 1rem 3.7rem;
    color: white;
}

    .blazor-error-boundary::after {
        content: "An error has occurred."
    }

.darker-border-checkbox.form-check-input {
    border-color: #929292;
}

.form-floating > .form-control-plaintext::placeholder, .form-floating > .form-control::placeholder {
    color: var(--bs-secondary-color);
    text-align: end;
}

.form-floating > .form-control-plaintext:focus::placeholder, .form-floating > .form-control:focus::placeholder {
    text-align: start;
}
````

#### `tests/DemoTodo.Tests/DemoTodo.Tests.csproj`

````xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <IsPackable>false</IsPackable>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" Version="10.0.12" />
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.14.1" />
    <PackageReference Include="xunit" Version="2.9.3" />
    <PackageReference Include="xunit.runner.visualstudio" Version="3.1.4" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\..\src\DemoTodo\DemoTodo.csproj" />
  </ItemGroup>

  <ItemGroup>
    <Using Include="Xunit" />
  </ItemGroup>

</Project>
````

#### `tests/DemoTodo.Tests/TodoApiTests.cs`

````csharp
using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace DemoTodo.Tests;

// Every test starts its own app, so each one gets an empty store.
public class TodoApiTests : IDisposable
{
    private readonly WebApplicationFactory<Program> _factory = new();
    private readonly HttpClient _client;

    public TodoApiTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    [Fact]
    public async Task CreatesAndListsTodos()
    {
        var created = await _client.PostAsJsonAsync("/todos", new { title = "Milch kaufen" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var list = await _client.GetStringAsync("/todos");
        Assert.Equal("""[{"id":1,"title":"Milch kaufen","done":false}]""", list);
    }

    [Fact]
    public async Task RejectsAnEmptyTitle()
    {
        var res = await _client.PostAsJsonAsync("/todos", new { title = " " });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task RejectsMalformedJson()
    {
        var res = await _client.PostAsync("/todos", new StringContent("{", null, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task MarksATodoDone()
    {
        await _client.PostAsJsonAsync("/todos", new { title = "A" });
        var res = await _client.PatchAsJsonAsync("/todos/1", new { done = true });
        Assert.True((await res.Content.ReadFromJsonAsync<Todo>())!.Done);
    }

    [Fact]
    public async Task AnUnknownIdIsNotFound()
    {
        var res = await _client.GetAsync("/todos/42");
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    [Fact]
    public async Task ServesTheListPage()
    {
        await _client.PostAsJsonAsync("/todos", new { title = "Milch kaufen" });
        var res = await _client.GetAsync("/");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var html = await res.Content.ReadAsStringAsync();
        Assert.Contains("data-testid=\"todo-list\"", html);
        Assert.Contains("Milch kaufen", html);
    }
}
````

#### `tests/DemoTodo.Tests/TodoStoreTests.cs`

````csharp
using System.ComponentModel.DataAnnotations;

namespace DemoTodo.Tests;

public class TodoStoreTests
{
    [Fact]
    public void AddsTodosWithSequentialIdsAndTrimmedTitles()
    {
        var store = new TodoStore();
        store.Add(new NewTodo("A"));
        var todo = store.Add(new NewTodo("  B  "));
        Assert.Equal(new Todo(2, "B", false), todo);
        Assert.Equal([new Todo(1, "A", false), todo], store.List());
    }

    [Fact]
    public void RejectsAMissingTitle()
    {
        Assert.Throws<ValidationException>(() => new TodoStore().Add(new NewTodo(null)));
    }

    [Fact]
    public void UpdatesOnlyTheGivenFields()
    {
        var store = new TodoStore();
        var todo = store.Add(new NewTodo("A"));
        Assert.Equal(todo with { Done = true }, store.Update(todo.Id, new TodoPatch(null, true)));
        Assert.Null(store.Update(42, new TodoPatch("B", null)));
    }
}
````

## Appendix B: .NET calibration patches

Paths are relative to `e2e/tasks/demo-todo-dotnet/calibration/`. Each applies to the tracked seed files with `git apply` (as `createCalibrationBundle` does).

#### `reference.patch`

````diff
diff --git a/src/DemoTodo/Components/Pages/Home.razor b/src/DemoTodo/Components/Pages/Home.razor
index 10e75f0..bc8834d 100644
--- a/src/DemoTodo/Components/Pages/Home.razor
+++ b/src/DemoTodo/Components/Pages/Home.razor
@@ -6,11 +6,28 @@
 
 <h1>Todos</h1>
 
+<label class="form-check">
+    <input class="form-check-input" type="checkbox" data-testid="overdue-filter" @bind="onlyOverdue" />
+    nur überfällige
+</label>
+
 <ul data-testid="todo-list">
-    @foreach (var todo in Store.List())
+    @foreach (var todo in Store.List().Where(todo => !onlyOverdue || todo.Overdue))
     {
         <li data-testid="todo-item">
             <span data-testid="todo-title">@todo.Title@(todo.Done ? " ✓" : "")</span>
+            @if (todo.DueDate is { } dueDate)
+            {
+                <span class="ms-2" data-testid="todo-due">@dueDate.ToString("yyyy-MM-dd")</span>
+            }
+            @if (todo.Overdue)
+            {
+                <strong class="badge text-bg-danger ms-2" data-testid="todo-overdue">überfällig</strong>
+            }
         </li>
     }
 </ul>
+
+@code {
+    private bool onlyOverdue;
+}
diff --git a/src/DemoTodo/Program.cs b/src/DemoTodo/Program.cs
index fd7934d..247c391 100644
--- a/src/DemoTodo/Program.cs
+++ b/src/DemoTodo/Program.cs
@@ -7,6 +7,7 @@ var builder = WebApplication.CreateBuilder(args);
 // Add services to the container.
 builder.Services.AddRazorComponents()
     .AddInteractiveServerComponents();
+builder.Services.AddSingleton(TimeProvider.System);
 builder.Services.AddSingleton<TodoStore>();
 // Malformed JSON bodies throw in every environment, so the handler below turns them into a 400.
 builder.Services.Configure<RouteHandlerOptions>(options => options.ThrowOnBadRequest = true);
@@ -47,7 +48,7 @@ app.MapRazorComponents<App>()
 app.MapGet("/health", () => new { ok = true });
 
 var todos = app.MapGroup("/todos");
-todos.MapGet("", (TodoStore store) => store.List());
+todos.MapGet("", (TodoStore store, bool overdue = false) => store.List(overdue));
 todos.MapPost("", (NewTodo input, TodoStore store) =>
 {
     var todo = store.Add(input);
diff --git a/src/DemoTodo/TodoStore.cs b/src/DemoTodo/TodoStore.cs
index c5509e1..58326a6 100644
--- a/src/DemoTodo/TodoStore.cs
+++ b/src/DemoTodo/TodoStore.cs
@@ -1,39 +1,48 @@
 using System.ComponentModel.DataAnnotations;
+using System.Globalization;
+using System.Text.Json;
 
 namespace DemoTodo;
 
-public record Todo(int Id, string Title, bool Done);
+public record Todo(int Id, string Title, bool Done, DateOnly? DueDate = null)
+{
+    // Computed from DueDate and today on every read, never stored.
+    public bool Overdue { get; init; }
+}
 
-public record NewTodo(string? Title);
+// DueDate stays raw JSON, so a PATCH can tell an absent field (keep the due date) from null (remove it).
+public record NewTodo(string? Title, JsonElement DueDate = default);
 
-public record TodoPatch(string? Title, bool? Done);
+public record TodoPatch(string? Title, bool? Done, JsonElement DueDate = default);
 
 // In-memory todo store, registered as a singleton: the API and the list page share it.
-public class TodoStore
+public class TodoStore(TimeProvider time)
 {
     private readonly Lock _lock = new();
     private readonly SortedDictionary<int, Todo> _todos = [];
     private int _nextId = 1;
 
-    public IReadOnlyList<Todo> List()
+    public IReadOnlyList<Todo> List(bool overdueOnly = false)
     {
-        lock (_lock) return [.. _todos.Values];
+        var today = Today();
+        lock (_lock) return [.. _todos.Values.Select(todo => View(todo, today)).Where(todo => !overdueOnly || todo.Overdue)];
     }
 
     public Todo? Get(int id)
     {
-        lock (_lock) return _todos.GetValueOrDefault(id);
+        lock (_lock) return _todos.TryGetValue(id, out var todo) ? View(todo, Today()) : null;
     }
 
     public Todo Add(NewTodo input)
     {
         var title = input.Title?.Trim();
         if (string.IsNullOrEmpty(title)) throw new ValidationException("title is required");
+        var dueDate = ParseDueDate(input.DueDate);
         lock (_lock)
         {
-            var todo = new Todo(_nextId++, title, false);
+            var todo = new Todo(_nextId++, title, false, dueDate);
             _todos[todo.Id] = todo;
-            return todo;
+            return View(todo, Today());
         }
     }
 
@@ -41,12 +50,19 @@ public class TodoStore
     {
         var title = patch.Title?.Trim();
         if (patch.Title is not null && title == "") throw new ValidationException("title must be a non-empty string");
+        var changesDueDate = patch.DueDate.ValueKind != JsonValueKind.Undefined;
+        var dueDate = ParseDueDate(patch.DueDate);
         lock (_lock)
         {
             if (!_todos.TryGetValue(id, out var todo)) return null;
-            todo = todo with { Title = title ?? todo.Title, Done = patch.Done ?? todo.Done };
+            todo = todo with
+            {
+                Title = title ?? todo.Title,
+                Done = patch.Done ?? todo.Done,
+                DueDate = changesDueDate ? dueDate : todo.DueDate,
+            };
             _todos[id] = todo;
-            return todo;
+            return View(todo, Today());
         }
     }
 
@@ -54,4 +70,21 @@ public class TodoStore
     {
         lock (_lock) return _todos.Remove(id);
     }
+
+    // A due date is a calendar date (yyyy-MM-dd) or null.
+    public static DateOnly? ParseDueDate(JsonElement value) => value.ValueKind switch
+    {
+        JsonValueKind.Undefined or JsonValueKind.Null => null,
+        JsonValueKind.String when DateOnly.TryParseExact(value.GetString(), "yyyy-MM-dd",
+            CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) => date,
+        _ => throw new ValidationException("dueDate must be a valid date in the form yyyy-MM-dd, or null"),
+    };
+
+    // Overdue: not done and due before today.
+    public static bool IsOverdue(Todo todo, DateOnly today) => !todo.Done && todo.DueDate < today;
+
+    // "Today" is the current date in UTC.
+    private DateOnly Today() => DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime);
+
+    private static Todo View(Todo todo, DateOnly today) => todo with { Overdue = IsOverdue(todo, today) };
 }
diff --git a/tests/DemoTodo.Tests/TodoApiTests.cs b/tests/DemoTodo.Tests/TodoApiTests.cs
index f20e459..3b93aaa 100644
--- a/tests/DemoTodo.Tests/TodoApiTests.cs
+++ b/tests/DemoTodo.Tests/TodoApiTests.cs
@@ -1,4 +1,5 @@
 using System.Net;
+using System.Text.Json;
 using System.Net.Http.Json;
 using Microsoft.AspNetCore.Mvc.Testing;
 
@@ -20,7 +21,7 @@ public class TodoApiTests : IDisposable
         var created = await _client.PostAsJsonAsync("/todos", new { title = "Milch kaufen" });
         Assert.Equal(HttpStatusCode.Created, created.StatusCode);
         var list = await _client.GetStringAsync("/todos");
-        Assert.Equal("""[{"id":1,"title":"Milch kaufen","done":false}]""", list);
+        Assert.Equal("""[{"id":1,"title":"Milch kaufen","done":false,"dueDate":null,"overdue":false}]""", list);
     }
 
     [Fact]
@@ -62,4 +63,86 @@ public class TodoApiTests : IDisposable
         Assert.Contains("data-testid=\"todo-list\"", html);
         Assert.Contains("Milch kaufen", html);
     }
+
+    [Fact]
+    public async Task RejectsAnInvalidDueDate()
+    {
+        var res = await _client.PostAsJsonAsync("/todos", new { title = "A", dueDate = "2026-02-30" });
+        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
+    }
+
+    [Fact]
+    public async Task ListsOnlyOverdueTodosWithTheOverdueQuery()
+    {
+        await _client.PostAsJsonAsync("/todos", new { title = "late", dueDate = "2000-01-01" });
+        await _client.PostAsJsonAsync("/todos", new { title = "later", dueDate = "2999-01-01" });
+        var list = await _client.GetFromJsonAsync<Todo[]>("/todos?overdue=true");
+        Assert.Equal(["late"], list!.Select(t => t.Title));
+    }
+
+    [Fact]
+    public async Task SetsADueDateOnCreate()
+    {
+        var res = await _client.PostAsJsonAsync("/todos", new { title = "A", dueDate = "2026-05-20" });
+        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
+        var todo = await res.Content.ReadFromJsonAsync<Todo>();
+        Assert.Equal(new DateOnly(2026, 5, 20), todo!.DueDate);
+        Assert.Equal(new DateOnly(2026, 5, 20), (await _client.GetFromJsonAsync<Todo>($"/todos/{todo.Id}"))!.DueDate);
+    }
+
+    [Fact]
+    public async Task ChangesAndClearsTheDueDateWithPatch()
+    {
+        await _client.PostAsJsonAsync("/todos", new { title = "A", dueDate = "2026-05-20" });
+        var changed = await _client.PatchAsJsonAsync("/todos/1", new { dueDate = "2026-06-01" });
+        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
+        Assert.Equal(new DateOnly(2026, 6, 1), (await changed.Content.ReadFromJsonAsync<Todo>())!.DueDate);
+        var kept = await _client.PatchAsJsonAsync("/todos/1", new { done = true });
+        Assert.Equal(new DateOnly(2026, 6, 1), (await kept.Content.ReadFromJsonAsync<Todo>())!.DueDate);
+        var cleared = await _client.PatchAsync("/todos/1", JsonContent("""{"dueDate":null}"""));
+        Assert.Equal(HttpStatusCode.OK, cleared.StatusCode);
+        Assert.Null((await cleared.Content.ReadFromJsonAsync<Todo>())!.DueDate);
+        Assert.Null((await _client.GetFromJsonAsync<Todo>("/todos/1"))!.DueDate);
+    }
+
+    [Fact]
+    public async Task RejectsAnInvalidDueDateOnPatchAndKeepsTheOldOne()
+    {
+        await _client.PostAsJsonAsync("/todos", new { title = "A", dueDate = "2026-05-20" });
+        foreach (var dueDate in new object[] { "2026-02-30", "10.05.2026", 20260520 })
+        {
+            var res = await _client.PatchAsync("/todos/1", JsonContent(JsonSerializer.Serialize(new { dueDate })));
+            Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
+        }
+        Assert.Equal(new DateOnly(2026, 5, 20), (await _client.GetFromJsonAsync<Todo>("/todos/1"))!.DueDate);
+    }
+
+    [Fact]
+    public async Task ADoneTodoIsNeverOverdueAndTheOverdueQueryLeavesItOut()
+    {
+        await _client.PostAsJsonAsync("/todos", new { title = "open", dueDate = "2000-01-01" });
+        await _client.PostAsJsonAsync("/todos", new { title = "finished", dueDate = "2000-01-01" });
+        await _client.PostAsJsonAsync("/todos", new { title = "undated" });
+        var done = await _client.PatchAsJsonAsync("/todos/2", new { done = true });
+        Assert.False((await done.Content.ReadFromJsonAsync<Todo>())!.Overdue);
+        var overdue = await _client.GetFromJsonAsync<Todo[]>("/todos?overdue=true");
+        Assert.Equal(["open"], overdue!.Select(t => t.Title));
+        var all = await _client.GetFromJsonAsync<Todo[]>("/todos");
+        Assert.Equal([true, false, false], all!.Select(t => t.Overdue));
+    }
+
+    [Fact]
+    public async Task TheListPageShowsDueDatesMarksOverdueTodosAndHasTheFilter()
+    {
+        await _client.PostAsJsonAsync("/todos", new { title = "late", dueDate = "2000-01-01" });
+        await _client.PostAsJsonAsync("/todos", new { title = "later", dueDate = "2999-01-01" });
+        var html = WebUtility.HtmlDecode(await _client.GetStringAsync("/"));
+        Assert.Contains("data-testid=\"overdue-filter\"", html);
+        Assert.Contains("nur überfällige", html);
+        Assert.Contains("data-testid=\"todo-due\">2000-01-01<", html);
+        Assert.Contains("data-testid=\"todo-due\">2999-01-01<", html);
+        Assert.Single(System.Text.RegularExpressions.Regex.Matches(html, "data-testid=\"todo-overdue\">überfällig<"));
+    }
+
+    private static StringContent JsonContent(string json) => new(json, null, "application/json");
 }
diff --git a/tests/DemoTodo.Tests/TodoStoreDueDateTests.cs b/tests/DemoTodo.Tests/TodoStoreDueDateTests.cs
new file mode 100644
index 0000000..e39e259
--- /dev/null
+++ b/tests/DemoTodo.Tests/TodoStoreDueDateTests.cs
@@ -0,0 +1,71 @@
+using System.ComponentModel.DataAnnotations;
+using System.Globalization;
+using System.Text.Json;
+
+namespace DemoTodo.Tests;
+
+public class TodoStoreDueDateTests
+{
+    private static TodoStore Store() => new(new FixedTime("2026-05-10"));
+
+    private static JsonElement Json(object? value) => JsonSerializer.SerializeToElement(value);
+
+    [Fact]
+    public void ATodoGetsAnOptionalDueDate()
+    {
+        var store = Store();
+        Assert.Null(store.Add(new NewTodo("A")).DueDate);
+        Assert.Equal(new DateOnly(2026, 5, 20), store.Add(new NewTodo("B", Json("2026-05-20"))).DueDate);
+    }
+
+    [Fact]
+    public void TheDueDateCanBeChangedKeptAndCleared()
+    {
+        var store = Store();
+        var id = store.Add(new NewTodo("A", Json("2026-05-20"))).Id;
+        Assert.Equal(new DateOnly(2026, 6, 1), store.Update(id, new TodoPatch(null, null, Json("2026-06-01")))!.DueDate);
+        Assert.Equal(new DateOnly(2026, 6, 1), store.Update(id, new TodoPatch(null, true))!.DueDate);
+        Assert.Null(store.Update(id, new TodoPatch(null, null, Json(null)))!.DueDate);
+    }
+
+    [Theory]
+    [InlineData("\"2026-02-30\"")]
+    [InlineData("\"10.05.2026\"")]
+    [InlineData("\"2026-5-1\"")]
+    [InlineData("\"2026-05-10T12:00:00Z\"")]
+    [InlineData("20260510")]
+    [InlineData("true")]
+    public void RejectsMalformedAndImpossibleDueDates(string json)
+    {
+        var dueDate = JsonDocument.Parse(json).RootElement;
+        Assert.Throws<ValidationException>(() => Store().Add(new NewTodo("A", dueDate)));
+    }
+
+    [Fact]
+    public void OverdueMeansNotDoneAndDueBeforeTodayInUtc()
+    {
+        var store = Store();
+        store.Add(new NewTodo("late", Json("2026-05-09")));
+        var done = store.Add(new NewTodo("late but done", Json("2026-05-01")));
+        store.Update(done.Id, new TodoPatch(null, true));
+        store.Add(new NewTodo("today", Json("2026-05-10")));
+        store.Add(new NewTodo("no date"));
+        Assert.Equal(["late"], store.List(overdueOnly: true).Select(t => t.Title));
+        Assert.Equal([true, false, false, false], store.List().Select(t => t.Overdue));
+    }
+
+    [Fact]
+    public void TodayIsTheUtcDate()
+    {
+        // 01:30 on 10 May in UTC+2 is still 9 May in UTC: a todo due on 9 May is not overdue yet.
+        var store = new TodoStore(new FixedTime(DateTimeOffset.Parse("2026-05-10T01:30:00+02:00", CultureInfo.InvariantCulture)));
+        Assert.False(store.Add(new NewTodo("A", Json("2026-05-09"))).Overdue);
+    }
+
+    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
+    {
+        public FixedTime(string today) : this(DateTimeOffset.Parse($"{today}T12:00:00Z", CultureInfo.InvariantCulture)) { }
+
+        public override DateTimeOffset GetUtcNow() => now;
+    }
+}
diff --git a/tests/DemoTodo.Tests/TodoStoreTests.cs b/tests/DemoTodo.Tests/TodoStoreTests.cs
index 25b31fb..f9135d4 100644
--- a/tests/DemoTodo.Tests/TodoStoreTests.cs
+++ b/tests/DemoTodo.Tests/TodoStoreTests.cs
@@ -7,7 +7,7 @@ public class TodoStoreTests
     [Fact]
     public void AddsTodosWithSequentialIdsAndTrimmedTitles()
     {
-        var store = new TodoStore();
+        var store = new TodoStore(TimeProvider.System);
         store.Add(new NewTodo("A"));
         var todo = store.Add(new NewTodo("  B  "));
         Assert.Equal(new Todo(2, "B", false), todo);
@@ -17,13 +17,13 @@ public class TodoStoreTests
     [Fact]
     public void RejectsAMissingTitle()
     {
-        Assert.Throws<ValidationException>(() => new TodoStore().Add(new NewTodo(null)));
+        Assert.Throws<ValidationException>(() => new TodoStore(TimeProvider.System).Add(new NewTodo(null)));
     }
 
     [Fact]
     public void UpdatesOnlyTheGivenFields()
     {
-        var store = new TodoStore();
+        var store = new TodoStore(TimeProvider.System);
         var todo = store.Add(new NewTodo("A"));
         Assert.Equal(todo with { Done = true }, store.Update(todo.Id, new TodoPatch(null, true)));
         Assert.Null(store.Update(42, new TodoPatch("B", null)));
````

#### `alt-interface.patch`

````diff
diff --git a/src/DemoTodo/Components/Pages/Home.razor b/src/DemoTodo/Components/Pages/Home.razor
index 10e75f0..480b5c7 100644
--- a/src/DemoTodo/Components/Pages/Home.razor
+++ b/src/DemoTodo/Components/Pages/Home.razor
@@ -6,11 +6,23 @@
 
 <h1>Todos</h1>
 
-<ul data-testid="todo-list">
-    @foreach (var todo in Store.List())
-    {
-        <li data-testid="todo-item">
-            <span data-testid="todo-title">@todo.Title@(todo.Done ? " ✓" : "")</span>
-        </li>
-    }
-</ul>
+<button type="button" class="btn btn-outline-secondary btn-sm mb-2" data-testid="only-overdue"
+        aria-pressed="@(onlyOverdue ? "true" : "false")" @onclick="() => onlyOverdue = !onlyOverdue">nur überfällige</button>
+
+<table class="table">
+    <thead><tr><th>Aufgabe</th><th>Fällig am</th><th>Status</th></tr></thead>
+    <tbody data-testid="todo-list">
+        @foreach (var todo in Store.List(onlyOverdue))
+        {
+            <tr data-testid="todo-item">
+                <td data-testid="todo-title">@todo.Title@(todo.Done ? " ✓" : "")</td>
+                <td data-testid="todo-due">@todo.Due?.ToString("dd.MM.yyyy")</td>
+                <td data-testid="todo-status">@(todo.IsOverdue ? "überfällig" : "")</td>
+            </tr>
+        }
+    </tbody>
+</table>
+
+@code {
+    private bool onlyOverdue;
+}
diff --git a/src/DemoTodo/Program.cs b/src/DemoTodo/Program.cs
index fd7934d..230bf68 100644
--- a/src/DemoTodo/Program.cs
+++ b/src/DemoTodo/Program.cs
@@ -7,6 +7,7 @@ var builder = WebApplication.CreateBuilder(args);
 // Add services to the container.
 builder.Services.AddRazorComponents()
     .AddInteractiveServerComponents();
+builder.Services.AddSingleton(TimeProvider.System);
 builder.Services.AddSingleton<TodoStore>();
 // Malformed JSON bodies throw in every environment, so the handler below turns them into a 400.
 builder.Services.Configure<RouteHandlerOptions>(options => options.ThrowOnBadRequest = true);
@@ -47,7 +48,8 @@ app.MapRazorComponents<App>()
 app.MapGet("/health", () => new { ok = true });
 
 var todos = app.MapGroup("/todos");
-todos.MapGet("", (TodoStore store) => store.List());
+// ?overdue=1 lists only overdue todos.
+todos.MapGet("", (TodoStore store, string? overdue) => store.List(onlyOverdue: overdue == "1"));
 todos.MapPost("", (NewTodo input, TodoStore store) =>
 {
     var todo = store.Add(input);
diff --git a/src/DemoTodo/TodoStore.cs b/src/DemoTodo/TodoStore.cs
index c5509e1..63d43d1 100644
--- a/src/DemoTodo/TodoStore.cs
+++ b/src/DemoTodo/TodoStore.cs
@@ -1,39 +1,49 @@
 using System.ComponentModel.DataAnnotations;
+using System.Text.Json;
 
 namespace DemoTodo;
 
-public record Todo(int Id, string Title, bool Done);
+public record Todo(int Id, string Title, bool Done, DateOnly? Due = null)
+{
+    public bool IsOverdue { get; init; }
+}
 
-public record NewTodo(string? Title);
+// Due is kept as raw JSON: a missing field leaves the due date alone, null removes it.
+public record NewTodo(string? Title, JsonElement Due = default);
 
-public record TodoPatch(string? Title, bool? Done);
+public record TodoPatch(string? Title, bool? Done, JsonElement Due = default);
 
 // In-memory todo store, registered as a singleton: the API and the list page share it.
-public class TodoStore
+public class TodoStore(TimeProvider clock)
 {
     private readonly Lock _lock = new();
     private readonly SortedDictionary<int, Todo> _todos = [];
     private int _nextId = 1;
 
-    public IReadOnlyList<Todo> List()
+    public IReadOnlyList<Todo> List(bool onlyOverdue = false)
     {
-        lock (_lock) return [.. _todos.Values];
+        lock (_lock)
+        {
+            var all = _todos.Values.Select(WithStatus);
+            return [.. onlyOverdue ? all.Where(todo => todo.IsOverdue) : all];
+        }
     }
 
     public Todo? Get(int id)
     {
-        lock (_lock) return _todos.GetValueOrDefault(id);
+        lock (_lock) return _todos.TryGetValue(id, out var todo) ? WithStatus(todo) : null;
     }
 
     public Todo Add(NewTodo input)
     {
         var title = input.Title?.Trim();
         if (string.IsNullOrEmpty(title)) throw new ValidationException("title is required");
+        var due = CheckDue(input.Due);
         lock (_lock)
         {
-            var todo = new Todo(_nextId++, title, false);
+            var todo = new Todo(_nextId++, title, false, due);
             _todos[todo.Id] = todo;
-            return todo;
+            return WithStatus(todo);
         }
     }
 
@@ -41,12 +51,14 @@ public class TodoStore
     {
         var title = patch.Title?.Trim();
         if (patch.Title is not null && title == "") throw new ValidationException("title must be a non-empty string");
+        var due = CheckDue(patch.Due);
         lock (_lock)
         {
             if (!_todos.TryGetValue(id, out var todo)) return null;
             todo = todo with { Title = title ?? todo.Title, Done = patch.Done ?? todo.Done };
+            if (patch.Due.ValueKind != JsonValueKind.Undefined) todo = todo with { Due = due };
             _todos[id] = todo;
-            return todo;
+            return WithStatus(todo);
         }
     }
 
@@ -54,4 +66,23 @@ public class TodoStore
     {
         lock (_lock) return _todos.Remove(id);
     }
+
+    private Todo WithStatus(Todo todo)
+    {
+        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
+        return todo with { IsOverdue = !todo.Done && todo.Due is { } due && due < today };
+    }
+
+    // Due is an ISO calendar date without time (JJJJ-MM-TT), or null for "no due date".
+    private static DateOnly? CheckDue(JsonElement due)
+    {
+        if (due.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null) return null;
+        var text = due.ValueKind == JsonValueKind.String ? due.GetString()! : "";
+        var match = System.Text.RegularExpressions.Regex.Match(text, @"^(\d{4})-(\d{2})-(\d{2})$");
+        if (!match.Success) throw new ValidationException("Fälligkeit muss ein Datum JJJJ-MM-TT sein");
+        var (year, month, day) = (int.Parse(match.Groups[1].Value), int.Parse(match.Groups[2].Value), int.Parse(match.Groups[3].Value));
+        if (month is < 1 or > 12 || day < 1 || day > DateTime.DaysInMonth(year, month) || year < 1)
+            throw new ValidationException("Fälligkeit ist kein gültiges Datum");
+        return new DateOnly(year, month, day);
+    }
 }
diff --git a/tests/DemoTodo.Tests/DueDateTests.cs b/tests/DemoTodo.Tests/DueDateTests.cs
new file mode 100644
index 0000000..bac9e65
--- /dev/null
+++ b/tests/DemoTodo.Tests/DueDateTests.cs
@@ -0,0 +1,45 @@
+using System.ComponentModel.DataAnnotations;
+using System.Text.Json;
+
+namespace DemoTodo.Tests;
+
+public class DueDateTests
+{
+    private static TodoStore At(string day) => new(new Clock(DateTimeOffset.Parse(day + "T08:00:00Z")));
+
+    private static JsonElement Due(object? value) => JsonSerializer.SerializeToElement(value);
+
+    [Fact]
+    public void DueIsOptionalCanBeSetChangedAndRemoved()
+    {
+        var store = At("2026-05-10");
+        Assert.Null(store.Add(new NewTodo("A")).Due);
+        var id = store.Add(new NewTodo("B", Due("2026-05-20"))).Id;
+        Assert.Equal(new DateOnly(2026, 6, 1), store.Update(id, new TodoPatch(null, null, Due("2026-06-01")))!.Due);
+        Assert.Null(store.Update(id, new TodoPatch(null, null, Due(null)))!.Due);
+    }
+
+    [Fact]
+    public void InvalidDueDatesAreValidationErrors()
+    {
+        foreach (var due in new object[] { "2026-02-30", "01.05.2026", "2026-13-01", 5 })
+            Assert.Throws<ValidationException>(() => At("2026-05-10").Add(new NewTodo("A", Due(due))));
+    }
+
+    [Fact]
+    public void OnlyOpenTodosDueBeforeTodayAreOverdue()
+    {
+        var store = At("2026-05-10");
+        store.Add(new NewTodo("late", Due("2026-05-09")));
+        var done = store.Add(new NewTodo("done", Due("2026-05-01")));
+        store.Update(done.Id, new TodoPatch(null, true));
+        store.Add(new NewTodo("today", Due("2026-05-10")));
+        store.Add(new NewTodo("none"));
+        Assert.Equal(["late"], store.List(onlyOverdue: true).Select(t => t.Title));
+    }
+
+    private sealed class Clock(DateTimeOffset now) : TimeProvider
+    {
+        public override DateTimeOffset GetUtcNow() => now;
+    }
+}
diff --git a/tests/DemoTodo.Tests/TodoApiTests.cs b/tests/DemoTodo.Tests/TodoApiTests.cs
index f20e459..c625a7f 100644
--- a/tests/DemoTodo.Tests/TodoApiTests.cs
+++ b/tests/DemoTodo.Tests/TodoApiTests.cs
@@ -20,7 +20,7 @@ public class TodoApiTests : IDisposable
         var created = await _client.PostAsJsonAsync("/todos", new { title = "Milch kaufen" });
         Assert.Equal(HttpStatusCode.Created, created.StatusCode);
         var list = await _client.GetStringAsync("/todos");
-        Assert.Equal("""[{"id":1,"title":"Milch kaufen","done":false}]""", list);
+        Assert.Equal("""[{"id":1,"title":"Milch kaufen","done":false,"due":null,"isOverdue":false}]""", list);
     }
 
     [Fact]
@@ -62,4 +62,21 @@ public class TodoApiTests : IDisposable
         Assert.Contains("data-testid=\"todo-list\"", html);
         Assert.Contains("Milch kaufen", html);
     }
+
+    [Fact]
+    public async Task OverdueQueryListsOverdueTodosOnly()
+    {
+        await _client.PostAsJsonAsync("/todos", new { title = "old", due = "2001-01-01" });
+        await _client.PostAsJsonAsync("/todos", new { title = "new", due = "2999-01-01" });
+        var list = await _client.GetFromJsonAsync<Todo[]>("/todos?overdue=1");
+        Assert.Equal(["old"], list!.Select(t => t.Title));
+    }
+
+    [Fact]
+    public async Task AnImpossibleDueDateIsABadRequest()
+    {
+        await _client.PostAsJsonAsync("/todos", new { title = "A" });
+        var res = await _client.PatchAsJsonAsync("/todos/1", new { due = "2026-04-31" });
+        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
+    }
 }
diff --git a/tests/DemoTodo.Tests/TodoStoreTests.cs b/tests/DemoTodo.Tests/TodoStoreTests.cs
index 25b31fb..f9135d4 100644
--- a/tests/DemoTodo.Tests/TodoStoreTests.cs
+++ b/tests/DemoTodo.Tests/TodoStoreTests.cs
@@ -7,7 +7,7 @@ public class TodoStoreTests
     [Fact]
     public void AddsTodosWithSequentialIdsAndTrimmedTitles()
     {
-        var store = new TodoStore();
+        var store = new TodoStore(TimeProvider.System);
         store.Add(new NewTodo("A"));
         var todo = store.Add(new NewTodo("  B  "));
         Assert.Equal(new Todo(2, "B", false), todo);
@@ -17,13 +17,13 @@ public class TodoStoreTests
     [Fact]
     public void RejectsAMissingTitle()
     {
-        Assert.Throws<ValidationException>(() => new TodoStore().Add(new NewTodo(null)));
+        Assert.Throws<ValidationException>(() => new TodoStore(TimeProvider.System).Add(new NewTodo(null)));
     }
 
     [Fact]
     public void UpdatesOnlyTheGivenFields()
     {
-        var store = new TodoStore();
+        var store = new TodoStore(TimeProvider.System);
         var todo = store.Add(new NewTodo("A"));
         Assert.Equal(todo with { Done = true }, store.Update(todo.Id, new TodoPatch(null, true)));
         Assert.Null(store.Update(42, new TodoPatch("B", null)));
````

#### `broken-done.patch`

````diff
diff --git a/src/DemoTodo/Components/Pages/Home.razor b/src/DemoTodo/Components/Pages/Home.razor
index 10e75f0..bc8834d 100644
--- a/src/DemoTodo/Components/Pages/Home.razor
+++ b/src/DemoTodo/Components/Pages/Home.razor
@@ -6,11 +6,28 @@
 
 <h1>Todos</h1>
 
+<label class="form-check">
+    <input class="form-check-input" type="checkbox" data-testid="overdue-filter" @bind="onlyOverdue" />
+    nur überfällige
+</label>
+
 <ul data-testid="todo-list">
-    @foreach (var todo in Store.List())
+    @foreach (var todo in Store.List().Where(todo => !onlyOverdue || todo.Overdue))
     {
         <li data-testid="todo-item">
             <span data-testid="todo-title">@todo.Title@(todo.Done ? " ✓" : "")</span>
+            @if (todo.DueDate is { } dueDate)
+            {
+                <span class="ms-2" data-testid="todo-due">@dueDate.ToString("yyyy-MM-dd")</span>
+            }
+            @if (todo.Overdue)
+            {
+                <strong class="badge text-bg-danger ms-2" data-testid="todo-overdue">überfällig</strong>
+            }
         </li>
     }
 </ul>
+
+@code {
+    private bool onlyOverdue;
+}
diff --git a/src/DemoTodo/Program.cs b/src/DemoTodo/Program.cs
index fd7934d..247c391 100644
--- a/src/DemoTodo/Program.cs
+++ b/src/DemoTodo/Program.cs
@@ -7,6 +7,7 @@ var builder = WebApplication.CreateBuilder(args);
 // Add services to the container.
 builder.Services.AddRazorComponents()
     .AddInteractiveServerComponents();
+builder.Services.AddSingleton(TimeProvider.System);
 builder.Services.AddSingleton<TodoStore>();
 // Malformed JSON bodies throw in every environment, so the handler below turns them into a 400.
 builder.Services.Configure<RouteHandlerOptions>(options => options.ThrowOnBadRequest = true);
@@ -47,7 +48,7 @@ app.MapRazorComponents<App>()
 app.MapGet("/health", () => new { ok = true });
 
 var todos = app.MapGroup("/todos");
-todos.MapGet("", (TodoStore store) => store.List());
+todos.MapGet("", (TodoStore store, bool overdue = false) => store.List(overdue));
 todos.MapPost("", (NewTodo input, TodoStore store) =>
 {
     var todo = store.Add(input);
diff --git a/src/DemoTodo/TodoStore.cs b/src/DemoTodo/TodoStore.cs
index c5509e1..2551e5b 100644
--- a/src/DemoTodo/TodoStore.cs
+++ b/src/DemoTodo/TodoStore.cs
@@ -1,39 +1,48 @@
 using System.ComponentModel.DataAnnotations;
+using System.Globalization;
+using System.Text.Json;
 
 namespace DemoTodo;
 
-public record Todo(int Id, string Title, bool Done);
+public record Todo(int Id, string Title, bool Done, DateOnly? DueDate = null)
+{
+    // Computed from DueDate and today on every read, never stored.
+    public bool Overdue { get; init; }
+}
 
-public record NewTodo(string? Title);
+// DueDate stays raw JSON, so a PATCH can tell an absent field (keep the due date) from null (remove it).
+public record NewTodo(string? Title, JsonElement DueDate = default);
 
-public record TodoPatch(string? Title, bool? Done);
+public record TodoPatch(string? Title, bool? Done, JsonElement DueDate = default);
 
 // In-memory todo store, registered as a singleton: the API and the list page share it.
-public class TodoStore
+public class TodoStore(TimeProvider time)
 {
     private readonly Lock _lock = new();
     private readonly SortedDictionary<int, Todo> _todos = [];
     private int _nextId = 1;
 
-    public IReadOnlyList<Todo> List()
+    public IReadOnlyList<Todo> List(bool overdueOnly = false)
     {
-        lock (_lock) return [.. _todos.Values];
+        var today = Today();
+        lock (_lock) return [.. _todos.Values.Select(todo => View(todo, today)).Where(todo => !overdueOnly || todo.DueDate < today)];
     }
 
     public Todo? Get(int id)
     {
-        lock (_lock) return _todos.GetValueOrDefault(id);
+        lock (_lock) return _todos.TryGetValue(id, out var todo) ? View(todo, Today()) : null;
     }
 
     public Todo Add(NewTodo input)
     {
         var title = input.Title?.Trim();
         if (string.IsNullOrEmpty(title)) throw new ValidationException("title is required");
+        var dueDate = ParseDueDate(input.DueDate);
         lock (_lock)
         {
-            var todo = new Todo(_nextId++, title, false);
+            var todo = new Todo(_nextId++, title, false, dueDate);
             _todos[todo.Id] = todo;
-            return todo;
+            return View(todo, Today());
         }
     }
 
@@ -41,12 +50,19 @@ public class TodoStore
     {
         var title = patch.Title?.Trim();
         if (patch.Title is not null && title == "") throw new ValidationException("title must be a non-empty string");
+        var changesDueDate = patch.DueDate.ValueKind != JsonValueKind.Undefined;
+        var dueDate = ParseDueDate(patch.DueDate);
         lock (_lock)
         {
             if (!_todos.TryGetValue(id, out var todo)) return null;
-            todo = todo with { Title = title ?? todo.Title, Done = patch.Done ?? todo.Done };
+            todo = todo with
+            {
+                Title = title ?? todo.Title,
+                Done = patch.Done ?? todo.Done,
+                DueDate = changesDueDate ? dueDate : todo.DueDate,
+            };
             _todos[id] = todo;
-            return todo;
+            return View(todo, Today());
         }
     }
 
@@ -54,4 +70,21 @@ public class TodoStore
     {
         lock (_lock) return _todos.Remove(id);
     }
+
+    // A due date is a calendar date (yyyy-MM-dd) or null.
+    public static DateOnly? ParseDueDate(JsonElement value) => value.ValueKind switch
+    {
+        JsonValueKind.Undefined or JsonValueKind.Null => null,
+        JsonValueKind.String when DateOnly.TryParseExact(value.GetString(), "yyyy-MM-dd",
+            CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) => date,
+        _ => throw new ValidationException("dueDate must be a valid date in the form yyyy-MM-dd, or null"),
+    };
+
+    // Overdue: not done and due before today.
+    public static bool IsOverdue(Todo todo, DateOnly today) => !todo.Done && todo.DueDate < today;
+
+    // "Today" is the current date in UTC.
+    private DateOnly Today() => DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime);
+
+    private static Todo View(Todo todo, DateOnly today) => todo with { Overdue = IsOverdue(todo, today) };
 }
diff --git a/tests/DemoTodo.Tests/TodoApiTests.cs b/tests/DemoTodo.Tests/TodoApiTests.cs
index f20e459..4884927 100644
--- a/tests/DemoTodo.Tests/TodoApiTests.cs
+++ b/tests/DemoTodo.Tests/TodoApiTests.cs
@@ -20,7 +20,7 @@ public class TodoApiTests : IDisposable
         var created = await _client.PostAsJsonAsync("/todos", new { title = "Milch kaufen" });
         Assert.Equal(HttpStatusCode.Created, created.StatusCode);
         var list = await _client.GetStringAsync("/todos");
-        Assert.Equal("""[{"id":1,"title":"Milch kaufen","done":false}]""", list);
+        Assert.Equal("""[{"id":1,"title":"Milch kaufen","done":false,"dueDate":null,"overdue":false}]""", list);
     }
 
     [Fact]
@@ -62,4 +62,20 @@ public class TodoApiTests : IDisposable
         Assert.Contains("data-testid=\"todo-list\"", html);
         Assert.Contains("Milch kaufen", html);
     }
+
+    [Fact]
+    public async Task RejectsAnInvalidDueDate()
+    {
+        var res = await _client.PostAsJsonAsync("/todos", new { title = "A", dueDate = "2026-02-30" });
+        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
+    }
+
+    [Fact]
+    public async Task ListsOnlyOverdueTodosWithTheOverdueQuery()
+    {
+        await _client.PostAsJsonAsync("/todos", new { title = "late", dueDate = "2000-01-01" });
+        await _client.PostAsJsonAsync("/todos", new { title = "later", dueDate = "2999-01-01" });
+        var list = await _client.GetFromJsonAsync<Todo[]>("/todos?overdue=true");
+        Assert.Equal(["late"], list!.Select(t => t.Title));
+    }
 }
diff --git a/tests/DemoTodo.Tests/TodoStoreDueDateTests.cs b/tests/DemoTodo.Tests/TodoStoreDueDateTests.cs
new file mode 100644
index 0000000..d13589d
--- /dev/null
+++ b/tests/DemoTodo.Tests/TodoStoreDueDateTests.cs
@@ -0,0 +1,69 @@
+using System.ComponentModel.DataAnnotations;
+using System.Globalization;
+using System.Text.Json;
+
+namespace DemoTodo.Tests;
+
+public class TodoStoreDueDateTests
+{
+    private static TodoStore Store() => new(new FixedTime("2026-05-10"));
+
+    private static JsonElement Json(object? value) => JsonSerializer.SerializeToElement(value);
+
+    [Fact]
+    public void ATodoGetsAnOptionalDueDate()
+    {
+        var store = Store();
+        Assert.Null(store.Add(new NewTodo("A")).DueDate);
+        Assert.Equal(new DateOnly(2026, 5, 20), store.Add(new NewTodo("B", Json("2026-05-20"))).DueDate);
+    }
+
+    [Fact]
+    public void TheDueDateCanBeChangedKeptAndCleared()
+    {
+        var store = Store();
+        var id = store.Add(new NewTodo("A", Json("2026-05-20"))).Id;
+        Assert.Equal(new DateOnly(2026, 6, 1), store.Update(id, new TodoPatch(null, null, Json("2026-06-01")))!.DueDate);
+        Assert.Equal(new DateOnly(2026, 6, 1), store.Update(id, new TodoPatch(null, true))!.DueDate);
+        Assert.Null(store.Update(id, new TodoPatch(null, null, Json(null)))!.DueDate);
+    }
+
+    [Theory]
+    [InlineData("\"2026-02-30\"")]
+    [InlineData("\"10.05.2026\"")]
+    [InlineData("\"2026-5-1\"")]
+    [InlineData("\"2026-05-10T12:00:00Z\"")]
+    [InlineData("20260510")]
+    [InlineData("true")]
+    public void RejectsMalformedAndImpossibleDueDates(string json)
+    {
+        var dueDate = JsonDocument.Parse(json).RootElement;
+        Assert.Throws<ValidationException>(() => Store().Add(new NewTodo("A", dueDate)));
+    }
+
+    [Fact]
+    public void OverdueMeansDueBeforeTodayInUtc()
+    {
+        var store = Store();
+        store.Add(new NewTodo("late", Json("2026-05-09")));
+        store.Add(new NewTodo("today", Json("2026-05-10")));
+        store.Add(new NewTodo("no date"));
+        Assert.Equal(["late"], store.List(overdueOnly: true).Select(t => t.Title));
+        Assert.Equal([true, false, false], store.List().Select(t => t.Overdue));
+    }
+
+    [Fact]
+    public void TodayIsTheUtcDate()
+    {
+        // 01:30 on 10 May in UTC+2 is still 9 May in UTC: a todo due on 9 May is not overdue yet.
+        var store = new TodoStore(new FixedTime(DateTimeOffset.Parse("2026-05-10T01:30:00+02:00", CultureInfo.InvariantCulture)));
+        Assert.False(store.Add(new NewTodo("A", Json("2026-05-09"))).Overdue);
+    }
+
+    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
+    {
+        public FixedTime(string today) : this(DateTimeOffset.Parse($"{today}T12:00:00Z", CultureInfo.InvariantCulture)) { }
+
+        public override DateTimeOffset GetUtcNow() => now;
+    }
+}
diff --git a/tests/DemoTodo.Tests/TodoStoreTests.cs b/tests/DemoTodo.Tests/TodoStoreTests.cs
index 25b31fb..f9135d4 100644
--- a/tests/DemoTodo.Tests/TodoStoreTests.cs
+++ b/tests/DemoTodo.Tests/TodoStoreTests.cs
@@ -7,7 +7,7 @@ public class TodoStoreTests
     [Fact]
     public void AddsTodosWithSequentialIdsAndTrimmedTitles()
     {
-        var store = new TodoStore();
+        var store = new TodoStore(TimeProvider.System);
         store.Add(new NewTodo("A"));
         var todo = store.Add(new NewTodo("  B  "));
         Assert.Equal(new Todo(2, "B", false), todo);
@@ -17,13 +17,13 @@ public class TodoStoreTests
     [Fact]
     public void RejectsAMissingTitle()
     {
-        Assert.Throws<ValidationException>(() => new TodoStore().Add(new NewTodo(null)));
+        Assert.Throws<ValidationException>(() => new TodoStore(TimeProvider.System).Add(new NewTodo(null)));
     }
 
     [Fact]
     public void UpdatesOnlyTheGivenFields()
     {
-        var store = new TodoStore();
+        var store = new TodoStore(TimeProvider.System);
         var todo = store.Add(new NewTodo("A"));
         Assert.Equal(todo with { Done = true }, store.Update(todo.Id, new TodoPatch(null, true)));
         Assert.Null(store.Update(42, new TodoPatch("B", null)));
````

#### `broken-ui.patch`

````diff
diff --git a/src/DemoTodo/Components/Pages/Home.razor b/src/DemoTodo/Components/Pages/Home.razor
index 10e75f0..a762eb2 100644
--- a/src/DemoTodo/Components/Pages/Home.razor
+++ b/src/DemoTodo/Components/Pages/Home.razor
@@ -6,11 +6,24 @@
 
 <h1>Todos</h1>
 
+<label class="form-check">
+    <input class="form-check-input" type="checkbox" data-testid="overdue-filter" checked="@onlyOverdue" />
+    nur überfällige
+</label>
+
 <ul data-testid="todo-list">
-    @foreach (var todo in Store.List())
+    @foreach (var todo in Store.List().Where(todo => !onlyOverdue || todo.Overdue))
     {
         <li data-testid="todo-item">
             <span data-testid="todo-title">@todo.Title@(todo.Done ? " ✓" : "")</span>
+            @if (todo.DueDate is { } dueDate)
+            {
+                <span class="ms-2" data-testid="todo-due">@dueDate.ToString("yyyy-MM-dd")</span>
+            }
         </li>
     }
 </ul>
+
+@code {
+    private bool onlyOverdue = false;
+}
diff --git a/src/DemoTodo/Program.cs b/src/DemoTodo/Program.cs
index fd7934d..247c391 100644
--- a/src/DemoTodo/Program.cs
+++ b/src/DemoTodo/Program.cs
@@ -7,6 +7,7 @@ var builder = WebApplication.CreateBuilder(args);
 // Add services to the container.
 builder.Services.AddRazorComponents()
     .AddInteractiveServerComponents();
+builder.Services.AddSingleton(TimeProvider.System);
 builder.Services.AddSingleton<TodoStore>();
 // Malformed JSON bodies throw in every environment, so the handler below turns them into a 400.
 builder.Services.Configure<RouteHandlerOptions>(options => options.ThrowOnBadRequest = true);
@@ -47,7 +48,7 @@ app.MapRazorComponents<App>()
 app.MapGet("/health", () => new { ok = true });
 
 var todos = app.MapGroup("/todos");
-todos.MapGet("", (TodoStore store) => store.List());
+todos.MapGet("", (TodoStore store, bool overdue = false) => store.List(overdue));
 todos.MapPost("", (NewTodo input, TodoStore store) =>
 {
     var todo = store.Add(input);
diff --git a/src/DemoTodo/TodoStore.cs b/src/DemoTodo/TodoStore.cs
index c5509e1..58326a6 100644
--- a/src/DemoTodo/TodoStore.cs
+++ b/src/DemoTodo/TodoStore.cs
@@ -1,39 +1,48 @@
 using System.ComponentModel.DataAnnotations;
+using System.Globalization;
+using System.Text.Json;
 
 namespace DemoTodo;
 
-public record Todo(int Id, string Title, bool Done);
+public record Todo(int Id, string Title, bool Done, DateOnly? DueDate = null)
+{
+    // Computed from DueDate and today on every read, never stored.
+    public bool Overdue { get; init; }
+}
 
-public record NewTodo(string? Title);
+// DueDate stays raw JSON, so a PATCH can tell an absent field (keep the due date) from null (remove it).
+public record NewTodo(string? Title, JsonElement DueDate = default);
 
-public record TodoPatch(string? Title, bool? Done);
+public record TodoPatch(string? Title, bool? Done, JsonElement DueDate = default);
 
 // In-memory todo store, registered as a singleton: the API and the list page share it.
-public class TodoStore
+public class TodoStore(TimeProvider time)
 {
     private readonly Lock _lock = new();
     private readonly SortedDictionary<int, Todo> _todos = [];
     private int _nextId = 1;
 
-    public IReadOnlyList<Todo> List()
+    public IReadOnlyList<Todo> List(bool overdueOnly = false)
     {
-        lock (_lock) return [.. _todos.Values];
+        var today = Today();
+        lock (_lock) return [.. _todos.Values.Select(todo => View(todo, today)).Where(todo => !overdueOnly || todo.Overdue)];
     }
 
     public Todo? Get(int id)
     {
-        lock (_lock) return _todos.GetValueOrDefault(id);
+        lock (_lock) return _todos.TryGetValue(id, out var todo) ? View(todo, Today()) : null;
     }
 
     public Todo Add(NewTodo input)
     {
         var title = input.Title?.Trim();
         if (string.IsNullOrEmpty(title)) throw new ValidationException("title is required");
+        var dueDate = ParseDueDate(input.DueDate);
         lock (_lock)
         {
-            var todo = new Todo(_nextId++, title, false);
+            var todo = new Todo(_nextId++, title, false, dueDate);
             _todos[todo.Id] = todo;
-            return todo;
+            return View(todo, Today());
         }
     }
 
@@ -41,12 +50,19 @@ public class TodoStore
     {
         var title = patch.Title?.Trim();
         if (patch.Title is not null && title == "") throw new ValidationException("title must be a non-empty string");
+        var changesDueDate = patch.DueDate.ValueKind != JsonValueKind.Undefined;
+        var dueDate = ParseDueDate(patch.DueDate);
         lock (_lock)
         {
             if (!_todos.TryGetValue(id, out var todo)) return null;
-            todo = todo with { Title = title ?? todo.Title, Done = patch.Done ?? todo.Done };
+            todo = todo with
+            {
+                Title = title ?? todo.Title,
+                Done = patch.Done ?? todo.Done,
+                DueDate = changesDueDate ? dueDate : todo.DueDate,
+            };
             _todos[id] = todo;
-            return todo;
+            return View(todo, Today());
         }
     }
 
@@ -54,4 +70,21 @@ public class TodoStore
     {
         lock (_lock) return _todos.Remove(id);
     }
+
+    // A due date is a calendar date (yyyy-MM-dd) or null.
+    public static DateOnly? ParseDueDate(JsonElement value) => value.ValueKind switch
+    {
+        JsonValueKind.Undefined or JsonValueKind.Null => null,
+        JsonValueKind.String when DateOnly.TryParseExact(value.GetString(), "yyyy-MM-dd",
+            CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) => date,
+        _ => throw new ValidationException("dueDate must be a valid date in the form yyyy-MM-dd, or null"),
+    };
+
+    // Overdue: not done and due before today.
+    public static bool IsOverdue(Todo todo, DateOnly today) => !todo.Done && todo.DueDate < today;
+
+    // "Today" is the current date in UTC.
+    private DateOnly Today() => DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime);
+
+    private static Todo View(Todo todo, DateOnly today) => todo with { Overdue = IsOverdue(todo, today) };
 }
diff --git a/tests/DemoTodo.Tests/TodoApiTests.cs b/tests/DemoTodo.Tests/TodoApiTests.cs
index f20e459..4884927 100644
--- a/tests/DemoTodo.Tests/TodoApiTests.cs
+++ b/tests/DemoTodo.Tests/TodoApiTests.cs
@@ -20,7 +20,7 @@ public class TodoApiTests : IDisposable
         var created = await _client.PostAsJsonAsync("/todos", new { title = "Milch kaufen" });
         Assert.Equal(HttpStatusCode.Created, created.StatusCode);
         var list = await _client.GetStringAsync("/todos");
-        Assert.Equal("""[{"id":1,"title":"Milch kaufen","done":false}]""", list);
+        Assert.Equal("""[{"id":1,"title":"Milch kaufen","done":false,"dueDate":null,"overdue":false}]""", list);
     }
 
     [Fact]
@@ -62,4 +62,20 @@ public class TodoApiTests : IDisposable
         Assert.Contains("data-testid=\"todo-list\"", html);
         Assert.Contains("Milch kaufen", html);
     }
+
+    [Fact]
+    public async Task RejectsAnInvalidDueDate()
+    {
+        var res = await _client.PostAsJsonAsync("/todos", new { title = "A", dueDate = "2026-02-30" });
+        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
+    }
+
+    [Fact]
+    public async Task ListsOnlyOverdueTodosWithTheOverdueQuery()
+    {
+        await _client.PostAsJsonAsync("/todos", new { title = "late", dueDate = "2000-01-01" });
+        await _client.PostAsJsonAsync("/todos", new { title = "later", dueDate = "2999-01-01" });
+        var list = await _client.GetFromJsonAsync<Todo[]>("/todos?overdue=true");
+        Assert.Equal(["late"], list!.Select(t => t.Title));
+    }
 }
diff --git a/tests/DemoTodo.Tests/TodoStoreDueDateTests.cs b/tests/DemoTodo.Tests/TodoStoreDueDateTests.cs
new file mode 100644
index 0000000..e39e259
--- /dev/null
+++ b/tests/DemoTodo.Tests/TodoStoreDueDateTests.cs
@@ -0,0 +1,71 @@
+using System.ComponentModel.DataAnnotations;
+using System.Globalization;
+using System.Text.Json;
+
+namespace DemoTodo.Tests;
+
+public class TodoStoreDueDateTests
+{
+    private static TodoStore Store() => new(new FixedTime("2026-05-10"));
+
+    private static JsonElement Json(object? value) => JsonSerializer.SerializeToElement(value);
+
+    [Fact]
+    public void ATodoGetsAnOptionalDueDate()
+    {
+        var store = Store();
+        Assert.Null(store.Add(new NewTodo("A")).DueDate);
+        Assert.Equal(new DateOnly(2026, 5, 20), store.Add(new NewTodo("B", Json("2026-05-20"))).DueDate);
+    }
+
+    [Fact]
+    public void TheDueDateCanBeChangedKeptAndCleared()
+    {
+        var store = Store();
+        var id = store.Add(new NewTodo("A", Json("2026-05-20"))).Id;
+        Assert.Equal(new DateOnly(2026, 6, 1), store.Update(id, new TodoPatch(null, null, Json("2026-06-01")))!.DueDate);
+        Assert.Equal(new DateOnly(2026, 6, 1), store.Update(id, new TodoPatch(null, true))!.DueDate);
+        Assert.Null(store.Update(id, new TodoPatch(null, null, Json(null)))!.DueDate);
+    }
+
+    [Theory]
+    [InlineData("\"2026-02-30\"")]
+    [InlineData("\"10.05.2026\"")]
+    [InlineData("\"2026-5-1\"")]
+    [InlineData("\"2026-05-10T12:00:00Z\"")]
+    [InlineData("20260510")]
+    [InlineData("true")]
+    public void RejectsMalformedAndImpossibleDueDates(string json)
+    {
+        var dueDate = JsonDocument.Parse(json).RootElement;
+        Assert.Throws<ValidationException>(() => Store().Add(new NewTodo("A", dueDate)));
+    }
+
+    [Fact]
+    public void OverdueMeansNotDoneAndDueBeforeTodayInUtc()
+    {
+        var store = Store();
+        store.Add(new NewTodo("late", Json("2026-05-09")));
+        var done = store.Add(new NewTodo("late but done", Json("2026-05-01")));
+        store.Update(done.Id, new TodoPatch(null, true));
+        store.Add(new NewTodo("today", Json("2026-05-10")));
+        store.Add(new NewTodo("no date"));
+        Assert.Equal(["late"], store.List(overdueOnly: true).Select(t => t.Title));
+        Assert.Equal([true, false, false, false], store.List().Select(t => t.Overdue));
+    }
+
+    [Fact]
+    public void TodayIsTheUtcDate()
+    {
+        // 01:30 on 10 May in UTC+2 is still 9 May in UTC: a todo due on 9 May is not overdue yet.
+        var store = new TodoStore(new FixedTime(DateTimeOffset.Parse("2026-05-10T01:30:00+02:00", CultureInfo.InvariantCulture)));
+        Assert.False(store.Add(new NewTodo("A", Json("2026-05-09"))).Overdue);
+    }
+
+    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
+    {
+        public FixedTime(string today) : this(DateTimeOffset.Parse($"{today}T12:00:00Z", CultureInfo.InvariantCulture)) { }
+
+        public override DateTimeOffset GetUtcNow() => now;
+    }
+}
diff --git a/tests/DemoTodo.Tests/TodoStoreTests.cs b/tests/DemoTodo.Tests/TodoStoreTests.cs
index 25b31fb..f9135d4 100644
--- a/tests/DemoTodo.Tests/TodoStoreTests.cs
+++ b/tests/DemoTodo.Tests/TodoStoreTests.cs
@@ -7,7 +7,7 @@ public class TodoStoreTests
     [Fact]
     public void AddsTodosWithSequentialIdsAndTrimmedTitles()
     {
-        var store = new TodoStore();
+        var store = new TodoStore(TimeProvider.System);
         store.Add(new NewTodo("A"));
         var todo = store.Add(new NewTodo("  B  "));
         Assert.Equal(new Todo(2, "B", false), todo);
@@ -17,13 +17,13 @@ public class TodoStoreTests
     [Fact]
     public void RejectsAMissingTitle()
     {
-        Assert.Throws<ValidationException>(() => new TodoStore().Add(new NewTodo(null)));
+        Assert.Throws<ValidationException>(() => new TodoStore(TimeProvider.System).Add(new NewTodo(null)));
     }
 
     [Fact]
     public void UpdatesOnlyTheGivenFields()
     {
-        var store = new TodoStore();
+        var store = new TodoStore(TimeProvider.System);
         var todo = store.Add(new NewTodo("A"));
         Assert.Equal(todo with { Done = true }, store.Update(todo.Id, new TodoPatch(null, true)));
         Assert.Null(store.Update(42, new TodoPatch("B", null)));
````

#### `messy.patch`

````diff
diff --git a/src/DemoTodo/Components/Pages/Home.razor b/src/DemoTodo/Components/Pages/Home.razor
index 10e75f0..00c37c0 100644
--- a/src/DemoTodo/Components/Pages/Home.razor
+++ b/src/DemoTodo/Components/Pages/Home.razor
@@ -6,11 +6,26 @@
 
 <h1>Todos</h1>
 
+<label><input type="checkbox" data-testid="overdue-filter" @bind="filter" /> nur überfällige</label>
+
 <ul data-testid="todo-list">
     @foreach (var todo in Store.List())
     {
+        if (filter && !(!todo.Done && todo.DueDate != null && string.Compare(todo.DueDate, DateTime.UtcNow.ToString("yyyy-MM-dd")) < 0)) continue;
         <li data-testid="todo-item">
             <span data-testid="todo-title">@todo.Title@(todo.Done ? " ✓" : "")</span>
+            @if (todo.DueDate != null)
+            {
+                <span data-testid="todo-due"> @todo.DueDate</span>
+            }
+            @if (!todo.Done && todo.DueDate != null && string.Compare(todo.DueDate, DateTime.UtcNow.ToString("yyyy-MM-dd")) < 0)
+            {
+                <strong data-testid="todo-overdue"> überfällig</strong>
+            }
         </li>
     }
 </ul>
+
+@code {
+    bool filter = false;
+}
diff --git a/src/DemoTodo/Program.cs b/src/DemoTodo/Program.cs
index fd7934d..794e0ca 100644
--- a/src/DemoTodo/Program.cs
+++ b/src/DemoTodo/Program.cs
@@ -1,6 +1,9 @@
 using System.ComponentModel.DataAnnotations;
 using DemoTodo;
 using DemoTodo.Components;
+using System.Text.Json;
+using System.Text.Json.Nodes;
+using System.Text.RegularExpressions;
 
 var builder = WebApplication.CreateBuilder(args);
 
@@ -47,16 +50,46 @@ app.MapRazorComponents<App>()
 app.MapGet("/health", () => new { ok = true });
 
 var todos = app.MapGroup("/todos");
-todos.MapGet("", (TodoStore store) => store.List());
-todos.MapPost("", (NewTodo input, TodoStore store) =>
+todos.MapGet("", (TodoStore store, HttpRequest req) =>
 {
-    var todo = store.Add(input);
+    var list = store.List().Select(t => new { t.Id, t.Title, t.Done, dueDate = t.DueDate, overdue = !t.Done && t.DueDate != null && string.Compare(t.DueDate, DateTime.UtcNow.ToString("yyyy-MM-dd")) < 0 }).ToList();
+    if (req.Query["overdue"] == "true")
+    {
+        var today = DateTime.UtcNow.ToString("yyyy-MM-dd");
+        list = list.Where(t => !t.Done && t.dueDate != null && string.Compare(t.dueDate, today) < 0).ToList();
+    }
+    return Results.Ok(list);
+});
+todos.MapPost("", (JsonObject body, TodoStore store) =>
+{
+    string? dueDate = null;
+    if (body["dueDate"] != null)
+    {
+        if (body["dueDate"]!.GetValueKind() != JsonValueKind.String || !Regex.IsMatch(body["dueDate"]!.GetValue<string>(), @"^\d{4}-\d{2}-\d{2}$") || !DateTime.TryParseExact(body["dueDate"]!.GetValue<string>(), "yyyy-MM-dd", null, System.Globalization.DateTimeStyles.None, out _))
+        {
+            return Results.BadRequest(new { error = "bad date" });
+        }
+        dueDate = body["dueDate"]!.GetValue<string>();
+    }
+    var todo = store.Add(new NewTodo(body["title"]?.GetValueKind() == JsonValueKind.String ? body["title"]!.GetValue<string>() : null));
+    todo.DueDate = dueDate;
     return Results.Created($"/todos/{todo.Id}", todo);
 });
 todos.MapGet("/{id:int}", (int id, TodoStore store) =>
     store.Get(id) is { } todo ? Results.Ok(todo) : NotFound());
-todos.MapPatch("/{id:int}", (int id, TodoPatch patch, TodoStore store) =>
-    store.Update(id, patch) is { } todo ? Results.Ok(todo) : NotFound());
+todos.MapPatch("/{id:int}", (int id, JsonObject body, TodoStore store) =>
+{
+    if (body.ContainsKey("dueDate") && body["dueDate"] != null)
+    {
+        if (body["dueDate"]!.GetValueKind() != JsonValueKind.String || !Regex.IsMatch(body["dueDate"]!.GetValue<string>(), @"^\d{4}-\d{2}-\d{2}$") || !DateTime.TryParseExact(body["dueDate"]!.GetValue<string>(), "yyyy-MM-dd", null, System.Globalization.DateTimeStyles.None, out _))
+        {
+            return Results.BadRequest(new { error = "invalid date!!" });
+        }
+    }
+    var todo = store.Update(id, body.Deserialize<TodoPatch>(JsonSerializerOptions.Web)!);
+    if (todo != null && body.ContainsKey("dueDate")) todo.DueDate = body["dueDate"]?.GetValue<string>();
+    return todo != null ? Results.Ok(todo) : NotFound();
+});
 todos.MapDelete("/{id:int}", (int id, TodoStore store) =>
     store.Remove(id) ? Results.NoContent() : NotFound());
 
diff --git a/src/DemoTodo/TodoStore.cs b/src/DemoTodo/TodoStore.cs
index c5509e1..b51ebc4 100644
--- a/src/DemoTodo/TodoStore.cs
+++ b/src/DemoTodo/TodoStore.cs
@@ -2,7 +2,10 @@ using System.ComponentModel.DataAnnotations;
 
 namespace DemoTodo;
 
-public record Todo(int Id, string Title, bool Done);
+public record Todo(int Id, string Title, bool Done)
+{
+    public string? DueDate { get; set; }
+}
 
 public record NewTodo(string? Title);
 
diff --git a/tests/DemoTodo.Tests/TodoApiTests.cs b/tests/DemoTodo.Tests/TodoApiTests.cs
index f20e459..d8e1423 100644
--- a/tests/DemoTodo.Tests/TodoApiTests.cs
+++ b/tests/DemoTodo.Tests/TodoApiTests.cs
@@ -20,7 +20,7 @@ public class TodoApiTests : IDisposable
         var created = await _client.PostAsJsonAsync("/todos", new { title = "Milch kaufen" });
         Assert.Equal(HttpStatusCode.Created, created.StatusCode);
         var list = await _client.GetStringAsync("/todos");
-        Assert.Equal("""[{"id":1,"title":"Milch kaufen","done":false}]""", list);
+        Assert.Contains("Milch kaufen", list);
     }
 
     [Fact]
````

## Appendix C: .NET oracle and verify script

Throwaway verification tools for Task 6 Step 3 (extracted to a scratch dir, never committed). The oracle checks AC1–AC7 deterministically with Playwright; it waits for the Blazor circuit before clicking.

#### `check-variant-dotnet.mjs`

````js
// Throwaway: checks AC1-AC7 of one calibration variant. Args: field query
// Env: APP_DIR (a writable checkout, default /v), APP_CMD (start command; default: dotnet run on port 3111).
// The last stdout line is the verdict JSON; diagnostics go to stderr.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire('/opt/agent-tools/node_modules/');
const { chromium } = require('playwright');
const [field, query] = process.argv.slice(2);
const base = 'http://127.0.0.1:3111';
const cwd = process.env.APP_DIR ?? '/v';
const cmd = process.env.APP_CMD ?? `dotnet run --project src/DemoTodo --urls ${base}`;
const log = (...a) => console.error('[oracle]', ...a);
const server = spawn('bash', ['-c', `exec ${cmd}`], { cwd, stdio: ['ignore', 'ignore', 'inherit'], detached: true });
let exited = false;
server.on('exit', (code) => { exited = true; log(`app exited with ${code}`); });
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ } };
const t0 = Date.now();
let ready = false;
while (!exited && Date.now() - t0 < 300_000) {
  try { if ((await fetch(`${base}/health`)).ok) { ready = true; break; } } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 250));
}
log(`health ${ready ? 'ok' : 'FAILED'} after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const req = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) }); return { status: r.status, body: await r.text() }; };
const res = {};
try {
  const a = JSON.parse((await req('POST', '/todos', { title: 'late', [field]: '2001-01-01' })).body);
  const plain = JSON.parse((await req('POST', '/todos', { title: 'plain' })).body);
  res.AC1 = a[field] === '2001-01-01' && plain[field] == null;
  const d = JSON.parse((await req('POST', '/todos', { title: 'donelate', [field]: '2001-01-02' })).body);
  await req('PATCH', `/todos/${d.id}`, { done: true });
  const f = JSON.parse((await req('POST', '/todos', { title: 'future', [field]: '2999-01-01' })).body);
  const ch = JSON.parse((await req('PATCH', `/todos/${f.id}`, { [field]: '2999-02-02' })).body);
  const tmp = JSON.parse((await req('POST', '/todos', { title: 'tmp', [field]: '2999-03-03' })).body);
  const cl = JSON.parse((await req('PATCH', `/todos/${tmp.id}`, { [field]: null })).body);
  res.AC2 = ch[field] === '2999-02-02' && cl[field] == null;
  res.AC3 = (await req('POST', '/todos', { title: 'x', [field]: '2026-02-30' })).status === 400
    && (await req('POST', '/todos', { title: 'x', [field]: '30.01.2026' })).status === 400
    && (await req('PATCH', `/todos/${f.id}`, { [field]: '2026-13-01' })).status === 400;
  const over = JSON.parse((await req('GET', `/todos?${query}`)).body).map((t) => t.title);
  res.AC4 = JSON.stringify(over) === JSON.stringify(['late']);
} catch (err) {
  log(`API checks aborted: ${err.message}`);
}
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  // Blazor Server is interactive once the browser has applied the circuit's first render batch: it then
  // sends OnRenderCompleted over the /_blazor WebSocket. Before that, the prerendered page shows the
  // data but no event handler is attached, so a click would be lost.
  const interactive = new Promise((resolve) => {
    page.on('websocket', (ws) => {
      if (!new URL(ws.url()).pathname.startsWith('/_blazor')) return;
      ws.on('framesent', (frame) => {
        if (Buffer.from(frame.payload).includes('OnRenderCompleted')) resolve(true);
      });
    });
  });
  await page.goto(base + '/');
  const circuit = await Promise.race([interactive, new Promise((r) => setTimeout(() => r(false), 20_000))]);
  log(`blazor circuit interactive: ${circuit}`);
  const text = await page.locator('body').innerText();
  res.AC5 = /2001|01\.01\.2001/.test(text) && /2999/.test(text);
  const rows = await page.locator('[data-testid="todo-item"]').allInnerTexts();
  res.AC6 = rows.filter((r) => /überfällig/.test(r)).length === 1 && rows.some((r) => /late/.test(r) && /überfällig/.test(r) && !/donelate/.test(r));
  const control = page.getByText('nur überfällige');
  if (await control.count()) {
    await control.first().click();
    await page.waitForTimeout(500);
    const after = await page.locator('[data-testid="todo-item"]').allInnerTexts();
    res.AC7 = after.length === 1 && /late/.test(after[0]);
  } else res.AC7 = false;
} finally {
  await browser.close();
  stop();
}
for (const id of ['AC1', 'AC2', 'AC3', 'AC4', 'AC5', 'AC6', 'AC7']) res[id] ??= false;
console.log(JSON.stringify(Object.fromEntries(Object.entries(res).sort())));
process.exit(0);
````

#### `verify-dotnet.sh`

````bash
#!/usr/bin/env bash
# Verifies the .NET demo task end to end, without any LLM:
#   1. the seed passes `dotnet test` in ai-dev-workflow-dotnet:latest (cold, then warm);
#   2. the task image builds; offline, a copy of /workspace builds into its own bin/ and obj/ (git-ignored,
#      nothing in /home/dev/artifacts) from the warm NuGet cache, and two checkouts test in parallel correctly;
#   3. per variant: createCalibrationBundle + checkoutBundle (the real e2e/lib/bundle.mjs), `dotnet test`
#      offline in the task image, then the deterministic Playwright oracle;
#   4. the oracle lines are compared with the expected verdicts.
# Paths default to the repository layout: run it from the repository root.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${REPO:-$(git rev-parse --show-toplevel)}"                     # read-only: bundle.mjs, issue.md, seed.sh
SEED="${SEED:-$REPO/e2e/tasks/demo-todo-dotnet/environment/seed/repo}"
CAL="${CAL:-$REPO/e2e/tasks/demo-todo-dotnet/calibration}"
DOCKERFILE="${DOCKERFILE:-$REPO/e2e/tasks/demo-todo-dotnet/environment/Dockerfile}"
NODE_ENV_DIR="${NODE_ENV_DIR:-$REPO/e2e/tasks/_shared/environment}"     # seed/issue.md, seed/seed.sh
ORACLE="${ORACLE:-$HERE/check-variant-dotnet.mjs}"
BASE_IMAGE=ai-dev-workflow-dotnet:latest
IMAGE="${IMAGE:-adw-verify-dotnet}"

W="$(mktemp -d "${TMPDIR:-/tmp}/dotnet-proto-verify.XXXXXX")"
trap 'rm -rf "$W"' EXIT
dk() { # dk <image> <dir-at-/workspace> <cmd> [docker args...]
  local image="$1" dir="$2" cmd="$3"; shift 3
  docker run --rm -e E2E_VERIFY=1 -e AGENT_TOOLSTACK_ONLY=1 -e PROJECT_ROOT=/workspace \
    -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" "$@" -v "$dir:/workspace" "$image" bash -lc "$cmd"
}
summary() { grep -E '^(Passed|Failed)!|error|^real' | sed -E 's/ +- DemoTodo.Tests.dll.*//'; }

echo "== 1. seed: dotnet test in $BASE_IMAGE (fresh container: cold, then warm)"
cp -r "$SEED" "$W/seed"
dk "$BASE_IMAGE" "$W/seed" 'cd /workspace && for run in cold warm; do echo "-- $run"; { time dotnet test; } 2>&1; done' | grep -E '^--|^(Passed|Failed)!|error|^real' | sed -E 's/ +- DemoTodo.Tests.dll.*//'
echo "   in-tree build output: $(cd "$W/seed" && find . -name bin -o -name obj -o -name artifacts -o -name TestResults | wc -l) dirs"

echo "== 2. task image $IMAGE"
mkdir -p "$W/ctx/seed"
cp "$DOCKERFILE" "$W/ctx/Dockerfile"
cp -r "$SEED" "$W/ctx/seed/repo"
cp "$NODE_ENV_DIR/seed/issue.md" "$NODE_ENV_DIR/seed/seed.sh" "$W/ctx/seed/"
start=$SECONDS
docker build -q -t "$IMAGE" "$W/ctx" >/dev/null
echo "   built in $((SECONDS - start))s"
echo "-- offline (--network none): commit a copy of /workspace, dotnet test there; where did the output go?"
docker run --rm --network none -e E2E_VERIFY=1 -e AGENT_TOOLSTACK_ONLY=1 -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" "$IMAGE" bash -lc '
  echo "   ArtifactsPath=\"${ArtifactsPath-<unset>}\"; NuGet cache: $(du -sh "$NUGET_PACKAGES" | cut -f1) in $NUGET_PACKAGES"
  echo "   /workspace before: $(ls -A /workspace | tr "\n" " ")"
  d=$(mktemp -d); cp -r /workspace/. "$d"; cd "$d"
  git init -q && git add -A && git -c user.name=x -c user.email=x@x commit -qm seed
  { time dotnet test; } 2>&1
  echo "   in-tree output: $(find . -name bin -o -name obj | sort | tr "\n" " ")"
  echo "   /home/dev/artifacts: $(ls -A /home/dev/artifacts 2>/dev/null | tr "\n" " " || true)<end>"
  echo "   git status --porcelain after build: <$(git status --porcelain)>"' 2>&1 | grep -E '^   |^(Passed|Failed)!|error|warn|NU1|^real' | sed -E 's/ +- DemoTodo.Tests.dll.*//'

echo "== 3. variants: bundle, dotnet test (offline, task image), oracle"
mkdir -p "$W/root/seed"
cp -r "$SEED" "$W/root/seed/repo"
git -C "$W/root" init -q -b main && git -C "$W/root" add -A
git -C "$W/root" -c user.name=x -c user.email=x@x -c commit.gpgsign=false commit -qm seed
TMPDIR="$W" node --input-type=module -e '
const { createCalibrationBundle, checkoutBundle } = await import(process.argv[1] + "/e2e/lib/bundle.mjs");
const [, , root, cal, out] = process.argv;
for (const v of ["reference", "alt-interface", "broken-done", "broken-ui", "messy"]) {
  createCalibrationBundle({ root, seedRepo: root + "/seed/repo", patch: cal + "/" + v + ".patch", out: out + "/" + v + ".bundle", name: "demo-todo-dotnet" });
  checkoutBundle(out + "/" + v + ".bundle", out + "/" + v);
}' "$REPO" "$W/root" "$CAL" "$W"
cp -r "$SEED" "$W/seed-oracle"
for v in reference broken-done broken-ui messy alt-interface; do
  printf -- '-- %s: ' "$v"
  dk "$IMAGE" "$W/$v" 'cd /workspace && { time dotnet test; } 2>&1' --network none | summary | tr '\n' ' '
  echo
done
echo "-- two checkouts (seed: 9 tests, reference: 26) tested in PARALLEL in one container, 3 rounds"
mkdir -p "$W/par" && cp -r "$SEED" "$W/par/seed" && git clone -q "$W/reference" "$W/par/reference"
docker run --rm --network none -e E2E_VERIFY=1 -e AGENT_TOOLSTACK_ONLY=1 -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  -v "$W/par:/par" "$IMAGE" bash -lc '
  for round in 1 2 3; do
    for c in seed reference; do (cd /par/$c && dotnet test > /tmp/$c.log 2>&1; echo $? > /tmp/$c.rc) & done; wait
    for c in seed reference; do
      printf "   round %s %-9s exit %s: %s\n" $round $c "$(cat /tmp/$c.rc)" "$(grep -hoE "Passed: +[0-9]+|Failed: +[0-9]+|error.{0,80}" /tmp/$c.log | sort -u | tr "\n" " ")"
    done
  done'
declare -A ARGS=([reference]="dueDate overdue=true" [broken-done]="dueDate overdue=true" [broken-ui]="dueDate overdue=true"
  [messy]="dueDate overdue=true" [alt-interface]="due overdue=1" [seed-oracle]="dueDate overdue=true")
: > "$W/oracle.txt"
for v in reference broken-done broken-ui messy alt-interface seed-oracle; do
  line="$v $(docker run --rm -e E2E_VERIFY=1 -e AGENT_TOOLSTACK_ONLY=1 -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
    -v "$W/$v:/v" -v "$ORACLE:/check.mjs:ro" "$IMAGE" bash -lc "node /check.mjs ${ARGS[$v]}" 2>"$W/$v.oracle.log" | tail -1)"
  echo "$line" | tee -a "$W/oracle.txt"
  grep -E 'health|interactive' "$W/$v.oracle.log" | sed 's/^/     /'
done

echo "== 4. expected verdicts"
cat > "$W/expected.txt" <<'EOF'
reference {"AC1":true,"AC2":true,"AC3":true,"AC4":true,"AC5":true,"AC6":true,"AC7":true}
broken-done {"AC1":true,"AC2":true,"AC3":true,"AC4":false,"AC5":true,"AC6":true,"AC7":true}
broken-ui {"AC1":true,"AC2":true,"AC3":true,"AC4":true,"AC5":true,"AC6":false,"AC7":false}
messy {"AC1":true,"AC2":true,"AC3":true,"AC4":true,"AC5":true,"AC6":true,"AC7":true}
alt-interface {"AC1":true,"AC2":true,"AC3":true,"AC4":true,"AC5":true,"AC6":true,"AC7":true}
EOF
if diff <(head -5 "$W/oracle.txt") "$W/expected.txt"; then echo "ALL VARIANTS AS EXPECTED"; else echo "MISMATCH"; exit 1; fi
````
