# ADW E2E Agentic Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hidden acceptance tests and the LLM judge of the ADW E2E self-test with an agentic E2E verifier (acceptance criteria AC1–AC7, run against the PR head in a fresh task container) and a review judge with read-only repository access. Both are calibrated on five known patch variants and can be re-run from committed bundles.

**Architecture:**
- The Harbor verifier in the container stays deterministic. It runs the contract checks and the task's `TEST_COMMAND`, and stores the PR head as `pr-head.bundle`.
- On the host, `e2e/lib/postverify.mjs` checks the bundle out twice. It runs the verifier (`claude -p` in the task image, with Playwright MCP) on one checkout and the review (`claude -p` on the host, Read/Grep/Glob only) on the other.
- The results merge into schema-2 trial records.
- `run.mjs` gains `verify` (re-judge stored bundles) and `calibrate` (judge the patch variants against `expected.json`).

**Tech Stack:** Node ≥ 24 builtins only (`node:test`, `node:child_process`), git bundles, Docker, Claude Code CLI (`claude -p --output-format json`), `@playwright/mcp` (already in the image as `playwright-mcp`).

**Spec:** `docs/superpowers/specs/2026-10-12-adw-e2e-agentic-verification-design.md`. It revises `docs/superpowers/specs/2026-10-11-adw-e2e-self-test-design.md`.

## Global Constraints

- **Dependencies:** zero runtime dependencies, Node builtins only, Node ≥ 24. LF line endings. Python only in `e2e/agents/`.
- **Code style:** match the existing `e2e/lib` style: compact ES modules, 2-space indent, single quotes, semicolons, `node:test` + `node:assert/strict`, dependencies injected as function parameters (`run`, `exec`, `deps`).
- **Secret files:** never copy or commit `spike/.env`, `spike/*-auth.json`, `spike/jobs/`, `e2e/.env` or staged auth copies.
- **Live runs:** never start a live run on your own: `node e2e/run.mjs run`, `verify`, `calibrate`, or any real `claude -p` call. They use the user's subscription quota. Task 12 asks the user first. Unit tests use no LLM and no Docker. Docker-only checks without any LLM call (Tasks 10 and 11) are allowed.
- **Checks:** checks never cover superpowers internals (path names, worktrees, TDD order, review steps).
- **Default models:** `verifier.model` and `review.model` default to `claude-sonnet-5-5`.
- **Limits:** verifier `timeoutSec` 900, review `timeoutSec` 600.
- **Auth:** `CLAUDE_CODE_OAUTH_TOKEN` reaches the verifier container only as `-e CLAUDE_CODE_OAUTH_TOKEN` (inherited env), never as a value in argv.
- **Result files:** every text result file is written through `writeResult` (redaction). The binary `pr-head.bundle` is copied only after `bundleLeaks()` finds no secret value in its history.
- **TDD:** tests only for logic and code, none for prose-only changes (AGENTS.md "TDD Workstyle").
- **Commit trailer:** end every commit message with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Xt655q14GXqAK7gQKxf525
  ```
- **Branch:** `feat/adw-e2e-self-test` (PR #56). Push only when the user asks.
- **Temporarily broken CLI:** between Task 6 and Task 11, `e2e/run.mjs run` is not usable, because its call sites are rewired in Task 11. `npm test` must stay green after every task.

## Review Focus

- **A usage limit inside the verifier container is quota, not a verifier error**, even when the container entrypoint prints to stderr or stdout before Claude's JSON line. Pinned in Task 2 (`claude.test.mjs`).
- **A timed-out verifier never leaves its container running.** A `spawnSync` timeout kills only the docker client. Pinned in Task 2 (`verifier.test.mjs`).
- **A broken verifier never looks like a bad agent.** `acceptance` is `null`, `reward` is `null`, the trial counts in no rate, and the error class is `verifier`. Pinned in Task 6 (`trial.test.mjs`, `summary.test.mjs`).
- **A bundle that cannot be checked out produces errors for both roles; `postVerify` does not throw.** Examples: no `main`, two branches, a corrupt file. Pinned in Tasks 4 and 5.
- **The token value never appears in any docker argv**, including `docker rm`. Pinned in Task 2.

## File map

| File | Responsibility |
|---|---|
| `e2e/tasks/demo-todo/acceptance-criteria.md` (new) | AC1–AC7 table. The agent never sees it. |
| `e2e/lib/criteria.mjs` (new) | Parse the AC table into `[{ id, text }]`. |
| `e2e/lib/claude.mjs` (new) | One `claude -p` call: robust JSON parsing, error text, `isQuota`. |
| `e2e/lib/verifier.mjs` (new) | Verifier prompt, answer validation, docker args, `runVerifier`. |
| `e2e/lib/review.mjs` (new, replaces `judge.mjs`) | Review prompt, answer validation, `runReview`. |
| `e2e/lib/bundle.mjs` (new) | Bundle checkout and diff, calibration bundles, secret check of a bundle. |
| `e2e/lib/postverify.mjs` (new) | Task image build, `postVerify` (two checkouts → verifier + review), `verifierHash`. |
| `e2e/lib/calibration.mjs` (new) | Evaluate calibration runs, find a passing calibration, render its report. |
| `e2e/lib/trial.mjs` | Schema-2 trial record, `emptyOutcome`, `rewardOf`, `applyPostVerification`, `section`. |
| `e2e/lib/summary.mjs`, `compare.mjs`, `fingerprint.mjs`, `report.mjs`, `preflight.mjs` | Schema 2: per-AC rates, review medians, verifier hash and role models, calibration warning. |
| `e2e/tasks/demo-todo/tests/verify.mjs`, `checks.mjs` | Container side: `TEST_COMMAND`, `pr-head.bundle`, no hidden tests. |
| `e2e/tasks/demo-todo/calibration/*` (new) | 5 patches, `expected.json`, `spec.md`, `summary.md`. |
| `e2e/run.mjs` | `run` with post-verification, plus the new `verify` and `calibrate` commands. |

---

### Task 1: Acceptance criteria, role models in config, preflight probes

**Files:**
- Create: `e2e/tasks/demo-todo/acceptance-criteria.md`
- Create: `e2e/lib/criteria.mjs`
- Test: `e2e/lib/criteria.test.mjs`
- Modify: `e2e/config.json` (add `verifier` and `review`; keep `judge` until Task 6)
- Modify: `e2e/lib/preflight.mjs:43-51`
- Test: `e2e/lib/preflight.test.mjs`

**Interfaces:**
- Produces:
  - `parseCriteria(markdown: string) → Array<{ id: string, text: string }>`
  - `loadCriteria(file: string) → same`
  - `config.verifier = { model, timeoutSec }`
  - `config.review = { model, timeoutSec, criteria: { requirements, scope, tests, conventions, architecture, codeQuality } }`

- [ ] **Step 1: Write the failing tests** in `e2e/lib/criteria.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { loadCriteria, parseCriteria } from './criteria.mjs';

test('parses the AC rows of a criteria table and ignores the header', () => {
  const md = '# x\n\n| Id | Criterion |\n|---|---|\n| AC1 | A todo can get a due date. |\n| AC2 | It can be removed. |\n';
  assert.deepEqual(parseCriteria(md), [{ id: 'AC1', text: 'A todo can get a due date.' }, { id: 'AC2', text: 'It can be removed.' }]);
});

test('rejects a table without criteria or with a duplicate id', () => {
  assert.throws(() => parseCriteria('| Id | Criterion |\n|---|---|\n'), /no acceptance criteria/);
  assert.throws(() => parseCriteria('| AC1 | a |\n| AC1 | b |\n'), /duplicate acceptance criterion AC1/);
});

test('demo-todo has AC1 to AC7 and names no endpoint, query parameter or field', () => {
  const config = loadConfig();
  const criteria = loadCriteria(path.join(config.root, 'e2e', config.task, 'acceptance-criteria.md'));
  assert.deepEqual(criteria.map((c) => c.id), ['AC1', 'AC2', 'AC3', 'AC4', 'AC5', 'AC6', 'AC7']);
  for (const { id, text } of criteria) assert.doesNotMatch(text, /\/todos|\?|dueDate|YYYY/, id);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test e2e/lib/criteria.test.mjs`
Expected: FAIL with `Cannot find module` for `./criteria.mjs`.

- [ ] **Step 3: Implement** `e2e/lib/criteria.mjs`:

```js
// Acceptance criteria of a task: the `| AC<n> | <text> |` rows of its acceptance-criteria.md.
import { readFileSync } from 'node:fs';

export function parseCriteria(markdown) {
  const criteria = [...markdown.matchAll(/^\|\s*(AC\d+)\s*\|\s*(.+?)\s*\|\s*$/gm)].map(([, id, text]) => ({ id, text }));
  if (!criteria.length) throw new Error('no acceptance criteria found');
  const ids = criteria.map((c) => c.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`duplicate acceptance criterion ${dup}`);
  return criteria;
}

export function loadCriteria(file) {
  return parseCriteria(readFileSync(file, 'utf8'));
}
```

Create `e2e/tasks/demo-todo/acceptance-criteria.md`:

```markdown
# demo-todo acceptance criteria

The E2E verifier checks these against the running app of every trial's PR head (`e2e/lib/postverify.mjs`).
The coding agent never sees this file.

Rules for changing it:
- A criterion describes observable behaviour. Name no endpoint paths, query parameters or field names.
  Use exact wording only for text a user sees.
- A criterion may only cover what the briefing (`instruction.md`) actively communicates, or what follows
  unambiguously from the ticket.
- Any change alters the verifier hash: recalibrate (`node e2e/run.mjs calibrate`).

| Id | Criterion |
|---|---|
| AC1 | A todo can optionally get a due date when it is created. The date is a calendar date without a time. |
| AC2 | The due date can be changed later and removed again. |
| AC3 | An invalid date (wrong format, an impossible date such as 30 February) is rejected with HTTP 400. |
| AC4 | The API can return only overdue todos. A todo is overdue when it is not done and its due date is before today (UTC). Todos without a due date, and done todos, are never overdue. |
| AC5 | The list page shows each todo's due date. |
| AC6 | Overdue todos in the list are marked with the word "überfällig"; other todos are not. |
| AC7 | A control labelled "nur überfällige" filters the list to overdue todos. |
```

In `e2e/config.json`, insert after the `"judge": {…}` block (keep `judge` for now):

```json
  "verifier": { "model": "claude-sonnet-5-5", "timeoutSec": 900 },
  "review": {
    "model": "claude-sonnet-5-5",
    "timeoutSec": 600,
    "criteria": {
      "requirements": "Do the posted spec and the diff capture every acceptance criterion? (measures interview quality by its outcome)",
      "scope": "No unrequested features and no unrelated changes?",
      "tests": "Do the agent's new tests meaningfully cover the new behaviour? Were existing tests deleted or weakened?",
      "conventions": "Does the code follow AGENTS.md and the repository's idioms (naming, error handling, test style)?",
      "architecture": "Does the change fit the existing structure (where logic lives, layering, reuse instead of duplication)?",
      "codeQuality": "Is the code readable and correct at the edges, without needless complexity?"
    }
  },
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test e2e/lib/criteria.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing preflight tests.** In `e2e/lib/preflight.test.mjs`, replace every occurrence of `needed by simulated user and judge` with `needed by simulated user, verifier and review`. Then replace the last test (`preflight probes the simulated-user and judge models through Claude`) with:

```js
test('preflight probes the simulated-user, verifier and review models through Claude, each model once', () => {
  const calls = [];
  const cfg = { ...config, verifier: { ...config.verifier, model: 'm-shared' }, review: { ...config.review, model: 'm-shared' } };
  const r = runPreflight({ config: cfg, harnesses: ['codex'], exec, platform: 'linux', root: '/home/u/adw',
    probe: (h, model) => { calls.push([h, model]); return model === 'm-shared' ? 'no access' : null; }, authPresent: () => true });
  assert.ok(calls.some(([h, m]) => h === 'claude-code' && m === cfg.simulatedUser.model));
  assert.equal(calls.filter(([, m]) => m === 'm-shared').length, 1);
  assert.ok(r.problems.includes('verifier model m-shared: probe failed: no access'));
  assert.ok(r.problems.includes('review model m-shared: probe failed: no access'));
});
```

Run: `node --test e2e/lib/preflight.test.mjs`
Expected: FAIL (old message; judge model probed instead).

- [ ] **Step 6: Implement.** In `e2e/lib/preflight.mjs`, replace lines 43–51 with:

```js
  // The simulated user, the verifier and the review judge always run on Claude, whichever harnesses are selected.
  const claudeOk = authPresent('claude-code');
  if (!claudeOk) problems.push('claude: login missing (needed by simulated user, verifier and review)');
  else {
    const probed = new Map();
    for (const [label, model] of [['simulated user', config.simulatedUser.model], ['verifier', config.verifier.model], ['review', config.review.model]]) {
      if (!probed.has(model)) probed.set(model, probe('claude-code', model));
      const err = probed.get(model);
      if (err) problems.push(`${label} model ${model}: probe failed: ${err}`);
    }
  }
```

Run: `npm test`
Expected: PASS. `judge.test.mjs` still passes, because `config.judge` still exists.

- [ ] **Step 7: Commit**

```bash
git add e2e/tasks/demo-todo/acceptance-criteria.md e2e/lib/criteria.mjs e2e/lib/criteria.test.mjs e2e/config.json e2e/lib/preflight.mjs e2e/lib/preflight.test.mjs
git commit -m "feat(e2e): acceptance criteria and configurable verifier/review models"
```

---

### Task 2: `claude -p` helper and the E2E verifier module

**Files:**
- Create: `e2e/lib/claude.mjs`
- Test: `e2e/lib/claude.test.mjs`
- Create: `e2e/lib/verifier.mjs`
- Test: `e2e/lib/verifier.test.mjs`

**Interfaces:**
- Consumes: `criteria: Array<{ id, text }>` (Task 1); `config.verifier.{model,timeoutSec}`.
- Produces:
  - `cliError(stdout) → string`
  - `resultJson(stdout) → object`
  - `isQuota(error?: string) → boolean`
  - `callClaude({ cmd = 'claude', args, input, cwd, env, timeoutMs, label, run }) → object` (throws on failure)
  - `VERIFIER_ALLOWED_TOOLS`, `VERIFIER_DENIED_TOOLS`
  - `buildVerifierPrompt({ criteria }) → string`
  - `validateVerifierAnswer(answer, ids) → { [id]: { pass: boolean, evidence: string } }`
  - `buildVerifierDockerArgs({ image, name, checkout, model, uid, gid }) → string[]`
  - `runVerifier({ config, checkout, criteria, env, image, name?, run?, uid?, gid? }) → { criteria: {…} | null, error: string | null }`

- [ ] **Step 1: Write the failing tests** in `e2e/lib/claude.test.mjs`:

````js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callClaude, cliError, isQuota, resultJson } from './claude.mjs';

test('resultJson takes the last JSON line and accepts a fenced answer', () => {
  const stdout = `agent runtime: trusted 1 company root certificate(s)\n${JSON.stringify({ type: 'result', result: 'Here:\n```json\n{"a":1}\n```' })}\n`;
  assert.deepEqual(resultJson(stdout), { a: 1 });
  assert.throws(() => resultJson(JSON.stringify({ result: 'no json here' })), /no JSON object/);
  assert.throws(() => resultJson('plain text'), /no claude -p JSON result/);
  assert.throws(() => resultJson(JSON.stringify({ is_error: true, api_error: 'usage_limit_reached', result: 'limit' })), /usage_limit_reached: limit/);
});

test('cliError reads api_error and result from the JSON line, else returns the raw text', () => {
  assert.equal(cliError(`noise\n${JSON.stringify({ api_error: 'usage_limit_reached', result: 'x' })}`), 'usage_limit_reached: x');
  assert.equal(cliError('boom\n'), 'boom');
  assert.equal(cliError(undefined), '');
});

test('callClaude reports a usage limit hidden behind container stderr noise as quota', () => {
  const run = () => ({ status: 1, stderr: 'agent runtime: warning: something',
    stdout: JSON.stringify({ is_error: true, api_error: 'usage_limit_reached', result: "You've hit your limit" }) });
  assert.throws(() => callClaude({ args: [], label: 'verifier', timeoutMs: 1000, run }),
    (e) => isQuota(e.message) && /^verifier exit 1: /.test(e.message) && /agent runtime: warning/.test(e.message));
});

test('callClaude passes input, cwd, timeout and merged env, and names a timeout', () => {
  let seen;
  const ok = callClaude({ args: ['-p'], input: 'PROMPT', cwd: '/x', env: { A: '1' }, timeoutMs: 5000, label: 'review',
    run: (cmd, args, o) => { seen = { cmd, args, ...o }; return { status: 0, stdout: JSON.stringify({ result: '{"ok":true}' }) }; } });
  assert.deepEqual(ok, { ok: true });
  assert.equal(seen.cmd, 'claude');
  assert.deepEqual([seen.input, seen.cwd, seen.timeout, seen.env.A], ['PROMPT', '/x', 5000, '1']);
  assert.ok(seen.env.PATH);
  const timedOut = () => ({ status: null, error: Object.assign(new Error('spawnSync docker ETIMEDOUT'), { code: 'ETIMEDOUT' }) });
  assert.throws(() => callClaude({ args: [], label: 'verifier', timeoutMs: 900000, run: timedOut }), /^Error: verifier timed out after 900 s$/);
});
````

Then `e2e/lib/verifier.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVerifierDockerArgs, buildVerifierPrompt, runVerifier, validateVerifierAnswer } from './verifier.mjs';

const criteria = [{ id: 'AC1', text: 'A todo can get a due date.' }, { id: 'AC2', text: 'The list shows it.' }];
const config = { verifier: { model: 'claude-sonnet-5-5', timeoutSec: 900 } };
const answer = (list) => JSON.stringify({ type: 'result', result: JSON.stringify({ criteria: list }) });
const both = [{ id: 'AC1', pass: true, evidence: 'POST ok' }, { id: 'AC2', pass: false, evidence: 'no date shown' }];

test('prompt lists every criterion and points to the E2E section of AGENTS.md, never the spec or ticket', () => {
  const p = buildVerifierPrompt({ criteria, spec: 'SPEC-TEXT', ticket: 'TICKET-TEXT' });
  for (const s of ['- AC1: A todo can get a due date.', '- AC2: The list shows it.', 'AGENTS.md', '"End-to-end testing"', 'date -u +%F']) {
    assert.ok(p.includes(s), s);
  }
  assert.ok(!p.includes('SPEC-TEXT') && !p.includes('TICKET-TEXT'));
});

test('answer validation demands every criterion exactly once with a boolean verdict', () => {
  const ids = ['AC1', 'AC2'];
  assert.deepEqual(validateVerifierAnswer({ criteria: both }, ids),
    { AC1: { pass: true, evidence: 'POST ok' }, AC2: { pass: false, evidence: 'no date shown' } });
  assert.throws(() => validateVerifierAnswer({ criteria: [both[0]] }, ids), /missing: AC2/);
  assert.throws(() => validateVerifierAnswer({ criteria: [...both, both[0]] }, ids), /AC1 twice/);
  assert.throws(() => validateVerifierAnswer({ criteria: [...both, { id: 'AC9', pass: true }] }, ids), /unknown criterion AC9/);
  assert.throws(() => validateVerifierAnswer({ criteria: [{ ...both[0], pass: 'yes' }, both[1]] }, ids), /AC1 has no boolean pass/);
  assert.throws(() => validateVerifierAnswer({}, ids), /no criteria array/);
});

test('docker args pass auth by name only, skip the Gitea seed and mount the checkout at /workspace', () => {
  const args = buildVerifierDockerArgs({ image: 'adw-e2e-demo-todo', name: 'v1', checkout: '/tmp/co', model: 'm', uid: 1000, gid: 1000 });
  assert.deepEqual(args.slice(0, 5), ['run', '--rm', '-i', '--name', 'v1']);
  assert.equal(args[args.indexOf('CLAUDE_CODE_OAUTH_TOKEN') - 1], '-e');
  assert.ok(args.includes('E2E_VERIFY=1'));
  assert.ok(args.includes('AGENT_TOOLSTACK_ONLY=1'));
  assert.ok(args.includes('/tmp/co:/workspace'));
  assert.equal(args[args.indexOf('claude') - 1], 'adw-e2e-demo-todo');
  assert.equal(args[args.indexOf('--model') + 1], 'm');
  assert.equal(args[args.indexOf('--allowedTools') + 1], 'Bash,Read,Grep,Glob,mcp__playwright');
  assert.equal(args[args.indexOf('--disallowedTools') + 1], 'Edit,Write,NotebookEdit,Task,WebFetch,WebSearch');
  assert.match(args[args.indexOf('--mcp-config') + 1], /"command":"playwright-mcp"/);
});

test('runVerifier never puts the token on the command line and always removes the container', () => {
  const calls = [];
  const run = (cmd, args, o) => { calls.push({ cmd, args, env: o?.env }); return args[0] === 'run' ? { status: 0, stdout: answer(both) } : { status: 0 }; };
  const r = runVerifier({ config, checkout: '/tmp/co', criteria, env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-secret' }, image: 'img', name: 'v1', run, uid: 1000, gid: 1000 });
  assert.equal(r.error, null);
  assert.equal(r.criteria.AC2.pass, false);
  assert.ok(calls.every((c) => c.cmd === 'docker' && !c.args.some((a) => a.includes('sk-secret'))), 'token value on argv');
  assert.equal(calls[0].env.CLAUDE_CODE_OAUTH_TOKEN, 'sk-secret', 'docker inherits the token through its env');
  assert.deepEqual(calls.at(-1).args, ['rm', '-f', 'v1']);
});

test('a timed-out or invalid verifier yields no verdicts and an error, and the container is still removed', () => {
  const calls = [];
  const timeout = (cmd, args) => { calls.push(args); return args[0] === 'run' ? { status: null, error: Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }) } : { status: 0 }; };
  assert.deepEqual(runVerifier({ config, checkout: '/c', criteria, image: 'img', name: 'v2', run: timeout, uid: 1, gid: 1 }),
    { criteria: null, error: 'verifier timed out after 900 s' });
  assert.deepEqual(calls.at(-1), ['rm', '-f', 'v2']);
  const partial = runVerifier({ config, checkout: '/c', criteria, image: 'img', name: 'v3', uid: 1, gid: 1,
    run: (cmd, args) => (args[0] === 'run' ? { status: 0, stdout: answer([both[0]]) } : { status: 0 }) });
  assert.equal(partial.criteria, null);
  assert.match(partial.error, /missing: AC2/);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test e2e/lib/claude.test.mjs e2e/lib/verifier.test.mjs`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement** `e2e/lib/claude.mjs`:

```js
// One `claude -p --output-format json` call, shared by the E2E verifier and the review judge.

// The CLI prints one JSON line; anything before it (e.g. container start-up output) is noise.
function cliJson(stdout) {
  const line = String(stdout ?? '').trim().split('\n').reverse().find((l) => l.trimStart().startsWith('{'));
  return line ? JSON.parse(line) : null;
}

// claude -p reports API errors (e.g. usage limits) on stdout, not stderr.
export function cliError(stdout) {
  try {
    const j = cliJson(stdout);
    if (j) return [j.api_error, j.result].filter(Boolean).join(': ');
  } catch { /* not JSON */ }
  return String(stdout ?? '').trim();
}

// The JSON object in the model's answer text, fenced or not.
export function resultJson(stdout) {
  const j = cliJson(stdout);
  if (!j) throw new Error('no claude -p JSON result');
  if (j.is_error) throw new Error(cliError(stdout));
  const json = String(j.result ?? '').match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error('answer holds no JSON object');
  return JSON.parse(json);
}

export const isQuota = (error) => /usage_limit_reached/.test(error ?? '');

// `run` has spawnSync's signature. Returns the answer's JSON object or throws a labelled error.
export function callClaude({ cmd = 'claude', args, input, cwd, env = {}, timeoutMs, label, run }) {
  const r = run(cmd, args, { input, cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, env: { ...process.env, ...env } });
  if (r.error?.code === 'ETIMEDOUT') throw new Error(`${label} timed out after ${timeoutMs / 1000} s`);
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  if (r.status !== 0) {
    const detail = [cliError(r.stdout), String(r.stderr ?? '').trim()].filter(Boolean).join(' | ');
    throw new Error(`${label} exit ${r.status}: ${detail.slice(0, 500)}`);
  }
  return resultJson(r.stdout);
}
```

Then `e2e/lib/verifier.mjs`:

```js
// Agentic E2E verifier: one claude -p run in a fresh task container exercises the PR head and
// judges it against the task's acceptance criteria only.
import { spawnSync } from 'node:child_process';
import { callClaude } from './claude.mjs';

export const VERIFIER_ALLOWED_TOOLS = 'Bash,Read,Grep,Glob,mcp__playwright';
export const VERIFIER_DENIED_TOOLS = 'Edit,Write,NotebookEdit,Task,WebFetch,WebSearch';
const PLAYWRIGHT_MCP = JSON.stringify({ mcpServers: { playwright: { command: 'playwright-mcp', args: ['--headless', '--browser', 'chromium', '--isolated'] } } });
// Named only: docker copies their values from its own environment, so they never reach argv.
const AUTH_ENV = ['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_FORCE_OAUTH'];

export function buildVerifierPrompt({ criteria }) {
  return `You are an acceptance tester. A coding agent changed the application in your current directory (/workspace, a git checkout of its pull request; the base branch is origin/main). Decide for each acceptance criterion below whether the running application meets it.

How to work:
- Read the "End-to-end testing" section of AGENTS.md. It says how to start the app, how to check that it is ready, its base URL and how to stop it. Start the app exactly as described there.
- Create all test data yourself through the running app (its HTTP API or its pages).
- You may read the code and run \`git diff origin/main...HEAD\` only to learn how to exercise a feature: endpoints, parameters, field names, controls. Judge strictly by what the running app does, measured against the criteria, never by what the code, its comments or its tests claim.
- Check HTTP behaviour with curl. Check pages with the Playwright browser tools (browser_navigate, browser_snapshot, browser_click, ...); load or reload a page after creating its data.
- "Today" is the current date in UTC: run \`date -u +%F\`.
- A criterion passes only if you observed the behaviour yourself. If you cannot find a way to exercise it, it fails.
- Never change repository files, never commit, and never save screenshots inside the repository.
- Stop the app before you answer.

Acceptance criteria:
${criteria.map((c) => `- ${c.id}: ${c.text}`).join('\n')}

Answer with JSON only, exactly this shape, with one entry per criterion id:
{"criteria": [{"id": "${criteria[0].id}", "pass": true, "evidence": "<the requests or page steps you ran and what you observed>"}]}
`;
}

export function validateVerifierAnswer(answer, ids) {
  if (!Array.isArray(answer?.criteria)) throw new Error('verifier answer has no criteria array');
  const out = {};
  for (const c of answer.criteria) {
    if (!ids.includes(c?.id)) throw new Error(`verifier returned unknown criterion ${c?.id}`);
    if (out[c.id]) throw new Error(`verifier returned ${c.id} twice`);
    if (typeof c.pass !== 'boolean') throw new Error(`verifier criterion ${c.id} has no boolean pass`);
    out[c.id] = { pass: c.pass, evidence: String(c.evidence ?? '') };
  }
  const missing = ids.filter((id) => !out[id]);
  if (missing.length) throw new Error(`verifier criteria missing: ${missing.join(', ')}`);
  return out;
}

// E2E_VERIFY=1 skips the task image's Gitea seed hook (environment/seed/seed.sh). AGENT_TOOLSTACK_ONLY=1
// configures only the tool stack: a calibration checkout has no ai-project.json, and the verifier needs no ticketing.
export function buildVerifierDockerArgs({ image, name, checkout, model, uid, gid }) {
  return ['run', '--rm', '-i', '--name', name,
    '-e', `HOST_UID=${uid}`, '-e', `HOST_GID=${gid}`, '-e', 'E2E_VERIFY=1', '-e', 'AGENT_TOOLSTACK_ONLY=1', ...AUTH_ENV.flatMap((k) => ['-e', k]),
    '-v', `${checkout}:/workspace`, image,
    'claude', '-p', '--model', model, '--output-format', 'json', '--strict-mcp-config', '--mcp-config', PLAYWRIGHT_MCP,
    '--allowedTools', VERIFIER_ALLOWED_TOOLS, '--disallowedTools', VERIFIER_DENIED_TOOLS];
}

export function runVerifier({ config, checkout, criteria, env = {}, image, name = `adw-verify-${process.pid}-${Date.now()}`,
  run = spawnSync, uid = process.getuid(), gid = process.getgid() }) {
  try {
    const answer = callClaude({ cmd: 'docker', args: buildVerifierDockerArgs({ image, name, checkout, model: config.verifier.model, uid, gid }),
      input: buildVerifierPrompt({ criteria }), env, timeoutMs: config.verifier.timeoutSec * 1000, label: 'verifier', run });
    return { criteria: validateVerifierAnswer(answer, criteria.map((c) => c.id)), error: null };
  } catch (err) {
    return { criteria: null, error: err.message };
  } finally {
    // A timeout kills only the docker client; the container would keep running.
    run('docker', ['rm', '-f', name], { encoding: 'utf8', stdio: 'ignore' });
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test e2e/lib/claude.test.mjs e2e/lib/verifier.test.mjs`
Expected: PASS (4 + 5 tests). `assert.throws` tests a RegExp against `String(error)`, so the anchored timeout pattern includes the `Error: ` prefix.

- [ ] **Step 5: Commit**

```bash
git add e2e/lib/claude.mjs e2e/lib/claude.test.mjs e2e/lib/verifier.mjs e2e/lib/verifier.test.mjs
git commit -m "feat(e2e): agentic E2E verifier against acceptance criteria"
```

---

### Task 3: Review judge module

**Files:**
- Create: `e2e/lib/review.mjs`
- Test: `e2e/lib/review.test.mjs`

**Interfaces:**
- Consumes:
  - `callClaude` (Task 2);
  - `config.review` (Task 1);
  - `criteria` (Task 1).
- Produces:
  - `REVIEW_ALLOWED_TOOLS = 'Read,Grep,Glob'` and `REVIEW_DENIED_TOOLS`;
  - `buildReviewPrompt({ rubric, criteria, spec, summary, diffPath }) → string`;
  - `validateReviewAnswer(answer, rubric) → { scores, reasons }`;
  - `runReview({ config, checkout, diffPath, criteria, spec, summary, env?, run? }) → { scores: {k: 1–5 | null}, reasons, error: string | null }`.

- [ ] **Step 1: Write the failing tests** in `e2e/lib/review.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.mjs';
import { buildReviewPrompt, runReview, validateReviewAnswer } from './review.mjs';

const config = loadConfig();
const rubric = config.review.criteria;
const criteria = [{ id: 'AC1', text: 'A todo can get a due date.' }];
const input = { criteria, spec: 'SPEC', summary: 'SUM', diffPath: '/tmp/pv/pr.diff' };
const good = Object.fromEntries(Object.keys(rubric).map((k, i) => [k, { score: (i % 5) + 1, reason: `r-${k}` }]));

test('the review rubric has the six configured criteria', () => {
  assert.deepEqual(Object.keys(rubric), ['requirements', 'scope', 'tests', 'conventions', 'architecture', 'codeQuality']);
});

test('prompt carries rubric, criteria, spec, summary and the diff path, and points to AGENTS.md', () => {
  const p = buildReviewPrompt({ rubric, ...input });
  for (const k of Object.keys(rubric)) assert.ok(p.includes(`- ${k}: `), k);
  for (const s of ['- AC1: A todo can get a due date.', '<approved-spec>\nSPEC', '<implementation-summary>\nSUM', '/tmp/pv/pr.diff', 'AGENTS.md']) {
    assert.ok(p.includes(s), s);
  }
});

test('answer validation rejects a missing criterion and out-of-range or non-integer scores', () => {
  assert.equal(validateReviewAnswer(good, rubric).reasons.conventions, 'r-conventions');
  assert.throws(() => validateReviewAnswer({ ...good, architecture: undefined }, rubric), /architecture/);
  assert.throws(() => validateReviewAnswer({ ...good, tests: { score: 9 } }, rubric), /tests/);
  assert.throws(() => validateReviewAnswer({ ...good, scope: { score: 3.5 } }, rubric), /scope/);
});

test('runReview runs read-only in the checkout with the review model, and fails to null scores', () => {
  let seen;
  const ok = runReview({ config, checkout: '/tmp/pv/review', ...input, env: { CLAUDE_CODE_OAUTH_TOKEN: 't' },
    run: (cmd, args, o) => { seen = { cmd, args, ...o }; return { status: 0, stdout: JSON.stringify({ result: JSON.stringify(good) }) }; } });
  assert.equal(seen.cmd, 'claude');
  assert.equal(seen.cwd, '/tmp/pv/review');
  assert.equal(seen.args[seen.args.indexOf('--model') + 1], config.review.model);
  assert.equal(seen.args[seen.args.indexOf('--allowedTools') + 1], 'Read,Grep,Glob');
  assert.equal(seen.args[seen.args.indexOf('--disallowedTools') + 1], 'Bash,Edit,Write,NotebookEdit,Task,WebFetch,WebSearch');
  assert.equal(seen.args[seen.args.indexOf('--add-dir') + 1], '/tmp/pv');
  assert.ok(seen.args.includes('--strict-mcp-config'));
  assert.equal(seen.timeout, config.review.timeoutSec * 1000);
  assert.equal(seen.env.CLAUDE_CODE_OAUTH_TOKEN, 't');
  assert.equal(ok.error, null);
  assert.equal(ok.scores.requirements, good.requirements.score);
  const bad = runReview({ config, checkout: '/c', ...input, run: () => ({ status: 1, stdout: '', stderr: 'boom' }) });
  assert.deepEqual(bad.scores, Object.fromEntries(Object.keys(rubric).map((k) => [k, null])));
  assert.match(bad.error, /review exit 1: boom/);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test e2e/lib/review.test.mjs`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement** `e2e/lib/review.mjs`:

```js
// Code-review judge: one claude -p run on the host, read-only in a fresh checkout of the PR head.
// It derives conventions and architecture from AGENTS.md and the code; the prompt holds no stack knowledge.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { callClaude } from './claude.mjs';

export const REVIEW_ALLOWED_TOOLS = 'Read,Grep,Glob';
export const REVIEW_DENIED_TOOLS = 'Bash,Edit,Write,NotebookEdit,Task,WebFetch,WebSearch';

export function buildReviewPrompt({ rubric, criteria, spec, summary, diffPath }) {
  return `You are a strict senior code reviewer. A coding agent implemented a ticket in the repository that is your current directory; its pull request branch is checked out. The full change against the base branch is in ${diffPath}.

Read AGENTS.md and the code around the change yourself, and derive the project's conventions and architecture from them and from the existing code. The acceptance criteria are the requirements; the approved spec and the implementation summary are what the agent posted on the ticket.
Score each review criterion from 1 (poor) to 5 (excellent) with one short sentence of reasoning.

Review criteria:
${Object.entries(rubric).map(([k, q]) => `- ${k}: ${q}`).join('\n')}

Answer with JSON only, exactly this shape:
{${Object.keys(rubric).map((k) => `"${k}": {"score": <1-5>, "reason": "<sentence>"}`).join(', ')}}

<acceptance-criteria>
${criteria.map((c) => `- ${c.id}: ${c.text}`).join('\n')}
</acceptance-criteria>

<approved-spec>
${spec}
</approved-spec>

<implementation-summary>
${summary}
</implementation-summary>
`;
}

export function validateReviewAnswer(answer, rubric) {
  const scores = {}; const reasons = {};
  for (const k of Object.keys(rubric)) {
    const v = answer?.[k];
    if (!v || !Number.isInteger(v.score) || v.score < 1 || v.score > 5) throw new Error(`review criterion ${k} invalid`);
    scores[k] = v.score; reasons[k] = String(v.reason ?? '');
  }
  return { scores, reasons };
}

export function runReview({ config, checkout, diffPath, criteria, spec, summary, env = {}, run = spawnSync }) {
  const { model, criteria: rubric, timeoutSec } = config.review;
  try {
    const answer = callClaude({ cmd: 'claude', cwd: checkout, env, run, label: 'review', timeoutMs: timeoutSec * 1000,
      args: ['-p', '--model', model, '--output-format', 'json', '--strict-mcp-config', '--add-dir', path.dirname(diffPath),
        '--allowedTools', REVIEW_ALLOWED_TOOLS, '--disallowedTools', REVIEW_DENIED_TOOLS],
      input: buildReviewPrompt({ rubric, criteria, spec, summary, diffPath }) });
    return { ...validateReviewAnswer(answer, rubric), error: null };
  } catch (err) {
    return { scores: Object.fromEntries(Object.keys(rubric).map((k) => [k, null])), reasons: {}, error: err.message };
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test e2e/lib/review.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add e2e/lib/review.mjs e2e/lib/review.test.mjs
git commit -m "feat(e2e): review judge with read-only repository access"
```

---

### Task 4: Git bundles: PR-head checkout, calibration bundles, secret check

**Files:**
- Create: `e2e/lib/bundle.mjs`
- Test: `e2e/lib/bundle.test.mjs` (uses real `git`; no Docker, no LLM)

**Interfaces:**
- Produces:
  - `bundleBranch(bundle, git?) → string`: the single non-`main` branch. Throws `bundle must hold main and one PR branch, has: …`.
  - `checkoutBundle(bundle, dir, git?) → { branch, diff }`: clones the PR branch into `dir`. `origin/main` is the base, and `diff` = `git diff origin/main...HEAD`.
  - `createCalibrationBundle({ root, seedRepo, patch, out, git? })`: commits the tracked files under `seedRepo` on `main`, applies `patch` on branch `1_calibration`, and writes the bundle to `out`.
  - `bundleLeaks(bundle, values, git?) → boolean`
- Bundle shape (Task 9 writes the same in the container): refs `refs/heads/main` plus exactly one `refs/heads/<pr-branch>`.

- [ ] **Step 1: Write the failing tests** in `e2e/lib/bundle.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bundleBranch, bundleLeaks, checkoutBundle, createCalibrationBundle } from './bundle.mjs';

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-C', cwd, ...a],
  { encoding: 'utf8', stdio: 'pipe' });

// A host repo with a tracked seed dir (plus one untracked file) and a patch for the seed's app file.
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'adw-bundle-'));
  const seed = path.join(root, 'seed');
  mkdirSync(path.join(seed, 'src'), { recursive: true });
  writeFileSync(path.join(seed, 'src/app.mjs'), 'export const a = 1;\n');
  writeFileSync(path.join(seed, 'ignored.txt'), 'untracked\n');
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', 'seed/src/app.mjs');
  git(root, 'commit', '-qm', 'seed');
  const patch = path.join(root, 'v.patch');
  writeFileSync(patch, 'diff --git a/src/app.mjs b/src/app.mjs\n--- a/src/app.mjs\n+++ b/src/app.mjs\n@@ -1 +1,2 @@\n export const a = 1;\n+export const b = 2;\n');
  return { root, seed, patch };
}

test('a calibration bundle holds the tracked seed on main and the patch on one branch; checkout yields the diff', () => {
  const { root, seed, patch } = fixture();
  try {
    const out = path.join(root, 'v.bundle');
    createCalibrationBundle({ root, seedRepo: seed, patch, out });
    assert.equal(bundleBranch(out), '1_calibration');
    const co = path.join(root, 'co');
    const { branch, diff } = checkoutBundle(out, co);
    assert.equal(branch, '1_calibration');
    assert.match(diff, /^\+export const b = 2;$/m);
    assert.equal(readFileSync(path.join(co, 'src/app.mjs'), 'utf8'), 'export const a = 1;\nexport const b = 2;\n');
    assert.throws(() => readFileSync(path.join(co, 'ignored.txt')), /ENOENT/, 'untracked seed files stay out');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a bundle without main or with two PR branches is rejected', () => {
  const { root } = fixture();
  try {
    git(root, 'branch', 'b1');
    git(root, 'branch', 'b2');
    const two = path.join(root, 'two.bundle');
    git(root, 'bundle', 'create', two, 'main', 'b1', 'b2');
    assert.throws(() => bundleBranch(two), /main and one PR branch/);
    const nomain = path.join(root, 'nomain.bundle');
    git(root, 'bundle', 'create', nomain, 'b1');
    assert.throws(() => bundleBranch(nomain), /main and one PR branch/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('bundleLeaks finds a secret value anywhere in the bundle history', () => {
  const { root, seed, patch } = fixture();
  try {
    const out = path.join(root, 'v.bundle');
    createCalibrationBundle({ root, seedRepo: seed, patch, out });
    assert.equal(bundleLeaks(out, ['sk-not-there']), false);
    assert.equal(bundleLeaks(out, ['export const b']), true);
    assert.equal(bundleLeaks(out, []), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test e2e/lib/bundle.test.mjs`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement** `e2e/lib/bundle.mjs`:

```js
// The PR head as a git bundle: refs/heads/main plus exactly one PR branch. Written by the task's
// verifier in the container (tests/verify.mjs) and by calibration; read by post-verification.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const defaultGit = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
// Commits made here must not depend on the host's git identity, signing setup or global hooks.
const COMMIT = ['-c', 'user.name=ADW E2E', '-c', 'user.email=e2e@adw.local', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];

export function bundleBranch(bundle, git = defaultGit) {
  const heads = git(['bundle', 'list-heads', bundle]).split('\n').map((l) => l.split(' ')[1]).filter(Boolean);
  const branches = heads.filter((r) => r.startsWith('refs/heads/') && r !== 'refs/heads/main');
  if (!heads.includes('refs/heads/main') || branches.length !== 1) {
    throw new Error(`bundle must hold main and one PR branch, has: ${heads.join(', ') || 'nothing'}`);
  }
  return branches[0].slice('refs/heads/'.length);
}

export function checkoutBundle(bundle, dir, git = defaultGit) {
  const branch = bundleBranch(bundle, git);
  git(['clone', '-q', '-b', branch, bundle, dir]);
  return { branch, diff: git(['-C', dir, 'diff', 'origin/main...HEAD']) };
}

export function createCalibrationBundle({ root, seedRepo, patch, out, git = defaultGit }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-calibration-'));
  try {
    // Only tracked seed files: generated skill files and ai-project.json are not part of the variant.
    for (const file of git(['-C', root, 'ls-files', '-z', '--', seedRepo]).split('\0').filter(Boolean)) {
      const target = path.join(dir, path.relative(seedRepo, path.join(root, file)));
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(path.join(root, file), target);
    }
    git(['init', '-q', '-b', 'main', dir]);
    git(['-C', dir, 'add', '-A']);
    git([...COMMIT, '-C', dir, 'commit', '-qm', 'Initial demo-todo']);
    git(['-C', dir, 'checkout', '-qb', '1_calibration']);
    git(['-C', dir, 'apply', patch]);
    git(['-C', dir, 'add', '-A']);
    git([...COMMIT, '-C', dir, 'commit', '-qm', 'Calibration variant']);
    git(['-C', dir, 'bundle', 'create', out, 'main', '1_calibration']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// The bundle is binary and cannot be redacted: a secret anywhere in its history keeps it out of the results.
export function bundleLeaks(bundle, values, git = defaultGit) {
  const needles = values.filter(Boolean);
  if (!needles.length) return false;
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-bundle-scan-'));
  try {
    git(['clone', '-q', '--bare', bundle, path.join(dir, 'b.git')]);
    const history = git(['-C', path.join(dir, 'b.git'), 'log', '-p', '--all', '--format=%H%n%B']);
    return needles.some((n) => history.includes(n));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test e2e/lib/bundle.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add e2e/lib/bundle.mjs e2e/lib/bundle.test.mjs
git commit -m "feat(e2e): PR-head bundles for host-side post-verification"
```

---

### Task 5: Post-verification orchestration and verifier hash

**Files:**
- Create: `e2e/lib/postverify.mjs`
- Test: `e2e/lib/postverify.test.mjs`

**Interfaces:**
- Consumes:
  - `checkoutBundle` (Task 4);
  - `runVerifier`, `buildVerifierPrompt`, `VERIFIER_*_TOOLS` (Task 2);
  - `runReview`, `buildReviewPrompt`, `REVIEW_*_TOOLS` (Task 3);
  - `isQuota` (Task 2).
- Produces:
  - `taskImage(config) → 'adw-e2e-<task>'`
  - `buildTaskImage({ config, exec? }) → string` (image name)
  - `verifierHash({ config, criteria }) → sha256 hex`
  - `postVerify({ config, bundle, criteria, spec, summary, env?, image, deps? }) → PostVerification`:
    ```
    { acceptanceCriteria: { [id]: 'pass'|'fail'|null }, acceptanceEvidence: { [id]: string } | null,
      acceptance: number|null, verifierError: string|null,
      review: { [criterion]: number|null }, reviewReasons: object, reviewError: string|null }
    ```

- [ ] **Step 1: Write the failing tests** in `e2e/lib/postverify.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { buildTaskImage, postVerify, taskImage, verifierHash } from './postverify.mjs';

const config = loadConfig();
const criteria = [{ id: 'AC1', text: 'a' }, { id: 'AC2', text: 'b' }];
const scores = Object.fromEntries(Object.keys(config.review.criteria).map((k) => [k, 4]));
const nulls = Object.fromEntries(Object.keys(config.review.criteria).map((k) => [k, null]));

function fakes(over = {}) {
  const seen = { checkouts: [] };
  const deps = {
    checkoutBundle: (bundle, dir) => { seen.checkouts.push(dir); return { branch: '1_x', diff: 'DIFF' }; },
    runVerifier: (a) => { seen.verifier = a; return { criteria: { AC1: { pass: true, evidence: 'e1' }, AC2: { pass: false, evidence: 'e2' } }, error: null }; },
    runReview: (a) => { seen.review = { ...a, diffText: readFileSync(a.diffPath, 'utf8') }; return { scores, reasons: { scope: 'ok' }, error: null }; },
    ...over,
  };
  return { seen, deps };
}

test('verifier and review get separate fresh checkouts; verdicts become per-criterion results', () => {
  const { seen, deps } = fakes();
  const pv = postVerify({ config, bundle: '/b/pr-head.bundle', criteria, spec: 'S', summary: 'U', env: { T: '1' }, image: 'img', deps });
  assert.equal(seen.checkouts.length, 2);
  assert.notEqual(seen.checkouts[0], seen.checkouts[1]);
  assert.equal(seen.verifier.checkout, seen.checkouts[0]);
  assert.equal(seen.verifier.image, 'img');
  assert.deepEqual(seen.verifier.env, { T: '1' });
  assert.ok(!('spec' in seen.verifier) && !('summary' in seen.verifier), 'the verifier never sees spec or summary');
  assert.equal(seen.review.checkout, seen.checkouts[1]);
  assert.equal(seen.review.diffText, 'DIFF');
  assert.deepEqual([seen.review.spec, seen.review.summary], ['S', 'U']);
  assert.deepEqual(pv, { acceptanceCriteria: { AC1: 'pass', AC2: 'fail' }, acceptanceEvidence: { AC1: 'e1', AC2: 'e2' }, acceptance: 0.5,
    verifierError: null, review: scores, reviewReasons: { scope: 'ok' }, reviewError: null });
  assert.equal(existsSync(path.dirname(seen.checkouts[0])), false, 'work dir removed');
});

test('a failed verifier gives null acceptance, and a usage limit skips the review', () => {
  const failed = postVerify({ config, bundle: 'b', criteria, image: 'img',
    deps: fakes({ runVerifier: () => ({ criteria: null, error: 'verifier exit 1: crash' }) }).deps });
  assert.deepEqual(failed.acceptanceCriteria, { AC1: null, AC2: null });
  assert.equal(failed.acceptance, null);
  assert.equal(failed.acceptanceEvidence, null);
  assert.equal(failed.reviewError, null, 'the review still runs');
  let reviewed = false;
  const limited = postVerify({ config, bundle: 'b', criteria, image: 'img',
    deps: fakes({ runVerifier: () => ({ criteria: null, error: 'verifier exit 1: usage_limit_reached: limit' }), runReview: () => { reviewed = true; } }).deps });
  assert.equal(reviewed, false);
  assert.match(limited.reviewError, /usage_limit_reached/);
  assert.deepEqual(limited.review, nulls);
});

test('a bundle that cannot be checked out yields errors for both roles instead of throwing', () => {
  const pv = postVerify({ config, bundle: 'b', criteria, image: 'img',
    deps: fakes({ checkoutBundle: () => { throw new Error('bundle must hold main and one PR branch, has: refs/heads/x'); } }).deps });
  assert.equal(pv.acceptance, null);
  assert.match(pv.verifierError, /^checkout: bundle must hold main/);
  assert.match(pv.reviewError, /^checkout: /);
  assert.deepEqual(pv.review, nulls);
});

test('verifierHash is stable and changes with criteria, models and rubric, not with limits', () => {
  const h = verifierHash({ config, criteria });
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(verifierHash({ config, criteria }), h);
  assert.notEqual(verifierHash({ config, criteria: [{ id: 'AC1', text: 'changed' }, criteria[1]] }), h);
  assert.notEqual(verifierHash({ config: { ...config, verifier: { ...config.verifier, model: 'other' } }, criteria }), h);
  assert.notEqual(verifierHash({ config: { ...config, review: { ...config.review, model: 'other' } }, criteria }), h);
  assert.notEqual(verifierHash({ config: { ...config, review: { ...config.review, criteria: { scope: 'x' } } }, criteria }), h);
  assert.equal(verifierHash({ config: { ...config, verifier: { ...config.verifier, timeoutSec: 1 } }, criteria }), h);
});

test('the task image is built from the task environment as adw-e2e-<task>', () => {
  let call;
  assert.equal(buildTaskImage({ config, exec: (cmd, args) => { call = [cmd, ...args]; } }), 'adw-e2e-demo-todo');
  assert.equal(taskImage(config), 'adw-e2e-demo-todo');
  const env = path.join(config.root, 'e2e/tasks/demo-todo/environment');
  assert.deepEqual(call, ['docker', 'build', '-t', 'adw-e2e-demo-todo', '-f', path.join(env, 'Dockerfile'), env]);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test e2e/lib/postverify.test.mjs`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement** `e2e/lib/postverify.mjs`:

```js
// Post-verification of one PR head, on the host: fresh checkouts of its bundle, then the E2E
// verifier and the review judge, independently of each other. Runs after each trial, and again
// with `run.mjs verify` and `run.mjs calibrate`.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkoutBundle } from './bundle.mjs';
import { isQuota } from './claude.mjs';
import { REVIEW_ALLOWED_TOOLS, REVIEW_DENIED_TOOLS, buildReviewPrompt, runReview } from './review.mjs';
import { VERIFIER_ALLOWED_TOOLS, VERIFIER_DENIED_TOOLS, buildVerifierPrompt, runVerifier } from './verifier.mjs';

export const taskImage = (config) => `adw-e2e-${path.basename(config.task)}`;

// The verifier runs in the task's own image; the Docker layer cache makes rebuilding cheap.
export function buildTaskImage({ config, exec = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] }) }) {
  const dir = path.join(config.root, 'e2e', config.task, 'environment');
  exec('docker', ['build', '-t', taskImage(config), '-f', path.join(dir, 'Dockerfile'), dir]);
  return taskImage(config);
}

// Changes whenever anything that shapes a verdict changes: prompts, tools, models, rubric, criteria.
export function verifierHash({ config, criteria }) {
  const material = {
    verifierPrompt: buildVerifierPrompt({ criteria }), verifierTools: [VERIFIER_ALLOWED_TOOLS, VERIFIER_DENIED_TOOLS],
    reviewPrompt: buildReviewPrompt({ rubric: config.review.criteria, criteria, spec: '', summary: '', diffPath: '' }),
    reviewTools: [REVIEW_ALLOWED_TOOLS, REVIEW_DENIED_TOOLS],
    models: { verifier: config.verifier.model, review: config.review.model },
  };
  return createHash('sha256').update(JSON.stringify(material)).digest('hex');
}

const DEFAULT_DEPS = { checkoutBundle, runVerifier, runReview };

export function postVerify({ config, bundle, criteria, spec, summary, env = {}, image, deps = DEFAULT_DEPS }) {
  const nulls = Object.fromEntries(Object.keys(config.review.criteria).map((k) => [k, null]));
  const work = mkdtempSync(path.join(tmpdir(), 'adw-postverify-'));
  try {
    let verdict; let review;
    try {
      // Separate checkouts: the verifier runs the app in its tree, the review reads a pristine one.
      const { diff } = deps.checkoutBundle(bundle, path.join(work, 'verify'));
      deps.checkoutBundle(bundle, path.join(work, 'review'));
      const diffPath = path.join(work, 'pr.diff');
      writeFileSync(diffPath, diff);
      verdict = deps.runVerifier({ config, checkout: path.join(work, 'verify'), criteria, env, image });
      review = isQuota(verdict.error) ? { scores: nulls, reasons: {}, error: verdict.error }
        : deps.runReview({ config, checkout: path.join(work, 'review'), diffPath, criteria, spec, summary, env });
    } catch (err) {
      const error = `checkout: ${err.message}`;
      verdict = { criteria: null, error };
      review = { scores: nulls, reasons: {}, error };
    }
    return outcome(criteria, verdict, review);
  } finally {
    try { rmSync(work, { recursive: true, force: true }); } catch (e) { console.warn(`! could not remove ${work}: ${e.message}`); }
  }
}

function outcome(criteria, verdict, review) {
  const v = verdict.criteria;
  const acceptanceCriteria = Object.fromEntries(criteria.map(({ id }) => [id, v ? (v[id].pass ? 'pass' : 'fail') : null]));
  const passed = Object.values(acceptanceCriteria).filter((x) => x === 'pass').length;
  return {
    acceptanceCriteria,
    acceptanceEvidence: v ? Object.fromEntries(criteria.map(({ id }) => [id, v[id].evidence])) : null,
    acceptance: v ? Number((passed / criteria.length).toFixed(4)) : null,
    verifierError: verdict.error,
    review: review.scores, reviewReasons: review.reasons, reviewError: review.error,
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test e2e/lib/postverify.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add e2e/lib/postverify.mjs e2e/lib/postverify.test.mjs
git commit -m "feat(e2e): host-side post-verification of the PR head"
```

---

### Task 6: Schema-2 trial records, summary and compare; remove the old judge

**Files:**
- Modify: `e2e/lib/trial.mjs` (full rewrite below)
- Test: `e2e/lib/trial.test.mjs` (full rewrite below)
- Modify: `e2e/lib/summary.mjs`, `e2e/lib/summary.test.mjs`
- Modify: `e2e/lib/compare.mjs`, `e2e/lib/compare.test.mjs`
- Delete: `e2e/lib/judge.mjs`, `e2e/lib/judge.test.mjs`
- Modify: `e2e/config.json`: remove the `"judge": {…}` block.

**Interfaces:**
- Consumes:
  - `isQuota` (Task 2);
  - the `PostVerification` shape (Task 5).
- Produces (trial.mjs):
  - `CONTRACT_CHECKS` (unchanged).
  - `section(comments, title) → string`
  - `rewardOf(trial) → 0 | 1 | null`
  - `emptyOutcome(criteria) → { acceptanceCriteria: all 'fail', acceptance: 0, verifierError: null, review: null, reviewReasons: null, reviewError: null }`
  - `buildTrialRecord({ id, harness, trialDir, config, criteria, deps? })`: no longer takes `briefing`/`env`.
  - `applyPostVerification(trial, pv) → trial`: drops `acceptanceEvidence`, ORs `errors.quota`, recomputes `reward`.
- Produces (summary):
  - `summary.reviewMedian` replaces `judgeMedian`;
  - `checkRates['ac:<id>']`;
  - error classes `verifier` and `judge`;
  - `rate()` ignores `null`.
- Produces (compare):
  - `compareRuns` throws for non-schema-2 runs;
  - signals `review:<k>`;
  - `findBaseline` skips non-schema-2 runs.
- Note: after this task `e2e/run.mjs` still calls `buildTrialRecord` the old way. Task 11 rewires it.

- [ ] **Step 1: Write the failing tests.** Replace `e2e/lib/trial.test.mjs` with:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyPostVerification, buildTrialRecord, CONTRACT_CHECKS, emptyOutcome, section } from './trial.mjs';
import { RESULT } from './fixtures/make.mjs';

const criteria = [{ id: 'AC1', text: 'a' }, { id: 'AC2', text: 'b' }];
const config = { app: { port: 3000 } };
const DEPS = {
  targetTokens: () => ({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 }),
  userTokens: () => ({ total: 5 }),
  durations: () => ({ setup: 1, agent: 2, verifier: 3, total: 6 }),
  errors: () => ({ harbor: null, bridge: null, tool: 0, timeout: false, quota: false }),
  e2ePerformed: () => 1,
  softSignals: () => ({ superpowersActive: true }),
  ccusageCrossCheck: () => ({ ccusageTotal: 10, deviation: 0, warning: null }),
};

test('trial record merges verifier rewards, host e2e check and metrics; acceptance waits for post-verification', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    mkdirSync(path.join(dir, 'verifier'));
    writeFileSync(path.join(dir, 'result.json'), JSON.stringify(RESULT));
    const checks = Object.fromEntries(CONTRACT_CHECKS.filter((c) => c !== 'e2e_performed').map((c) => [c, 1]));
    writeFileSync(path.join(dir, 'verifier/reward.json'), JSON.stringify({ ...checks, own_tests_pass: 1 }));
    const t = buildTrialRecord({ id: 'codex-1', harness: 'codex', trialDir: dir, config, criteria, deps: { ...DEPS, e2ePerformed: () => 0 } });
    assert.equal(t.checks.e2e_performed, 0);
    assert.equal(t.contract, Number(((CONTRACT_CHECKS.length - 1) / CONTRACT_CHECKS.length).toFixed(4)));
    assert.equal(t.ownTests, 1);
    assert.deepEqual(t.acceptanceCriteria, { AC1: 'fail', AC2: 'fail' });
    assert.equal(t.acceptance, 0);
    assert.equal(t.review, null);
    assert.equal(t.reward, 0);
    assert.equal(t.tokens.total, 10);
    assert.equal(t.errors.quota, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('post-verification sets verdicts and reward; a usage limit in either role marks quota', () => {
  const base = { id: 'x', contract: 1, ownTests: 1, checks: {}, ...emptyOutcome(criteria), errors: { harbor: null, quota: false } };
  const pv = { acceptanceCriteria: { AC1: 'pass', AC2: 'pass' }, acceptanceEvidence: { AC1: 'e', AC2: 'e' }, acceptance: 1,
    verifierError: null, review: { scope: 5 }, reviewReasons: { scope: 'ok' }, reviewError: null };
  const t = applyPostVerification(base, pv);
  assert.equal(t.reward, 1);
  assert.deepEqual(t.review, { scope: 5 });
  assert.equal('acceptanceEvidence' in t, false, 'evidence stays in acceptance.json');
  assert.equal(applyPostVerification({ ...base, ownTests: 0 }, pv).reward, 0);
  const unjudged = applyPostVerification(base, { ...pv, acceptanceCriteria: { AC1: null, AC2: null }, acceptance: null,
    verifierError: 'verifier exit 1: usage_limit_reached: x' });
  assert.equal(unjudged.errors.quota, true);
  assert.equal(unjudged.reward, null, 'an unjudged trial has no reward');
  assert.equal(applyPostVerification(base, { ...pv, reviewError: 'review exit 1: usage_limit_reached' }).errors.quota, true);
});

test('section joins every comment that starts with the heading', () => {
  assert.equal(section([{ body: '## Approved Spec\nA' }, { body: 'x' }, { body: '  ## Approved Spec\nB' }], 'Approved Spec'),
    '## Approved Spec\nA\n\n  ## Approved Spec\nB');
  assert.equal(section(undefined, 'Approved Spec'), '');
});

test('a trial without verifier output scores zero instead of throwing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ ...RESULT, exception_info: { exception_type: 'RuntimeError' } }));
    const t = buildTrialRecord({ id: 'x-1', harness: 'codex', trialDir: dir, config, criteria,
      deps: { ...DEPS, targetTokens: () => null, e2ePerformed: () => 0, errors: () => ({ harbor: 'RuntimeError', bridge: null, tool: 0, timeout: false }) } });
    assert.equal(t.reward, 0);
    assert.equal(t.contract, 0);
    assert.equal(t.acceptance, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

Replace the three tests in `e2e/lib/summary.test.mjs` after `median ignores nulls` with:

```js
test('summary computes rates, medians, per-criterion rates and error classes', () => {
  const t = (reward, spec, tokens, agent, req, ac4, errs = {}) => ({ reward, checks: { spec_comment: spec, pr_draft: 1 },
    acceptance: reward, ownTests: 1, acceptanceCriteria: { AC1: 'pass', AC4: ac4 }, tokens: { total: tokens }, durations: { agent },
    review: { requirements: req }, errors: { harbor: null, bridge: null, tool: 0, timeout: false, ...errs } });
  const s = summarizeTrials([t(1, 1, 100, 10, 5, 'pass'), t(0, 0, 300, 30, 3, 'fail', { bridge: 'BRIDGE FAILURE: x' }), t(1, 1, 200, 20, 4, 'pass')]);
  assert.equal(s.rewardRate, 0.67);
  assert.deepEqual(s.checkRates, { spec_comment: 0.67, pr_draft: 1, acceptance: 0.67, ownTests: 1, 'ac:AC1': 1, 'ac:AC4': 0.67 });
  assert.deepEqual(s.median, { tokens: 200, agent: 20 });
  assert.deepEqual(s.reviewMedian, { requirements: 4 });
  assert.deepEqual(s.errorClasses, ['bridge']);
});

test('an unjudged trial (verifier failed) counts in no rate and surfaces as the verifier error class', () => {
  const judged = { reward: 1, checks: {}, acceptance: 1, ownTests: 1, acceptanceCriteria: { AC1: 'pass' }, review: null, errors: {} };
  const broken = { reward: null, checks: {}, acceptance: null, ownTests: 1, acceptanceCriteria: { AC1: null }, review: null,
    verifierError: 'verifier exit 1: crash', errors: {} };
  const s = summarizeTrials([judged, broken]);
  assert.equal(s.rewardRate, 1);
  assert.equal(s.checkRates.acceptance, 1);
  assert.equal(s.checkRates['ac:AC1'], 1);
  assert.deepEqual(s.errorClasses, ['verifier']);
});

test('a failed review surfaces as the judge error class; a usage limit only as quota', () => {
  const t = (o) => ({ reward: 1, checks: {}, acceptance: 1, ownTests: 1, review: null, errors: {}, ...o });
  assert.deepEqual(summarizeTrials([t({ reviewError: 'review exit 1: boom' })]).errorClasses, ['judge']);
  assert.deepEqual(summarizeTrials([t({ verifierError: 'verifier exit 1: usage_limit_reached', reviewError: 'verifier exit 1: usage_limit_reached',
    errors: { quota: true } })]).errorClasses, ['quota']);
  assert.deepEqual(summarizeTrials([t({ errors: { harbor: 'NonZeroAgentExitCodeError', quota: true } })]).errorClasses, ['harbor', 'quota']);
});
```

In `e2e/lib/compare.test.mjs`:
- In `trial()`, replace `judge: { requirements: 5 }` with `review: { requirements: 5 }`.
- In `run()`, return `{ schema: 2, trials, … }`.
- In `judge drop and new error class…`, replace `judge: { requirements: 3 }` with `review: { requirements: 3 }`.
- In `a candidate whose judge always fails…`, use `trial({ review: null, reviewError: 'review exited 1' })`.
- In `findBaseline picks the newest…`, write `JSON.stringify({ schema: 2, fingerprint: { adw: { sha } } })`, and add `schema: 2` to the aborted fixture too.
- Then append:

```js
test('schema-1 runs are never a baseline and cannot be compared', () => {
  assert.throws(() => compareRuns({ ...run([trial()]), schema: 1 }, run([trial()]), TH), /schema-2/);
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    mkdirSync(path.join(dir, '2026-10-01T0900Z', 'codex'), { recursive: true });
    writeFileSync(path.join(dir, '2026-10-01T0900Z', 'codex', 'run.json'), JSON.stringify({ schema: 1, fingerprint: { adw: { sha: 'old' } } }));
    assert.equal(findBaseline({ resultsDir: dir, harness: 'codex', before: 'z', isAncestor: () => true }), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a review median drop is a review: regression', () => {
  const r = compareRuns(run([trial()]), run([trial({ review: { requirements: 3 } })]), TH);
  assert.ok(r.signals.some((s) => s.signal === 'review:requirements' && s.kind === 'regression'));
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test e2e/lib/trial.test.mjs e2e/lib/summary.test.mjs e2e/lib/compare.test.mjs`
Expected: FAIL (`emptyOutcome` is not exported; `reviewMedian` is undefined; no schema check).

- [ ] **Step 3: Implement.** Replace `e2e/lib/trial.mjs` with:

```js
// Builds one trial record (run.json schema 2 "trials" entry) from a trial dir's evidence. Acceptance
// and review verdicts come from post-verification (postverify.mjs) through applyPostVerification.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as metrics from './metrics.mjs';
import { ccusageCrossCheck } from './ccusage.mjs';
import { isQuota } from './claude.mjs';

export const CONTRACT_CHECKS = ['ticket_open', 'ticket_review', 'spec_comment', 'spec_comment_complete',
  'summary_comment', 'cost_comment', 'only_allowed_comments', 'pr_draft', 'branch_naming', 'pr_title_naming',
  'e2e_performed', 'app_stopped', 'no_screenshots_in_repo'];

const DEFAULT_DEPS = { ...metrics, ccusageCrossCheck };
const readJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
export const section = (comments = [], title) => comments.filter((c) => c.body.trimStart().startsWith(`## ${title}`)).map((c) => c.body).join('\n\n');

// null when the verifier could not judge: a broken verifier is no agent failure.
export const rewardOf = (t) => (t.acceptance === null ? null : t.contract === 1 && t.ownTests === 1 && t.acceptance === 1 ? 1 : 0);

// A trial without a PR head to verify: every criterion failed, nothing reviewed.
export function emptyOutcome(criteria) {
  return { acceptanceCriteria: Object.fromEntries(criteria.map(({ id }) => [id, 'fail'])), acceptance: 0,
    verifierError: null, review: null, reviewReasons: null, reviewError: null };
}

export function buildTrialRecord({ id, harness, trialDir, config, criteria, deps = DEFAULT_DEPS }) {
  const result = readJson(path.join(trialDir, 'result.json')) ?? {};
  const reward = readJson(path.join(trialDir, 'verifier/reward.json'));
  const checks = Object.fromEntries(CONTRACT_CHECKS.map((c) => [c, reward?.[c] === 1 ? 1 : 0]));
  checks.e2e_performed = deps.e2ePerformed(harness, trialDir, config.app.port);
  const contract = Number((Object.values(checks).reduce((a, b) => a + b, 0) / CONTRACT_CHECKS.length).toFixed(4));
  const tokens = deps.targetTokens(harness, trialDir);
  const record = {
    id, reward: 0, contract, checks, ownTests: reward?.own_tests_pass ?? 0, ...emptyOutcome(criteria),
    durations: deps.durations(result), tokens, ccusage: deps.ccusageCrossCheck(harness, trialDir, tokens),
    userTokens: deps.userTokens(result), errors: deps.errors(harness, trialDir, result), soft: deps.softSignals(harness, trialDir),
  };
  return { ...record, reward: rewardOf(record) };
}

// Merges a post-verification outcome into a trial; the per-criterion evidence stays in acceptance.json.
export function applyPostVerification(trial, pv) {
  const { acceptanceEvidence, ...verdicts } = pv;
  const quota = Boolean(trial.errors?.quota || isQuota(pv.verifierError) || isQuota(pv.reviewError));
  const next = { ...trial, ...verdicts, errors: { ...trial.errors, quota } };
  return { ...next, reward: rewardOf(next) };
}
```

Replace `e2e/lib/summary.mjs` from line 9 to the end with:

```js
// Unjudged values (null) count in no rate.
const rate = (xs) => {
  const v = xs.filter((x) => x != null);
  return v.length ? Number((v.filter((x) => x === 1).length / v.length).toFixed(2)) : null;
};
const acNumber = (id) => Number(id.replace(/\D/g, ''));

export function summarizeTrials(trials) {
  const checkNames = [...new Set(trials.flatMap((t) => Object.keys(t.checks ?? {})))];
  const checkRates = Object.fromEntries(checkNames.map((c) => [c, rate(trials.map((t) => t.checks?.[c] ?? 0))]));
  checkRates.acceptance = rate(trials.map((t) => t.acceptance));
  checkRates.ownTests = rate(trials.map((t) => t.ownTests));
  const acIds = [...new Set(trials.flatMap((t) => Object.keys(t.acceptanceCriteria ?? {})))].sort((a, b) => acNumber(a) - acNumber(b));
  for (const id of acIds) {
    const v = trials.map((t) => t.acceptanceCriteria?.[id]);
    checkRates[`ac:${id}`] = rate(v.map((x) => (x == null ? null : x === 'pass' ? 1 : 0)));
  }
  const criteria = [...new Set(trials.flatMap((t) => Object.keys(t.review ?? {})))];
  const failed = (error) => Boolean(error) && !isQuota(error);
  return {
    rewardRate: rate(trials.map((t) => t.reward)),
    checkRates,
    median: { tokens: median(trials.map((t) => t.tokens?.total)), agent: median(trials.map((t) => t.durations?.agent)) },
    reviewMedian: Object.fromEntries(criteria.map((c) => [c, median(trials.map((t) => t.review?.[c]))])),
    errorClasses: [...new Set([
      ...trials.flatMap((t) => ['harbor', 'bridge', 'timeout', 'quota'].filter((k) => t.errors?.[k])),
      ...(trials.some((t) => failed(t.verifierError)) ? ['verifier'] : []),
      ...(trials.some((t) => failed(t.reviewError)) ? ['judge'] : []),
    ])].sort(),
  };
}
```

Add `import { isQuota } from './claude.mjs';` below the header comment on line 1.

In `e2e/lib/compare.mjs`:
- Insert this as the first line of `compareRuns`:
  ```js
  if (base.schema !== 2 || cand.schema !== 2) throw new Error('only schema-2 runs can be compared (schema 1 has no bundles to re-verify)');
  ```
- Replace the judge loop (lines 28–33) with:
  ```js
  for (const k of Object.keys(base.summary.reviewMedian ?? {})) {
    const b = base.summary.reviewMedian[k]; const c = cand.summary.reviewMedian?.[k];
    if (b == null || c == null) continue;
    if (b - c >= thresholds.judgeMedianDrop) signals.push({ signal: `review:${k}`, base: b, cand: c, kind: 'regression' });
    else if (c - b >= 1) signals.push({ signal: `review:${k}`, base: b, cand: c, kind: 'improvement' });
  }
  ```
- In `findBaseline`, change the condition to `if (run.schema === 2 && !run.aborted && sha && isAncestor(sha)) return path.dirname(file);`.

Delete the old judge: `git rm e2e/lib/judge.mjs e2e/lib/judge.test.mjs`. In `e2e/config.json`, remove the whole `"judge": { … },` block.

- [ ] **Step 4: Run the full suite and confirm it passes**

Run: `npm test`
Expected: PASS. Nothing imports `judge.mjs` any more (`grep -rn "judge.mjs\|config.judge" e2e` gives no hits outside `run.mjs`, which Task 11 rewires).

- [ ] **Step 5: Commit**

```bash
git add -A e2e/lib/trial.mjs e2e/lib/trial.test.mjs e2e/lib/summary.mjs e2e/lib/summary.test.mjs e2e/lib/compare.mjs e2e/lib/compare.test.mjs e2e/lib/judge.mjs e2e/lib/judge.test.mjs e2e/config.json
git commit -m "feat(e2e): schema-2 trial records with per-criterion acceptance and review"
```

---

### Task 7: Fingerprint and reports for schema 2

**Files:**
- Modify: `e2e/lib/fingerprint.mjs:9-28`
- Test: `e2e/lib/fingerprint.test.mjs`
- Modify: `e2e/lib/report.mjs` (full rewrite below)
- Test: `e2e/lib/report.test.mjs` (full rewrite below)

**Interfaces:**
- Consumes: summary fields from Task 6; `run.calibration: string | null` (set by Task 11).
- Produces:
  - `buildFingerprint({ config, harness, demoRepo, verifierHash, exec? })`. It adds `verifierHash` and `models: { target, subagents, simulatedUser, verifier, review }`.
  - `renderCompare({ harness, base, cand, result, calibrated })`
  - `renderRunReport(run)`, `renderSummary(runs)`, with the same names as before.

- [ ] **Step 1: Write the failing tests.** In `e2e/lib/fingerprint.test.mjs`, pass `verifierHash: 'vh'` to `buildFingerprint` in `fingerprint records versions, hashes and image`, then add these assertions:

```js
    const config = loadConfig();
    assert.equal(fp.verifierHash, 'vh');
    assert.deepEqual(fp.models, { target: config.harnesses.codex.model, subagents: null, simulatedUser: config.simulatedUser.model,
      verifier: config.verifier.model, review: config.review.model });
```

Replace `e2e/lib/report.test.mjs` with:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRunReport, renderSummary, renderCompare } from './report.mjs';
import { summarizeTrials } from './summary.mjs';

const trial = { id: 'codex-1', reward: 0, contract: 1, checks: { spec_comment: 1, e2e_performed: 1 }, ownTests: 1,
  acceptanceCriteria: { AC1: 'pass', AC4: 'fail' }, acceptance: 0.5, verifierError: null,
  review: { conventions: 4 }, reviewReasons: { conventions: 'follows AGENTS.md' }, reviewError: null,
  durations: { agent: 225, total: 287 }, tokens: { total: 916414 }, errors: { harbor: null, bridge: null, tool: 1, timeout: false },
  soft: { superpowersActive: true } };
const run = { schema: 2, harness: 'codex', calibration: '2026-10-12T0900Z', config: { model: 'openai/gpt-6.1-sol' },
  fingerprint: { adw: { version: '0.24.0', sha: 'abc' }, verifierHash: 'f00dfeed', models: { verifier: 'claude-sonnet-5-5', review: 'claude-sonnet-5-5' } },
  trials: [trial], summary: summarizeTrials([trial]) };

test('run report shows summary, per-criterion verdicts, review reasons and the calibration', () => {
  const md = renderRunReport(run);
  for (const s of ['# E2E codex', 'openai/gpt-6.1-sol', 'verifier `claude-sonnet-5-5`', '| spec_comment | 1 |', '| ac:AC4 | 0 |',
    'codex-1', '916,414', 'Acceptance: AC1 pass · AC4 fail', 'review conventions 4: follows AGENTS.md', '| review conventions (median) | 4 |',
    'superpowers active: yes', 'Verifier calibration: `2026-10-12T0900Z`']) assert.ok(md.includes(s), s);
});

test('an uncalibrated verifier, an unjudged trial and verifier errors are visible', () => {
  const broken = { ...trial, reward: null, acceptance: null, acceptanceCriteria: { AC1: null, AC4: null }, verifierError: 'verifier timed out after 900 s' };
  const md = renderRunReport({ ...run, calibration: null, trials: [broken], summary: summarizeTrials([broken]) });
  assert.match(md, /Verifier not calibrated.*f00dfee/);
  assert.match(md, /reward — · contract 1 · acceptance —/);
  assert.match(md, /Acceptance: AC1 — · AC4 —/);
  assert.match(md, /- verifier error: verifier timed out after 900 s/);
});

test('an aborted run is flagged as not a valid baseline in report and summary', () => {
  const aborted = { ...run, aborted: 'quota' };
  assert.match(renderRunReport(aborted), /Aborted \(quota\)/);
  assert.match(renderSummary({ codex: aborted }), /\| codex \(aborted: quota\) \|/);
});

test('summary puts harnesses side by side with review medians', () => {
  const md = renderSummary({ codex: run, opencode: { ...run, harness: 'opencode' } });
  assert.match(md, /Review medians/);
  assert.match(md, /\| codex \| 0 \|/);
  assert.match(md, /\| opencode \| 0 \|/);
});

test('compare report shows verdict, signals, fingerprint diff and an uncalibrated candidate', () => {
  const result = { verdict: 'worse', signals: [{ signal: 'check:ac:AC4', base: 1, cand: 0.67, kind: 'regression' }],
    fingerprintDiff: [{ key: 'skill.codex', from: 'h1', to: 'h2' }] };
  const md = renderCompare({ harness: 'codex', base: '/b', cand: '/c', result, calibrated: true });
  for (const s of ['**worse**', 'check:ac:AC4', 'regression', 'skill.codex']) assert.ok(md.includes(s), s);
  assert.doesNotMatch(md, /not calibrated/);
  assert.match(renderCompare({ harness: 'codex', base: '/b', cand: '/c', result, calibrated: false }), /Verifier not calibrated/);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test e2e/lib/fingerprint.test.mjs e2e/lib/report.test.mjs`
Expected: FAIL (no `verifierHash`/`models`; the report still shows judge fields).

- [ ] **Step 3: Implement.** In `e2e/lib/fingerprint.mjs`:
- Change the signature to `export function buildFingerprint({ config, harness, demoRepo, verifierHash,`.
- Add these two entries after `config: configHash(config),`:

```js
    verifierHash,
    models: { target: config.harnesses[harness].model, subagents: config.harnesses[harness].subagentModel ?? null,
      simulatedUser: config.simulatedUser.model, verifier: config.verifier.model, review: config.review.model },
```

Replace `e2e/lib/report.mjs` with:

```js
const n = (v) => (typeof v === 'number' ? v.toLocaleString('en-US') : v ?? '—');
const verdicts = (ac) => Object.entries(ac ?? {}).map(([id, v]) => `${id} ${v ?? '—'}`).join(' · ') || '—';
const UNCALIBRATED = '> **Verifier not calibrated**';

function calibrationLine(run) {
  const hash = String(run.fingerprint?.verifierHash ?? '').slice(0, 7);
  return run.calibration
    ? `Verifier calibration: \`${run.calibration}\` (verifier hash ${hash})`
    : `${UNCALIBRATED} — no passing calibration for verifier hash \`${hash}\` (run \`node e2e/run.mjs calibrate\`). Treat acceptance and review verdicts with care.`;
}

export function renderRunReport(run) {
  const s = run.summary;
  const m = run.fingerprint.models ?? {};
  const lines = [`# E2E ${run.harness}`, '',
    `Model: \`${run.config.model}\` · verifier \`${m.verifier}\` · review \`${m.review}\` · adw ${run.fingerprint.adw.version} (${String(run.fingerprint.adw.sha).slice(0, 7)}) · trials: ${run.trials.length}`, '',
    ...(run.aborted ? [`> **Aborted (${run.aborted})** — incomplete run, never used as a baseline.`, ''] : []),
    calibrationLine(run), '',
    '## Summary', '', '| Signal | Value |', '|---|---|',
    `| reward rate | ${n(s.rewardRate)} |`, `| median tokens | ${n(s.median.tokens)} |`, `| median agent time (s) | ${n(s.median.agent)} |`,
    ...Object.entries(s.reviewMedian).map(([k, v]) => `| review ${k} (median) | ${n(v)} |`),
    `| error classes | ${s.errorClasses.join(', ') || 'none'} |`, '',
    '## Check pass rates', '', '| Check | Rate |', '|---|---|',
    ...Object.entries(s.checkRates).map(([k, v]) => `| ${k} | ${n(v)} |`), '', '## Trials', ''];
  for (const t of run.trials) {
    lines.push(`### ${t.id}`, '',
      `reward ${n(t.reward)} · contract ${t.contract} · acceptance ${n(t.acceptance)} · own tests ${t.ownTests} · tokens ${n(t.tokens?.total)} · agent ${n(t.durations?.agent)} s · tool errors ${t.errors?.tool ?? 0}${t.errors?.bridge ? ` · ${t.errors.bridge}` : ''}${t.errors?.harbor ? ` · harbor: ${t.errors.harbor}` : ''}`,
      `superpowers active: ${t.soft?.superpowersActive ? 'yes' : 'no'}`, '',
      `Failed checks: ${Object.entries(t.checks).filter(([, v]) => v !== 1).map(([k]) => k).join(', ') || 'none'}`,
      `Acceptance: ${verdicts(t.acceptanceCriteria)}`, '');
    if (t.verifierError) lines.push(`- verifier error: ${t.verifierError}`);
    if (t.reviewError) lines.push(`- review error: ${t.reviewError}`);
    for (const [k, r] of Object.entries(t.reviewReasons ?? {})) lines.push(`- review ${k} ${t.review?.[k]}: ${r}`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function renderSummary(runs) {
  const rows = Object.values(runs).map((r) => `| ${r.harness}${r.aborted ? ` (aborted: ${r.aborted})` : ''} | ${n(r.summary.rewardRate)} | ${n(r.summary.median.tokens)} | ${n(r.summary.median.agent)} | ${Object.values(r.summary.reviewMedian).map(n).join(' / ')} | ${r.summary.errorClasses.join(', ') || 'none'} |`);
  return `# E2E summary\n\n| Harness | Reward rate | Median tokens | Median agent s | Review medians | Errors |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
}

export function renderCompare({ harness, base, cand, result, calibrated }) {
  return [`# Compare ${harness}: **${result.verdict}**`, '', `Baseline: \`${base}\``, `Candidate: \`${cand}\``, '',
    ...(calibrated === false ? [`${UNCALIBRATED} for the candidate: acceptance and review signals may be verifier noise.`, ''] : []),
    '## Signals', '', '| Signal | Baseline | Candidate | Kind |', '|---|---|---|---|',
    ...(result.signals.length ? result.signals.map((s) => `| ${s.signal} | ${n(s.base)} | ${n(s.cand)} | ${s.kind} |`) : ['| — | | | |']), '',
    '## What changed (fingerprint diff)', '',
    ...(result.fingerprintDiff.length ? result.fingerprintDiff.map((d) => `- \`${d.key}\`: ${d.from} → ${d.to}`) : ['- nothing']), ''].join('\n');
}
```

- [ ] **Step 4: Run the full suite and confirm it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add e2e/lib/fingerprint.mjs e2e/lib/fingerprint.test.mjs e2e/lib/report.mjs e2e/lib/report.test.mjs
git commit -m "feat(e2e): verifier hash, role models and calibration status in reports"
```

---

### Task 8: Calibration evaluation, lookup and report

**Files:**
- Create: `e2e/lib/calibration.mjs`
- Test: `e2e/lib/calibration.test.mjs`

**Interfaces:**
- Consumes: `median` (`summary.mjs`); `PostVerification` results (Task 5).
- Produces:
  - `evaluateCalibration({ expected, results, criteria, rubric }) → { pass, findings: [{ variant, check, expected, got, kind: 'wrong'|'flaky' }], reviewMedians }`. Inputs:
    - `expected[variant] = { fail: string[], reviewMin?: number, reviewBelowReference?: { [k]: delta } }`;
    - `results[variant] = PostVerification[]`.
  - `findCalibration({ dir, hash }) → string | null`: the name of the newest timestamp dir under `dir` whose `calibration.json` has the same `hash` and `pass: true`.
  - `renderCalibrationReport(cal) → string`, where `cal = { ts, hash, pass, runs, models, findings, reviewMedians, variants }`.

- [ ] **Step 1: Write the failing tests** in `e2e/lib/calibration.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluateCalibration, findCalibration, renderCalibrationReport } from './calibration.mjs';

const criteria = [{ id: 'AC1', text: 'a' }, { id: 'AC4', text: 'b' }];
const rubric = { conventions: 'q', tests: 'q' };
const pv = (ac1, ac4, review = { conventions: 5, tests: 5 }) => ({ acceptanceCriteria: { AC1: ac1, AC4: ac4 }, review,
  verifierError: ac1 === null ? 'verifier exit 1: crash' : null, reviewError: null });

test('a calibration passes when every verdict matches in every run and the review expectations hold', () => {
  const expected = { reference: { fail: [], reviewMin: 4 }, 'broken-done': { fail: ['AC4'] }, messy: { fail: [], reviewBelowReference: { conventions: 2 } } };
  const results = { reference: [pv('pass', 'pass'), pv('pass', 'pass')], 'broken-done': [pv('pass', 'fail'), pv('pass', 'fail')],
    messy: [pv('pass', 'pass', { conventions: 2, tests: 5 }), pv('pass', 'pass', { conventions: 3, tests: 5 })] };
  const r = evaluateCalibration({ expected, results, criteria, rubric });
  assert.deepEqual(r.findings, []);
  assert.equal(r.pass, true);
  assert.deepEqual(r.reviewMedians.messy, { conventions: 2.5, tests: 5 });
});

test('a verdict wrong in every run is wrong, in some runs flaky; a verifier error counts as a miss', () => {
  const expected = { 'broken-done': { fail: ['AC4'] } };
  const wrong = evaluateCalibration({ expected, criteria, rubric, results: { 'broken-done': [pv('pass', 'pass'), pv('pass', 'pass')] } });
  assert.deepEqual(wrong.findings, [{ variant: 'broken-done', check: 'AC4', expected: 'fail', got: ['pass', 'pass'], kind: 'wrong' }]);
  const flaky = evaluateCalibration({ expected, criteria, rubric, results: { 'broken-done': [pv('pass', 'fail'), pv(null, null)] } });
  assert.deepEqual(flaky.findings.map((f) => [f.check, f.kind]), [['AC1', 'flaky'], ['AC4', 'flaky']]);
  assert.equal(flaky.pass, false);
});

test('review expectations are checked on the median per variant', () => {
  const expected = { reference: { fail: [], reviewMin: 4 }, messy: { fail: [], reviewBelowReference: { conventions: 2, tests: 2 } } };
  const results = { reference: [pv('pass', 'pass', { conventions: 5, tests: 3 }), pv('pass', 'pass', { conventions: 5, tests: 5 })],
    messy: [pv('pass', 'pass', { conventions: 4, tests: 2 }), pv('pass', 'pass', { conventions: 4, tests: 2 })] };
  const r = evaluateCalibration({ expected, results, criteria, rubric });
  assert.deepEqual(r.findings.map((f) => [f.variant, f.check, f.kind]), [['messy', 'review:conventions', 'wrong']]);
});

test('a variant without runs, or with null review scores, fails', () => {
  const none = evaluateCalibration({ expected: { reference: { fail: [], reviewMin: 4 } }, criteria, rubric, results: { reference: [] } });
  assert.deepEqual(none.findings, [{ variant: 'reference', check: 'runs', expected: '≥ 1', got: 0, kind: 'wrong' }]);
  const unscored = evaluateCalibration({ expected: { reference: { fail: [], reviewMin: 4 } }, criteria, rubric, results: { reference: [pv('pass', 'pass', null)] } });
  assert.deepEqual(unscored.findings.map((f) => f.check), ['review:conventions', 'review:tests']);
});

test('findCalibration picks the newest passing calibration with the same hash', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-cal-'));
  try {
    for (const [ts, hash, pass] of [['2026-10-12T0900Z', 'h1', true], ['2026-10-12T1000Z', 'h1', false], ['2026-10-12T1100Z', 'h2', true]]) {
      mkdirSync(path.join(dir, ts));
      writeFileSync(path.join(dir, ts, 'calibration.json'), JSON.stringify({ hash, pass }));
    }
    assert.equal(findCalibration({ dir, hash: 'h1' }), '2026-10-12T0900Z');
    assert.equal(findCalibration({ dir, hash: 'h3' }), null);
    assert.equal(findCalibration({ dir: path.join(dir, 'missing'), hash: 'h1' }), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the calibration report shows the verdict, findings, per-run verdicts, review medians and errors', () => {
  const md = renderCalibrationReport({ ts: 't', hash: 'abcdef0123', pass: false, runs: 2, models: { verifier: 'v-m', review: 'r-m' },
    findings: [{ variant: 'broken-done', check: 'AC4', expected: 'fail', got: ['pass', null], kind: 'flaky' }],
    reviewMedians: { 'broken-done': { conventions: 4, tests: 5 } },
    variants: { 'broken-done': [pv('pass', 'pass'), pv(null, null)] } });
  for (const s of ['**fail**', '`abcdef0`', 'verifier `v-m`', '| broken-done | AC4 | fail | pass — | flaky |',
    '| broken-done | pass — | pass — |', '| broken-done | 4 | 5 |', '- broken-done run 2 verifier: verifier exit 1: crash']) assert.ok(md.includes(s), s);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test e2e/lib/calibration.test.mjs`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement** `e2e/lib/calibration.mjs`:

```js
// Calibration of the E2E verifier and the review judge: known patch variants of the seed repo,
// judged by the same post-verification as a trial and compared with their expected verdicts.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { median } from './summary.mjs';

export function evaluateCalibration({ expected, results, criteria, rubric }) {
  const reviewMedians = Object.fromEntries(Object.entries(results).map(([variant, runs]) =>
    [variant, Object.fromEntries(Object.keys(rubric).map((k) => [k, median(runs.map((r) => r.review?.[k]))]))]));
  const findings = [];
  for (const [variant, exp] of Object.entries(expected)) {
    const runs = results[variant] ?? [];
    if (!runs.length) { findings.push({ variant, check: 'runs', expected: '≥ 1', got: 0, kind: 'wrong' }); continue; }
    // A criterion verdict must match in every run.
    for (const { id } of criteria) {
      const want = exp.fail.includes(id) ? 'fail' : 'pass';
      const got = runs.map((r) => r.acceptanceCriteria?.[id] ?? null);
      const misses = got.filter((g) => g !== want).length;
      if (misses) findings.push({ variant, check: id, expected: want, got, kind: misses === runs.length ? 'wrong' : 'flaky' });
    }
    // Review expectations hold on the median.
    const medians = reviewMedians[variant];
    if (exp.reviewMin != null) {
      for (const k of Object.keys(rubric)) {
        if (medians[k] == null || medians[k] < exp.reviewMin) findings.push({ variant, check: `review:${k}`, expected: `≥ ${exp.reviewMin}`, got: medians[k], kind: 'wrong' });
      }
    }
    for (const [k, delta] of Object.entries(exp.reviewBelowReference ?? {})) {
      const ref = reviewMedians.reference?.[k];
      if (ref == null || medians[k] == null || ref - medians[k] < delta) {
        findings.push({ variant, check: `review:${k}`, expected: `≤ reference − ${delta} (reference ${ref ?? '—'})`, got: medians[k], kind: 'wrong' });
      }
    }
  }
  return { pass: findings.length === 0, findings, reviewMedians };
}

export function findCalibration({ dir, hash }) {
  if (!existsSync(dir)) return null;
  for (const ts of readdirSync(dir).sort().reverse()) {
    const file = path.join(dir, ts, 'calibration.json');
    if (!existsSync(file)) continue;
    const cal = JSON.parse(readFileSync(file, 'utf8'));
    if (cal.hash === hash && cal.pass === true) return ts;
  }
  return null;
}

const cell = (v) => v ?? '—';

export function renderCalibrationReport(cal) {
  const ids = Object.keys(Object.values(cal.variants)[0]?.[0]?.acceptanceCriteria ?? {});
  const rubric = Object.keys(Object.values(cal.reviewMedians)[0] ?? {});
  const errors = Object.entries(cal.variants).flatMap(([v, runs]) => runs.flatMap((r, i) => [
    r.verifierError && `- ${v} run ${i + 1} verifier: ${r.verifierError}`, r.reviewError && `- ${v} run ${i + 1} review: ${r.reviewError}`].filter(Boolean)));
  return [`# Verifier calibration: **${cal.pass ? 'pass' : 'fail'}**`, '',
    `Verifier hash \`${cal.hash.slice(0, 7)}\` · verifier \`${cal.models.verifier}\` · review \`${cal.models.review}\` · runs per variant: ${cal.runs}`, '',
    '## Findings', '', '| Variant | Check | Expected | Got | Kind |', '|---|---|---|---|---|',
    ...(cal.findings.length ? cal.findings.map((f) => `| ${f.variant} | ${f.check} | ${f.expected} | ${Array.isArray(f.got) ? f.got.map(cell).join(' ') : cell(f.got)} | ${f.kind} |`) : ['| — | | | | |']), '',
    '## Acceptance verdicts (one per run)', '', `| Variant | ${ids.join(' | ')} |`, `|---|${ids.map(() => '---|').join('')}`,
    ...Object.entries(cal.variants).map(([v, runs]) => `| ${v} | ${ids.map((id) => runs.map((r) => cell(r.acceptanceCriteria?.[id])).join(' ')).join(' | ')} |`), '',
    '## Review medians', '', `| Variant | ${rubric.join(' | ')} |`, `|---|${rubric.map(() => '---|').join('')}`,
    ...Object.entries(cal.reviewMedians).map(([v, m]) => `| ${v} | ${rubric.map((k) => cell(m[k])).join(' | ')} |`), '',
    '## Errors', '', ...(errors.length ? errors : ['none']), ''].join('\n');
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test e2e/lib/calibration.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add e2e/lib/calibration.mjs e2e/lib/calibration.test.mjs
git commit -m "feat(e2e): verifier calibration against expected verdicts"
```

---

### Task 9: Container side: TEST_COMMAND, PR-head bundle, no hidden tests, behavioural briefing

**Files:**
- Modify: `e2e/tasks/demo-todo/tests/checks.mjs` (append two functions)
- Test: `e2e/tasks/demo-todo/tests/checks.test.mjs`
- Modify: `e2e/tasks/demo-todo/tests/verify.mjs` (full rewrite below)
- Delete: `e2e/tasks/demo-todo/tests/acceptance.test.mjs`, `e2e/tasks/demo-todo/tests/acceptance-ui.mjs`
- Modify: `e2e/tasks/demo-todo/task.toml` (`[verifier.env]`)
- Modify: `e2e/tasks/demo-todo/environment/seed/seed.sh` (skip when `E2E_VERIFY=1`)
- Modify: `e2e/tasks/demo-todo/instruction.md` (behavioural bullets; prose only, no test)

**Interfaces:**
- Produces:
  - `testCommand(env) → string` (throws when `TEST_COMMAND` is unset);
  - `runOwnTests(dir, command, run) → { pass: 0|1, out }`.
- Verifier output, read by Task 11: `/logs/verifier/` (Harbor's `trialDir/verifier/`) contains `ticket.json`, `pulls.json`, `pr.diff`, `pr-commits.txt`, `pr-head.bundle`, `own-tests.txt`, `reward.json`, `notes.txt`, and `clone-error.txt` on failure. `reward.json` has no `acceptance` key any more.
- Bundle shape: `main` plus the PR branch (as in Task 4).

- [ ] **Step 1: Write the failing test.** Append to `e2e/tasks/demo-todo/tests/checks.test.mjs`, and add `runOwnTests, testCommand` to its import from `./checks.mjs`:

```js
test('own tests run the task TEST_COMMAND in the PR checkout', () => {
  const calls = [];
  const r = runOwnTests('/tmp/pr', testCommand({ TEST_COMMAND: ' npm test ' }), (cwd, cmd, args) => { calls.push([cwd, cmd, args]); return { ok: false, out: 'boom' }; });
  assert.deepEqual(calls, [['/tmp/pr', 'bash', ['-c', 'npm test']]]);
  assert.deepEqual(r, { pass: 0, out: 'boom' });
  assert.equal(runOwnTests('/tmp/pr', 'dotnet test', () => ({ ok: true, out: '' })).pass, 1);
  assert.throws(() => testCommand({}), /TEST_COMMAND/);
  assert.throws(() => testCommand({ TEST_COMMAND: '  ' }), /TEST_COMMAND/);
});
```

Run: `node --test e2e/tasks/demo-todo/tests/checks.test.mjs`
Expected: FAIL (`runOwnTests` is not exported).

- [ ] **Step 2: Implement.** Append to `e2e/tasks/demo-todo/tests/checks.mjs`:

```js

// The task's own test command (task.toml [verifier.env] TEST_COMMAND): no stack is assumed here.
export function testCommand(env) {
  const command = env.TEST_COMMAND?.trim();
  if (!command) throw new Error('TEST_COMMAND is not set (task.toml [verifier.env])');
  return command;
}

// Runs the agent's own tests on the PR head; run(cwd, cmd, args) returns { ok, out }.
export function runOwnTests(dir, command, run) {
  const r = run(dir, 'bash', ['-c', command]);
  return { pass: r.ok ? 1 : 0, out: r.out };
}
```

Replace `e2e/tasks/demo-todo/tests/verify.mjs` with:

```js
// Harbor verifier: Gitea contract checks and the agent's own tests on the PR head. It stores the PR
// head as a git bundle; acceptance and review run on the host from it (e2e/lib/postverify.mjs).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluateContract, runOwnTests, testCommand } from './checks.mjs';

const OUT = '/logs/verifier';
const TOKEN = readFileSync('/shared/token', 'utf8').trim();
const API = 'http://gitea:3000/api/v1/repos/adw/demo-todo';
const TEST_COMMAND = testCommand(process.env); // a task without it is misconfigured: fail loudly
const redact = (s) => String(s).split(TOKEN).join('***');
const get = async (p) => {
  const res = await fetch(`${API}${p}`, { headers: { authorization: `token ${TOKEN}` } });
  if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
  return res.json();
};
const write = (f, d) => writeFileSync(path.join(OUT, f), redact(typeof d === 'string' ? d : JSON.stringify(d, null, 2)));
const run = (cwd, cmd, args, env = {}) => {
  try { return { ok: true, out: redact(execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, ...env } })) }; }
  catch (e) { return { ok: false, out: redact(`${e.stdout ?? ''}${e.stderr ?? ''}`) }; }
};
const listening = async (url) => { try { await fetch(url, { signal: AbortSignal.timeout(1500) }); return true; } catch { return false; } };

const issue = await get('/issues/1');
const comments = await get('/issues/1/comments');
const pulls = await get('/pulls?state=all');
write('ticket.json', { issue: { state: issue.state, labels: issue.labels.map((l) => ({ name: l.name })) },
  comments: comments.map((c) => ({ body: c.body, created_at: c.created_at })) });
write('pulls.json', pulls.map((p) => ({ title: p.title, merged: p.merged, state: p.state, base: { ref: p.base.ref }, head: { ref: p.head.ref } })));

let prDiff = ''; let ownTests = 0;
const pr = pulls[0];
if (pr) try {
  const dir = mkdtempSync(path.join(tmpdir(), 'pr-'));
  execFileSync('git', ['clone', '-q', '-b', pr.head.ref, `http://adw:${TOKEN}@gitea:3000/adw/demo-todo.git`, dir]);
  prDiff = execFileSync('git', ['-C', dir, 'diff', 'origin/main...HEAD'], { encoding: 'utf8' });
  write('pr.diff', prDiff);
  write('pr-commits.txt', execFileSync('git', ['-C', dir, 'log', '--format=%h %s', 'origin/main..HEAD'], { encoding: 'utf8' }));
  // main plus the PR branch: the shape e2e/lib/bundle.mjs expects.
  execFileSync('git', ['-C', dir, 'branch', 'main', 'origin/main'], { stdio: 'pipe' });
  execFileSync('git', ['-C', dir, 'bundle', 'create', path.join(OUT, 'pr-head.bundle'), 'main', pr.head.ref], { stdio: 'pipe' });
  const tests = runOwnTests(dir, TEST_COMMAND, run);
  write('own-tests.txt', tests.out);
  ownTests = tests.pass;
} catch (e) {
  write('clone-error.txt', String(e.message));
  ownTests = 0;
}

const checks = evaluateContract({ issue, comments, pulls, prDiff, appListening: await listening('http://127.0.0.1:3000/health') });
const reward = { ...checks, own_tests_pass: ownTests };
write('reward.json', reward);
write('notes.txt', Object.entries(reward).filter(([, v]) => v !== 1).map(([k, v]) => `${k}=${v}`).join('\n'));
console.log(JSON.stringify(reward, null, 2));
```

Then:
- Delete the hidden tests: `git rm e2e/tasks/demo-todo/tests/acceptance.test.mjs e2e/tasks/demo-todo/tests/acceptance-ui.mjs`.
- In `e2e/tasks/demo-todo/task.toml`, change the empty `[verifier.env]` section to:

```toml
[verifier.env]
TEST_COMMAND = "npm test"
```

- In `e2e/tasks/demo-todo/environment/seed/seed.sh`, insert after `set -euo pipefail`:

```bash
# Post-verification (e2e/lib/postverify.mjs) reuses this image without Gitea: nothing to seed.
[[ "${E2E_VERIFY:-}" == 1 ]] && exit 0
```

- In `e2e/tasks/demo-todo/instruction.md`, replace the bullet list under "What you actually want …" (from `- A todo gets an optional field` through `- Nothing else: …`) with the list below:

```markdown
- A todo can optionally get a due date: a calendar date without a time.
- The due date can be set when a todo is created, and changed or removed later.
- An invalid date (wrong format, or an impossible date such as 30 February) is rejected with HTTP 400.
- The API can filter for overdue todos: todos that are not done and whose due date is before today
  (UTC). Todos without a due date are never overdue.
- The list page shows each todo's due date next to its title.
- Overdue todos are visibly marked with the word "überfällig".
- The list page has a control labelled "nur überfällige" that shows only overdue todos.
- Nothing else: no sorting, no reminders, no styling work.

How endpoints, parameters, fields and page elements are named is the agent's choice.
```

Also change the spec-approval answer to: `- When asked to approve a design or written spec: read it; approve it if it covers the bullets above (naming is the agent's choice), otherwise name the deviation and ask for a correction.`

- [ ] **Step 3: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS. `checks.test.mjs` passes 3 tests.

Run: `grep -rn "acceptance.test\|acceptance-ui\|node --test" e2e/tasks/demo-todo/tests e2e/run.mjs`
Expected: the only hit is the evidence file list in `e2e/run.mjs` (`acceptance.tap`, `acceptance-ui.txt`), which Task 11 replaces.

- [ ] **Step 4: Commit**

```bash
git add -A e2e/tasks/demo-todo/tests e2e/tasks/demo-todo/task.toml e2e/tasks/demo-todo/environment/seed/seed.sh e2e/tasks/demo-todo/instruction.md
git commit -m "feat(e2e): container verifier writes the PR-head bundle; hidden tests removed"
```

---

### Task 10: Calibration variants

**Files:**
- Create: `e2e/tasks/demo-todo/calibration/reference.patch`, `alt-interface.patch`, `broken-done.patch`, `broken-ui.patch` and `messy.patch`, verbatim from **Appendix A**.
- Create: `e2e/tasks/demo-todo/calibration/expected.json`, `spec.md` and `summary.md` (below).

**Interfaces:**
- Consumes: `createCalibrationBundle` and `checkoutBundle` (Task 4).
- Produces: the inputs of `run.mjs calibrate` (Task 11). The variant names are the keys of `expected.json`, and each name has a `<name>.patch`.

The planner has already run these five patches against the seed: they apply, their own tests pass, and a deterministic Playwright oracle (Appendix B) confirmed every expected verdict. This task reproduces that check.

- [ ] **Step 1: Write the files.** Copy the five patches from Appendix A byte for byte: LF, a trailing newline, no trailing-whitespace edits.

`expected.json`:

```json
{
  "reference": { "fail": [], "reviewMin": 4 },
  "alt-interface": { "fail": [] },
  "broken-done": { "fail": ["AC4"] },
  "broken-ui": { "fail": ["AC6", "AC7"] },
  "messy": { "fail": [], "reviewBelowReference": { "conventions": 2, "architecture": 2, "tests": 2 } }
}
```

`spec.md`, the "posted spec" the review judge sees for every variant (interface-neutral on purpose):

```markdown
## Approved Spec

Due dates for todos (ticket #1).

- A todo has an optional due date: a calendar date without a time. It can be set when the todo is
  created, and changed or removed later.
- An invalid date (wrong format, or an impossible date such as 30 February) is rejected with HTTP 400.
- The API can return only overdue todos: todos that are not done and whose due date is before today
  (UTC). Todos without a due date are never overdue.
- The list page shows each todo's due date next to its title, marks overdue todos with the word
  "überfällig", and has a control labelled "nur überfällige" that shows only overdue todos.
- Out of scope: sorting, reminders, styling.
```

`summary.md`:

```markdown
## Implementation Summary

Implements the approved spec for ticket #1 (due dates). The change is in the pull request diff.
```

- [ ] **Step 2: Build every variant through the real bundle code, and run its own tests**

```bash
S=$(mktemp -d)
node --input-type=module -e '
const { createCalibrationBundle, checkoutBundle } = await import(process.cwd() + "/e2e/lib/bundle.mjs");
const root = process.cwd(); const dir = process.argv[1];
for (const v of ["reference", "alt-interface", "broken-done", "broken-ui", "messy"]) {
  createCalibrationBundle({ root, seedRepo: root + "/e2e/tasks/demo-todo/environment/seed/repo",
    patch: root + "/e2e/tasks/demo-todo/calibration/" + v + ".patch", out: dir + "/" + v + ".bundle" });
  checkoutBundle(dir + "/" + v + ".bundle", dir + "/" + v);
}' "$S"
for v in reference alt-interface broken-done broken-ui messy; do (cd "$S/$v" && npm test >/dev/null 2>&1 && echo "$v: own tests pass"); done
```

Expected: five `own tests pass` lines.

- [ ] **Step 3: Check every variant's behaviour with the deterministic oracle** (Docker, no LLM). Write Appendix B to `$S/check-variant.mjs`, then run:

```bash
for v in reference:dueDate:overdue=true broken-done:dueDate:overdue=true broken-ui:dueDate:overdue=true messy:dueDate:overdue=true alt-interface:due:overdue=1; do
  IFS=: read -r name field query <<<"$v"; printf '%s ' "$name"
  docker run --rm -e AGENT_TOOLSTACK_ONLY=1 --entrypoint bash -v "$S/$name:/v:ro" -v "$S/check-variant.mjs:/check.mjs:ro" \
    ai-dev-workflow-node:latest -lc "node /check.mjs $field $query" 2>&1 | tail -1
done
```

Expected, exactly:

```
reference {"AC1":true,"AC2":true,"AC3":true,"AC4":true,"AC5":true,"AC6":true,"AC7":true}
broken-done {"AC1":true,"AC2":true,"AC3":true,"AC4":false,"AC5":true,"AC6":true,"AC7":true}
broken-ui {"AC1":true,"AC2":true,"AC3":true,"AC4":true,"AC5":true,"AC6":false,"AC7":false}
messy {"AC1":true,"AC2":true,"AC3":true,"AC4":true,"AC5":true,"AC6":true,"AC7":true}
alt-interface {"AC1":true,"AC2":true,"AC3":true,"AC4":true,"AC5":true,"AC6":true,"AC7":true}
```

The oracle is throwaway and is not committed. Leave `$S` alone; it is in the system temp dir.

- [ ] **Step 4: Commit**

```bash
git add e2e/tasks/demo-todo/calibration
git commit -m "test(e2e): calibration variants with expected verifier and review verdicts"
```

---

### Task 11: Wire `run`, `verify` and `calibrate` in `run.mjs`; docs; drop the schema-1 baseline

**Files:**
- Modify: `e2e/run.mjs` (full rewrite below)
- Modify: `docs/adw-e2e/README.md`
- Modify: `AGENTS.md` (E2E section, one sentence)
- Delete: `docs/adw-e2e/2026-10-11T1903Z/`, `docs/adw-e2e/2026-10-11T1945Z/` (schema 1, no bundles; never on `main`)

**Interfaces:**
- Consumes everything above:
  - `loadCriteria` (1);
  - `isQuota` (2);
  - `bundleLeaks`, `createCalibrationBundle` (4);
  - `buildTaskImage`, `postVerify`, `verifierHash` (5);
  - `applyPostVerification`, `buildTrialRecord`, `emptyOutcome`, `section` (6);
  - `buildFingerprint({ …, verifierHash })`, `renderCompare({ …, calibrated })` (7);
  - `evaluateCalibration`, `findCalibration`, `renderCalibrationReport` (8);
  - the verifier output files (9);
  - the calibration files (10).
- Produces the CLI:

  ```
  node e2e/run.mjs preflight | run [--harness h]... [--repetitions n] | verify <harnessDir> [--trial id]
                  | calibrate [--runs n] | compare <baseDir> <candDir> | report <harnessDir>
  ```

  Results go to:
  - `docs/adw-e2e/<ts>/<harness>/evidence/<trial>/{acceptance.json, review.json, pr-head.bundle, own-tests.txt, …}`
  - `docs/adw-e2e/calibration/<ts>/{calibration.json, report.md}`

- [ ] **Step 1: Replace `e2e/run.mjs`** with:

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
import { applyPostVerification, buildTrialRecord, emptyOutcome, section } from './lib/trial.mjs';
import { summarizeTrials } from './lib/summary.mjs';
import { compareRuns, findBaseline } from './lib/compare.mjs';
import { renderCompare, renderRunReport, renderSummary } from './lib/report.mjs';
import { loadCriteria } from './lib/criteria.mjs';
import { buildTaskImage, postVerify, verifierHash } from './lib/postverify.mjs';
import { bundleLeaks, createCalibrationBundle } from './lib/bundle.mjs';
import { evaluateCalibration, findCalibration, renderCalibrationReport } from './lib/calibration.mjs';
import { isQuota } from './lib/claude.mjs';

const config = loadConfig();
const { positionals, values: opts } = parseArgs({ allowPositionals: true,
  options: { harness: { type: 'string', multiple: true }, repetitions: { type: 'string' }, trial: { type: 'string' }, runs: { type: 'string' } } });
const [command, ...rest] = positionals;
const harnesses = opts.harness?.length ? opts.harness : Object.keys(config.harnesses);
const task = path.join(config.root, 'e2e', config.task);
const demoRepo = path.join(task, 'environment/seed/repo');
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(2); };
const unknown = harnesses.filter((h) => !Object.hasOwn(config.harnesses, h));
if (unknown.length) fail(`unknown harness: ${unknown.join(', ')} (known: ${Object.keys(config.harnesses).join(', ')})`);
for (const name of ['repetitions', 'runs']) {
  if (opts[name] !== undefined && !/^[1-9]\d*$/.test(opts[name])) fail(`--${name} must be a positive integer, got "${opts[name]}"`);
}
const git = (...a) => execFileSync('git', a, { cwd: config.root, encoding: 'utf8' }).trim();
const timestamp = () => new Date().toISOString().replace(/:\d\d\.\d+Z$/, 'Z').replace(/:/g, '');
const criteria = loadCriteria(path.join(task, 'acceptance-criteria.md'));
const hash = verifierHash({ config, criteria });
const calibrationDir = path.join(config.root, config.resultsDir, 'calibration');
const calibration = () => findCalibration({ dir: calibrationDir, hash });
const acLine = (x) => Object.entries(x.acceptanceCriteria).map(([id, v]) => `${id} ${v ?? '—'}`).join(' · ');

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
// summary.md covers every harness of one result set.
function writeSummary(outRoot) {
  const runs = Object.fromEntries(readdirSync(outRoot).filter((h) => existsSync(path.join(outRoot, h, 'run.json')))
    .map((h) => [h, readRun(path.join(outRoot, h))]));
  writeResult(path.join(outRoot, 'summary.md'), renderSummary(runs));
}

function safeCleanupCompose() {
  try { cleanupCompose(); } catch (e) { console.warn(`! compose cleanup failed: ${e.message}`); }
}

function preflight() {
  const staged = stageSecrets({ config, invocationDir: path.join(config.root, config.jobsDir, 'preflight') });
  const has = { 'claude-code': 'CLAUDE_CODE_OAUTH_TOKEN', codex: 'CODEX_AUTH_JSON_PATH', opencode: 'OPENCODE_AUTH_JSON_PATH' };
  let r;
  try {
    r = runPreflight({ config, harnesses, env: staged.env, authPresent: (h) => Boolean(staged.env[has[h]]) });
  } finally {
    staged.cleanup();
  }
  for (const w of r.warnings ?? []) console.warn(`! ${w}`);
  for (const p of r.problems) console.error(`✗ ${p}`);
  console.log(r.ok ? 'preflight ok' : 'preflight failed');
  return r.ok;
}

// verify and calibrate need only the Claude login (verifier and review).
function stageClaude(name) {
  const staged = stageSecrets({ config, invocationDir: path.join(config.root, config.jobsDir, name) });
  if (!staged.env.CLAUDE_CODE_OAUTH_TOKEN) { staged.cleanup(); fail(`claude login missing: put CLAUDE_CODE_OAUTH_TOKEN into ${config.auth.claudeEnvFile}`); }
  secretValues = staged.values;
  return staged;
}

// The E2E verifier and the review judge on one PR head (e2e/lib/postverify.mjs).
function postVerifyTrial(bundle, evidenceDir, env, image) {
  const ticket = JSON.parse(readFileSync(path.join(evidenceDir, 'ticket.json'), 'utf8'));
  return postVerify({ config, bundle, criteria, env, image,
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
  const result = compareRuns(base, cand, config.thresholds);
  writeResult(path.join(candDir, 'compare.md'), renderCompare({ harness: cand.harness, base: baseDir, cand: candDir, result, calibrated: Boolean(cand.calibration) }));
  console.log(`${cand.harness}: ${result.verdict} (${path.join(candDir, 'compare.md')})`);
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

async function run() {
  if (!preflight()) process.exit(1);
  rmSync(path.join(demoRepo, 'ai-project.json'), { force: true }); // init --answers needs a fresh tree
  execFileSync('node', ['agent-src/generate.mjs', 'init', '--answers', path.join(task, 'environment/seed/answers.json'), '--root', demoRepo],
    { cwd: config.root, stdio: 'inherit', input: '' });
  execFileSync('node', ['agent-src/generate.mjs', 'generate', '--root', demoRepo], { cwd: config.root, stdio: 'inherit' });
  const image = buildTaskImage({ config });
  const calibrated = calibration();
  if (!calibrated) console.warn('! verifier not calibrated for this verifier hash: run node e2e/run.mjs calibrate');
  const ts = timestamp();
  const jobsDir = path.join(config.root, config.jobsDir, ts);
  const outRoot = path.join(config.root, config.resultsDir, ts);
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
    for (const harness of harnesses) {
      if (aborted) break;
      const fingerprint = buildFingerprint({ config, harness, demoRepo, verifierHash: hash });
      const trials = [];
      for (let i = 1; i <= repetitions; i++) {
        const id = `${harness}-${i}`;
        console.log(`▶ ${id}`);
        const failed = (harbor) => ({ id, reward: 0, contract: 0, checks: {}, ownTests: 0, ...emptyOutcome(criteria),
          errors: { harbor, bridge: null, tool: 0, timeout: false, quota: false } });
        let trial;
        try {
          const log = createWriteStream(path.join(jobsDir, `${id}.log`));
          log.on('error', (e) => console.warn(`! log stream error: ${e.message}`));
          const code = await runHarbor({ args: buildHarborArgs({ config, harness, jobName: id, jobsDir }), cwd: config.root, logStream: log,
            timeoutMs: 7_200_000,
            env: { ...staged.env, PYTHONPATH: path.join(config.root, 'e2e'), E2E_CLAUDE_SUBAGENT_MODEL: config.harnesses[harness].subagentModel ?? '' } });
          log.end();
          safeCleanupCompose();
          const jobDir = path.join(jobsDir, id);
          const trialDir = existsSync(jobDir) ? readdirSync(jobDir).map((d) => path.join(jobDir, d)).find((d) => path.basename(d).startsWith('demo-todo__')) : null;
          trial = trialDir ? buildTrialRecord({ id, harness, trialDir, config, criteria }) : failed(`harbor exit ${code}`);
          if (trialDir && code !== 0 && !trial.errors.harbor) trial.errors.harbor = `harbor exit ${code}`;
          // The OpenCode adapter uploads its auth.json into the bind-mounted logs dir: never keep it.
          if (trialDir) rmSync(path.join(trialDir, 'agent/opencode/xdg-data/opencode/auth.json'), { force: true });
          if (trialDir && existsSync(path.join(trialDir, 'verifier'))) {
            const ev = path.join(outRoot, harness, 'evidence', id);
            mkdirSync(ev, { recursive: true });
            for (const f of ['ticket.json', 'pulls.json', 'pr.diff', 'pr-commits.txt', 'own-tests.txt', 'notes.txt', 'clone-error.txt']) {
              const src = path.join(trialDir, 'verifier', f);
              if (existsSync(src)) writeResult(path.join(ev, f), readFileSync(src, 'utf8'));
            }
            const bundle = path.join(trialDir, 'verifier/pr-head.bundle');
            if (existsSync(bundle)) {
              if (bundleLeaks(bundle, staged.values)) {
                console.error(`✗ ${id}: a secret occurs in the PR history: bundle not stored, the trial cannot be re-verified`);
                process.exitCode = 1;
              } else copyFileSync(bundle, path.join(ev, 'pr-head.bundle'));
              console.log('  post-verifying (E2E verifier, review)');
              const pv = postVerifyTrial(bundle, ev, staged.env, image);
              writeVerdicts(ev, pv);
              trial = applyPostVerification(trial, pv);
              console.log(`  ${acLine(trial)}`);
            }
          }
        } catch (e) {
          trial = failed(`runner error: ${e.message}`);
          safeCleanupCompose();
        }
        trials.push(trial);
        console.log(`  reward ${trial.reward} · contract ${trial.contract} · acceptance ${trial.acceptance}`);
        // Every later trial would fail the same way and poison the comparison: stop here.
        if (trial.errors?.quota) {
          aborted = 'quota';
          console.error(`✗ subscription usage limit reached in ${id}: run aborted, results are not a valid baseline`);
          break;
        }
      }
      const h = config.harnesses[harness];
      const runRecord = { schema: 2, harness, ...(aborted ? { aborted } : {}), fingerprint, calibration: calibrated,
        config: { model: h.model, subagentModel: h.subagentModel ?? null, agentKwargs: h.agentKwargs, repetitions },
        trials, summary: summarizeTrials(trials) };
      const dir = path.join(outRoot, harness);
      writeRun(dir, runRecord);
      try {
        const baseline = findBaseline({ resultsDir: path.join(config.root, config.resultsDir), harness, before: ts,
          isAncestor: (sha) => { try { git('merge-base', '--is-ancestor', sha, 'main'); return true; } catch { return false; } } });
        if (baseline && !aborted) compareDirs(baseline, dir);
      } catch (e) { console.warn(`! baseline compare failed: ${e.message}`); }
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
  const record = readRun(harnessDir);
  if (record.schema !== 2) fail(`${harnessDir}: schema ${record.schema ?? 1} runs have no bundles to re-verify`);
  if (trialId && !record.trials.some((t) => t.id === trialId)) fail(`no trial ${trialId} in ${harnessDir}`);
  const image = buildTaskImage({ config });
  const staged = stageClaude(`verify-${timestamp()}`);
  try {
    const verified = new Map();
    for (const t of record.trials) {
      if (trialId && t.id !== trialId) continue;
      const ev = path.join(harnessDir, 'evidence', t.id);
      const bundle = path.join(ev, 'pr-head.bundle');
      if (!existsSync(bundle)) { console.log(`- ${t.id}: no bundle (no PR head), kept as is`); continue; }
      console.log(`▶ verify ${t.id}`);
      const pv = postVerifyTrial(bundle, ev, staged.env, image);
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
    writeRun(harnessDir, { ...record, calibration: calibration(), trials, summary: summarizeTrials(trials),
      fingerprint: { ...record.fingerprint, verifierHash: hash,
        models: { ...record.fingerprint.models, verifier: config.verifier.model, review: config.review.model } } });
    writeSummary(path.dirname(harnessDir));
    reportLeaks(harnessDir, staged.values);
    console.log(`verified: ${harnessDir}`);
  } finally {
    staged.cleanup();
  }
}

// Judges the known patch variants (e2e/tasks/<task>/calibration) and compares with expected.json.
async function calibrate() {
  const runs = Number(opts.runs ?? 2);
  const calDir = path.join(task, 'calibration');
  const expected = JSON.parse(readFileSync(path.join(calDir, 'expected.json'), 'utf8'));
  const spec = readFileSync(path.join(calDir, 'spec.md'), 'utf8');
  const summary = readFileSync(path.join(calDir, 'summary.md'), 'utf8');
  const image = buildTaskImage({ config });
  const ts = timestamp();
  const staged = stageClaude(`calibrate-${ts}`);
  const work = mkdtempSync(path.join(tmpdir(), 'adw-calibrate-'));
  try {
    const bundles = Object.fromEntries(Object.keys(expected).map((variant) => {
      const out = path.join(work, `${variant}.bundle`);
      createCalibrationBundle({ root: config.root, seedRepo: demoRepo, patch: path.join(calDir, `${variant}.patch`), out });
      return [variant, out];
    }));
    const results = Object.fromEntries(Object.keys(expected).map((v) => [v, []]));
    for (let i = 1; i <= runs; i++) {
      for (const [variant, bundle] of Object.entries(bundles)) {
        console.log(`▶ ${variant} (run ${i}/${runs})`);
        const pv = postVerify({ config, bundle, criteria, spec, summary, env: staged.env, image });
        if (isQuota(pv.verifierError) || isQuota(pv.reviewError)) {
          console.error('✗ subscription usage limit reached: calibration aborted, nothing written');
          process.exitCode = 1;
          return;
        }
        results[variant].push(pv);
        console.log(`  ${acLine(pv)}${pv.verifierError ? ` · verifier: ${pv.verifierError}` : ''}${pv.reviewError ? ` · review: ${pv.reviewError}` : ''}`);
      }
    }
    const evaluation = evaluateCalibration({ expected, results, criteria, rubric: config.review.criteria });
    const cal = { schema: 1, ts, hash, pass: evaluation.pass, runs, models: { verifier: config.verifier.model, review: config.review.model },
      findings: evaluation.findings, reviewMedians: evaluation.reviewMedians, variants: results };
    const out = path.join(calibrationDir, ts);
    writeResult(path.join(out, 'calibration.json'), `${JSON.stringify(cal, null, 2)}\n`);
    writeResult(path.join(out, 'report.md'), renderCalibrationReport(cal));
    reportLeaks(out, staged.values);
    console.log(`calibration ${cal.pass ? 'passed' : 'FAILED'}: ${out}`);
    if (!cal.pass) process.exitCode = 1;
  } finally {
    staged.cleanup();
    rmSync(work, { recursive: true, force: true });
  }
}

if (command === 'preflight') process.exit(preflight() ? 0 : 1);
else if (command === 'run') await run();
else if (command === 'verify' && rest.length === 1) await verify(path.resolve(rest[0]), opts.trial);
else if (command === 'calibrate' && rest.length === 0) await calibrate();
else if (command === 'compare' && rest.length === 2) compareDirs(path.resolve(rest[0]), path.resolve(rest[1]));
else if (command === 'report' && rest.length === 1) {
  const r = JSON.parse(readFileSync(path.join(rest[0], 'run.json'), 'utf8'));
  writeFileSync(path.join(rest[0], 'report.md'), renderRunReport(r));
} else {
  console.error('usage: node e2e/run.mjs preflight | run [--harness h]... [--repetitions n] | verify <harnessDir> [--trial id] | calibrate [--runs n] | compare <baseDir> <candDir> | report <harnessDir>');
  process.exit(2);
}
```

- [ ] **Step 2: Smoke-test the CLI without any LLM call**

Run each of these and compare with the expected output:

| Command | Expected |
|---|---|
| `node e2e/run.mjs` | the usage line; `echo $?` prints `2` |
| `node e2e/run.mjs calibrate --runs 0` | `✗ --runs must be a positive integer, got "0"` |
| `node e2e/run.mjs verify docs/adw-e2e/2026-10-11T1945Z/claude-code` | `✗ …: schema 1 runs have no bundles to re-verify` (exit 2, nothing built or staged) |
| `node e2e/run.mjs compare docs/adw-e2e/2026-10-11T1903Z/opencode docs/adw-e2e/2026-10-11T1945Z/claude-code` | `✗ …: schema 1 runs cannot be compared …` |

- [ ] **Step 3: Check the verifier container plumbing without any LLM call.** Build the task image, then start one container exactly as `runVerifier` does, but run a shell instead of `claude -p`. This proves three things: the seed hook does not wait for Gitea, the mount is owned correctly, and the tools exist.

```bash
node --input-type=module -e 'const { buildTaskImage } = await import(process.cwd() + "/e2e/lib/postverify.mjs"); const { loadConfig } = await import(process.cwd() + "/e2e/lib/config.mjs"); console.log(buildTaskImage({ config: loadConfig() }));'
S=$(mktemp -d)
node --input-type=module -e '
const { createCalibrationBundle, checkoutBundle } = await import(process.cwd() + "/e2e/lib/bundle.mjs");
const root = process.cwd(); const dir = process.argv[1];
createCalibrationBundle({ root, seedRepo: root + "/e2e/tasks/demo-todo/environment/seed/repo", patch: root + "/e2e/tasks/demo-todo/calibration/reference.patch", out: dir + "/r.bundle" });
checkoutBundle(dir + "/r.bundle", dir + "/co");' "$S"
timeout 120 docker run --rm --name adw-plumb -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" -e E2E_VERIFY=1 -e AGENT_TOOLSTACK_ONLY=1 \
  -v "$S/co:/workspace" adw-e2e-demo-todo \
  bash -c 'git log --oneline -1 && git diff --stat origin/main...HEAD | tail -1 && command -v playwright-mcp claude && touch /workspace/.probe && id -u'
docker rm -f adw-plumb >/dev/null 2>&1   # timeout ends only the docker client, never the container
ls -ln "$S/co/.probe"
```

Expected:
- `adw-e2e-demo-todo` is printed.
- The container prints the `Calibration variant` commit, `5 files changed, 111 insertions(+), 18 deletions(-)`, the paths of `playwright-mcp` and `claude`, and your uid within seconds.
- If it hangs until `timeout`, the seed guard from Task 9 is missing from the image: the hook waits for Gitea forever.
- If it fails with `ai-project.json is required`, `AGENT_TOOLSTACK_ONLY=1` is missing.
- `.probe` is owned by your uid.

- [ ] **Step 4: Delete the schema-1 baseline and update the docs**

```bash
git rm -r -q docs/adw-e2e/2026-10-11T1903Z docs/adw-e2e/2026-10-11T1945Z
```

Leave the untracked `docs/adw-e2e/2026-10-11T1021Z/` untouched. It belongs to the user.

In `docs/adw-e2e/README.md`:

1. Line 5: append `Agentic verification: docs/superpowers/specs/2026-10-12-adw-e2e-agentic-verification-design.md.`
2. In **Run**, after the `compare` line, add:
   ```
       node e2e/run.mjs verify docs/adw-e2e/<ts>/<harness> [--trial <id>]   # re-judge stored PR heads, no agent run
       node e2e/run.mjs calibrate [--runs 2]       # judge the known variants; needed after any verifier change
   ```
3. Replace the paragraph starting `The simulated user, the judge and the claude-code harness` with:
   > The simulated user, the E2E verifier, the review judge and the claude-code harness all draw on the one Claude subscription. Each trial adds two Sonnet runs (verifier and review); a calibration adds 20. A full run can exhaust the subscription's 5-hour limit: split it per harness across limit windows. The codex harness draws on the ChatGPT subscription's limit the same way. A trial that hits either limit (`quota` error class) aborts the run; the partial result is marked `aborted` and is never used as a baseline. Delete it and rerun after the reset. A `verify` or `calibrate` that hits a limit writes nothing.
4. In **Read the results**:
   - Change the `run.json` item to `fingerprint (incl. verifier hash and role models), calibration, per-trial checks, acceptance criteria, metrics and review, plus the summary`.
   - Change the `evidence` item to `` `evidence/<trial>/`: ticket comments, PR diff, own test output, `pr-head.bundle` (the PR head, re-verifiable), `acceptance.json` (per-criterion verdicts with evidence), `review.json` (scores and reasons) ``.
   - Add `` `docs/adw-e2e/calibration/<ts>/`: calibration verdicts (`report.md`, `calibration.json`) ``.
5. Replace the signals table rows with:
   ```
   | reward | All contract checks, own tests (`TEST_COMMAND`) and every acceptance criterion passed; `—` when the verifier could not judge |
   | contract | Share of contract checks passed (ticket edges, naming, draft PR, e2e via Playwright, app stopped, no screenshots in the repo) |
   | acceptance / `ac:ACn` | Share of acceptance criteria an agentic verifier observed in the running app, and the pass rate per criterion (`e2e/tasks/<task>/acceptance-criteria.md`) |
   | review | 1–5 per criterion from a code review with read access to the repo: requirements, scope, tests, conventions, architecture, code quality |
   | tokens | Target agent only, from its own session logs (cross-checked with ccusage) |
   ```
   Below the table add:
   > A report that says **Verifier not calibrated** has no passing calibration for its verifier hash (prompts, verifier/review models, review criteria, acceptance criteria). Run `calibrate` before trusting acceptance and review.
6. In **Changing the test**, replace the hidden-tests bullet with:
   ```
   - Acceptance criteria (`acceptance-criteria.md`) describe observable behaviour only: no endpoints, parameters or field names, and only what the briefing (`instruction.md`) actively communicates or what follows unambiguously from the ticket.
   - Any change to the criteria, the verifier or review prompt, their models or `review.criteria` changes the verifier hash: run `calibrate`, and keep the calibration variants (`calibration/*.patch`, `expected.json`) in step with the criteria.
   ```

In `AGENTS.md` (section "E2E self-test"), after the sentence ending `results land in docs/adw-e2e/<ts>/.`, insert:

> An agentic verifier judges each trial's PR head against `acceptance-criteria.md`, and a review judge with read access scores the code; `node e2e/run.mjs calibrate` checks both on known variants.

- [ ] **Step 5: Run the full suite, check the tree and commit**

Run: `npm test`
Expected: PASS.

Run: `git status --short`
Expected: only this task's files. `spike/`, `docs/adw-e2e/2026-10-11T1021Z/` and `docker/tests/fixtures/*/obj/` stay untracked and are not added.

```bash
git add e2e/run.mjs docs/adw-e2e/README.md AGENTS.md
git commit -m "feat(e2e): post-verify every trial; verify and calibrate commands"
```

(The `git rm` from Step 4 is already staged and goes into the same commit.)

---

### Task 12: Live acceptance (only with the user's consent)

These steps use the Claude subscription. **Stop and ask the user before each live step.** Name the expected cost:
- calibrate: about 20 Sonnet runs;
- one claude-code trial: one Opus agent run, a Haiku user, and 2 Sonnet runs;
- verify: 2 Sonnet runs.

- [ ] **Step 1: Ask the user to approve `node e2e/run.mjs calibrate`.** After approval, run it.
  - Expected: `calibration passed: docs/adw-e2e/calibration/<ts>`.
  - On `wrong` or `flaky`, read `report.md` and the `evidence` in `calibration.json`, and debug with superpowers:systematic-debugging. A prompt fix changes the verifier hash, so recalibrate (ask again).
  - Commit the passing calibration directory:

```bash
git add docs/adw-e2e/calibration/<ts>
git commit -m "test(e2e): verifier calibration"
```

- [ ] **Step 2: Ask the user to approve `node e2e/run.mjs run --harness claude-code --repetitions 1`.** After approval, run it. Check:
  - `evidence/claude-code-1/acceptance.json` holds 7 verdicts with concrete evidence;
  - `review.json` holds 6 scores with reasons;
  - `report.md` shows `Verifier calibration: \`<ts>\``.

- [ ] **Step 3: Ask the user to approve `node e2e/run.mjs verify docs/adw-e2e/<ts>/claude-code`.** After approval, run it.
  - Expected: the same per-AC verdicts as in Step 2.
  - If a verdict differs, report it as verifier variance with both evidence texts. Do not paper over it.

- [ ] **Step 4: Report to the user.** Include:
  - the calibration result;
  - the trial's verdicts;
  - whether `verify` reproduced them;
  - the open next step: the user measures the new baseline (3 trials per harness, including codex), split across limit windows.

  Ask whether to commit the trial result and whether to push to PR #56.

---

## Appendix A: calibration patches (verbatim)

Each patch applies to the tracked seed files (`e2e/tasks/demo-todo/environment/seed/repo`) with `git apply`.

### `e2e/tasks/demo-todo/calibration/reference.patch`

````diff
diff --git a/public/index.html b/public/index.html
index de8f94a..7db0ce5 100644
--- a/public/index.html
+++ b/public/index.html
@@ -3,19 +3,38 @@
 <head><meta charset="utf-8"><title>demo-todo</title></head>
 <body>
   <h1>Todos</h1>
+  <label><input type="checkbox" data-testid="overdue-filter"> nur überfällige</label>
   <ul data-testid="todo-list"></ul>
   <script type="module">
     const list = document.querySelector('[data-testid="todo-list"]');
+    const filter = document.querySelector('[data-testid="overdue-filter"]');
     const todos = await (await fetch('/todos')).json();
-    for (const todo of todos) {
-      const li = document.createElement('li');
-      li.dataset.testid = 'todo-item';
-      const title = document.createElement('span');
-      title.dataset.testid = 'todo-title';
-      title.textContent = todo.title + (todo.done ? ' ✓' : '');
-      li.append(title);
-      list.append(li);
+    function render() {
+      list.replaceChildren();
+      for (const todo of todos.filter((t) => !filter.checked || t.overdue)) {
+        const li = document.createElement('li');
+        li.dataset.testid = 'todo-item';
+        const title = document.createElement('span');
+        title.dataset.testid = 'todo-title';
+        title.textContent = todo.title + (todo.done ? ' ✓' : '');
+        li.append(title);
+        if (todo.dueDate) {
+          const due = document.createElement('span');
+          due.dataset.testid = 'todo-due';
+          due.textContent = ` ${todo.dueDate}`;
+          li.append(due);
+        }
+        if (todo.overdue) {
+          const mark = document.createElement('strong');
+          mark.dataset.testid = 'todo-overdue';
+          mark.textContent = ' überfällig';
+          li.append(mark);
+        }
+        list.append(li);
+      }
     }
+    filter.addEventListener('change', render);
+    render();
   </script>
 </body>
 </html>
diff --git a/src/app.mjs b/src/app.mjs
index 9db56cc..c925e07 100644
--- a/src/app.mjs
+++ b/src/app.mjs
@@ -15,7 +15,9 @@ export function createApp(store = createStore()) {
         return res.end(await readFile(new URL('../public/index.html', import.meta.url)));
       }
       if (url.pathname === '/health') return send(200, { ok: true });
-      if (url.pathname === '/todos' && req.method === 'GET') return send(200, store.list());
+      if (url.pathname === '/todos' && req.method === 'GET') {
+        return send(200, store.list({ overdue: url.searchParams.get('overdue') === 'true' }));
+      }
       if (url.pathname === '/todos' && req.method === 'POST') {
         return send(201, store.add(await readJson(req)));
       }
diff --git a/src/store.mjs b/src/store.mjs
index 3caed3c..d1529ac 100644
--- a/src/store.mjs
+++ b/src/store.mjs
@@ -1,21 +1,24 @@
 // In-memory todo store.
-export function createStore() {
+export function createStore({ today = () => new Date().toISOString().slice(0, 10) } = {}) {
   const todos = new Map();
   let nextId = 1;
+  const view = (todo) => ({ ...todo, overdue: isOverdue(todo, today()) });
   return {
-    list() {
-      return [...todos.values()];
+    list({ overdue = false } = {}) {
+      const all = [...todos.values()].map(view);
+      return overdue ? all.filter((todo) => todo.overdue) : all;
     },
     get(id) {
-      return todos.get(id);
+      const todo = todos.get(id);
+      return todo && view(todo);
     },
-    add({ title }) {
+    add({ title, dueDate = null }) {
       if (typeof title !== 'string' || title.trim() === '') {
         throw new ValidationError('title is required');
       }
-      const todo = { id: nextId++, title: title.trim(), done: false };
+      const todo = { id: nextId++, title: title.trim(), done: false, dueDate: parseDueDate(dueDate) };
       todos.set(todo.id, todo);
-      return todo;
+      return view(todo);
     },
     update(id, patch) {
       const todo = todos.get(id);
@@ -30,7 +33,8 @@ export function createStore() {
         if (typeof patch.done !== 'boolean') throw new ValidationError('done must be a boolean');
         todo.done = patch.done;
       }
-      return todo;
+      if ('dueDate' in patch) todo.dueDate = parseDueDate(patch.dueDate);
+      return view(todo);
     },
     remove(id) {
       return todos.delete(id);
@@ -38,4 +42,22 @@ export function createStore() {
   };
 }
 
+// A due date is a calendar date (YYYY-MM-DD) or null.
+export function parseDueDate(value) {
+  if (value === null) return null;
+  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
+    throw new ValidationError('dueDate must be a date in the form YYYY-MM-DD, or null');
+  }
+  const date = new Date(`${value}T00:00:00Z`);
+  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
+    throw new ValidationError('dueDate is not a valid calendar date');
+  }
+  return value;
+}
+
+// Overdue: not done and due before today (both YYYY-MM-DD, so they compare as strings).
+export function isOverdue(todo, today) {
+  return !todo.done && todo.dueDate !== null && todo.dueDate < today;
+}
+
 export class ValidationError extends Error {}
diff --git a/test/app.test.mjs b/test/app.test.mjs
index 2ce65b0..e2076ee 100644
--- a/test/app.test.mjs
+++ b/test/app.test.mjs
@@ -25,7 +25,7 @@ test('creates and lists todos', () =>
     const created = await fetch(`${base}/todos`, json('POST', { title: 'Milch kaufen' }));
     assert.equal(created.status, 201);
     const list = await (await fetch(`${base}/todos`)).json();
-    assert.deepEqual(list, [{ id: 1, title: 'Milch kaufen', done: false }]);
+    assert.deepEqual(list, [{ id: 1, title: 'Milch kaufen', done: false, dueDate: null, overdue: false }]);
   }));
 
 test('rejects an empty title', () =>
@@ -47,3 +47,17 @@ test('serves the list page', () =>
     assert.equal(res.status, 200);
     assert.match(await res.text(), /data-testid="todo-list"/);
   }));
+
+test('rejects an invalid due date', () =>
+  withServer(async (base) => {
+    const res = await fetch(`${base}/todos`, json('POST', { title: 'A', dueDate: '2026-02-30' }));
+    assert.equal(res.status, 400);
+  }));
+
+test('lists only overdue todos with ?overdue=true', () =>
+  withServer(async (base) => {
+    await fetch(`${base}/todos`, json('POST', { title: 'late', dueDate: '2000-01-01' }));
+    await fetch(`${base}/todos`, json('POST', { title: 'later', dueDate: '2999-01-01' }));
+    const list = await (await fetch(`${base}/todos?overdue=true`)).json();
+    assert.deepEqual(list.map((t) => t.title), ['late']);
+  }));
diff --git a/test/due-date.test.mjs b/test/due-date.test.mjs
new file mode 100644
index 0000000..9237b5c
--- /dev/null
+++ b/test/due-date.test.mjs
@@ -0,0 +1,36 @@
+import { test } from 'node:test';
+import assert from 'node:assert/strict';
+import { createStore, ValidationError } from '../src/store.mjs';
+
+const store = () => createStore({ today: () => '2026-05-10' });
+
+test('a todo gets an optional due date', () => {
+  const s = store();
+  assert.equal(s.add({ title: 'A' }).dueDate, null);
+  assert.equal(s.add({ title: 'B', dueDate: '2026-05-20' }).dueDate, '2026-05-20');
+});
+
+test('the due date can be changed and cleared', () => {
+  const s = store();
+  const { id } = s.add({ title: 'A', dueDate: '2026-05-20' });
+  assert.equal(s.update(id, { dueDate: '2026-06-01' }).dueDate, '2026-06-01');
+  assert.equal(s.update(id, { dueDate: null }).dueDate, null);
+});
+
+test('rejects malformed and impossible due dates', () => {
+  const s = store();
+  for (const dueDate of ['2026-02-30', '10.05.2026', '2026-5-1', '2026-05-10T12:00:00Z', 20260510]) {
+    assert.throws(() => s.add({ title: 'A', dueDate }), ValidationError, String(dueDate));
+  }
+});
+
+test('overdue means not done and due before today', () => {
+  const s = store();
+  s.add({ title: 'late', dueDate: '2026-05-09' });
+  const done = s.add({ title: 'late but done', dueDate: '2026-05-01' });
+  s.update(done.id, { done: true });
+  s.add({ title: 'today', dueDate: '2026-05-10' });
+  s.add({ title: 'no date' });
+  assert.deepEqual(s.list({ overdue: true }).map((t) => t.title), ['late']);
+  assert.deepEqual(s.list().map((t) => t.overdue), [true, false, false, false]);
+});
````

### `e2e/tasks/demo-todo/calibration/alt-interface.patch`

````diff
diff --git a/public/index.html b/public/index.html
index de8f94a..bf10c05 100644
--- a/public/index.html
+++ b/public/index.html
@@ -3,19 +3,37 @@
 <head><meta charset="utf-8"><title>demo-todo</title></head>
 <body>
   <h1>Todos</h1>
-  <ul data-testid="todo-list"></ul>
+  <button type="button" data-testid="only-overdue" aria-pressed="false">nur überfällige</button>
+  <table>
+    <thead><tr><th>Aufgabe</th><th>Fällig am</th><th>Status</th></tr></thead>
+    <tbody data-testid="todo-list"></tbody>
+  </table>
   <script type="module">
-    const list = document.querySelector('[data-testid="todo-list"]');
-    const todos = await (await fetch('/todos')).json();
-    for (const todo of todos) {
-      const li = document.createElement('li');
-      li.dataset.testid = 'todo-item';
-      const title = document.createElement('span');
-      title.dataset.testid = 'todo-title';
-      title.textContent = todo.title + (todo.done ? ' ✓' : '');
-      li.append(title);
-      list.append(li);
+    const body = document.querySelector('[data-testid="todo-list"]');
+    const toggle = document.querySelector('[data-testid="only-overdue"]');
+    const german = (iso) => iso.split('-').reverse().join('.');
+    const cell = (text, testid) => {
+      const td = document.createElement('td');
+      if (testid) td.dataset.testid = testid;
+      td.textContent = text;
+      return td;
+    };
+    async function load() {
+      const onlyOverdue = toggle.getAttribute('aria-pressed') === 'true';
+      const todos = await (await fetch(onlyOverdue ? '/todos?overdue=1' : '/todos')).json();
+      body.replaceChildren(...todos.map((todo) => {
+        const tr = document.createElement('tr');
+        tr.dataset.testid = 'todo-item';
+        tr.append(cell(todo.title + (todo.done ? ' ✓' : ''), 'todo-title'), cell(todo.due ? german(todo.due) : '', 'todo-due'),
+          cell(todo.isOverdue ? 'überfällig' : '', 'todo-status'));
+        return tr;
+      }));
     }
+    toggle.addEventListener('click', () => {
+      toggle.setAttribute('aria-pressed', String(toggle.getAttribute('aria-pressed') !== 'true'));
+      load();
+    });
+    load();
   </script>
 </body>
 </html>
diff --git a/src/app.mjs b/src/app.mjs
index 9db56cc..033582f 100644
--- a/src/app.mjs
+++ b/src/app.mjs
@@ -15,7 +15,9 @@ export function createApp(store = createStore()) {
         return res.end(await readFile(new URL('../public/index.html', import.meta.url)));
       }
       if (url.pathname === '/health') return send(200, { ok: true });
-      if (url.pathname === '/todos' && req.method === 'GET') return send(200, store.list());
+      if (url.pathname === '/todos' && req.method === 'GET') {
+        return send(200, store.list({ onlyOverdue: url.searchParams.get('overdue') === '1' }));
+      }
       if (url.pathname === '/todos' && req.method === 'POST') {
         return send(201, store.add(await readJson(req)));
       }
diff --git a/src/store.mjs b/src/store.mjs
index 3caed3c..b7886fe 100644
--- a/src/store.mjs
+++ b/src/store.mjs
@@ -1,21 +1,26 @@
 // In-memory todo store.
-export function createStore() {
+const todayUtc = () => new Date().toISOString().slice(0, 10);
+
+export function createStore({ clock = todayUtc } = {}) {
   const todos = new Map();
   let nextId = 1;
+  const withStatus = (todo) => ({ ...todo, isOverdue: !todo.done && todo.due !== null && todo.due < clock() });
   return {
-    list() {
-      return [...todos.values()];
+    list({ onlyOverdue = false } = {}) {
+      const all = [...todos.values()].map(withStatus);
+      return onlyOverdue ? all.filter((todo) => todo.isOverdue) : all;
     },
     get(id) {
-      return todos.get(id);
+      const todo = todos.get(id);
+      return todo && withStatus(todo);
     },
-    add({ title }) {
+    add({ title, due = null }) {
       if (typeof title !== 'string' || title.trim() === '') {
         throw new ValidationError('title is required');
       }
-      const todo = { id: nextId++, title: title.trim(), done: false };
+      const todo = { id: nextId++, title: title.trim(), done: false, due: checkDue(due) };
       todos.set(todo.id, todo);
-      return todo;
+      return withStatus(todo);
     },
     update(id, patch) {
       const todo = todos.get(id);
@@ -30,7 +35,8 @@ export function createStore() {
         if (typeof patch.done !== 'boolean') throw new ValidationError('done must be a boolean');
         todo.done = patch.done;
       }
-      return todo;
+      if ('due' in patch) todo.due = checkDue(patch.due);
+      return withStatus(todo);
     },
     remove(id) {
       return todos.delete(id);
@@ -38,4 +44,17 @@ export function createStore() {
   };
 }
 
+// `due` is an ISO calendar date without time, or null for "no due date".
+function checkDue(due) {
+  if (due === null) return null;
+  const m = typeof due === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(due) : null;
+  if (!m) throw new ValidationError('Fälligkeit muss ein Datum JJJJ-MM-TT sein');
+  const [y, mo, d] = m.slice(1).map(Number);
+  const date = new Date(Date.UTC(y, mo - 1, d));
+  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
+    throw new ValidationError('Fälligkeit ist kein gültiges Datum');
+  }
+  return due;
+}
+
 export class ValidationError extends Error {}
diff --git a/test/app.test.mjs b/test/app.test.mjs
index 2ce65b0..ba6fce8 100644
--- a/test/app.test.mjs
+++ b/test/app.test.mjs
@@ -25,7 +25,7 @@ test('creates and lists todos', () =>
     const created = await fetch(`${base}/todos`, json('POST', { title: 'Milch kaufen' }));
     assert.equal(created.status, 201);
     const list = await (await fetch(`${base}/todos`)).json();
-    assert.deepEqual(list, [{ id: 1, title: 'Milch kaufen', done: false }]);
+    assert.deepEqual(list, [{ id: 1, title: 'Milch kaufen', done: false, due: null, isOverdue: false }]);
   }));
 
 test('rejects an empty title', () =>
@@ -47,3 +47,18 @@ test('serves the list page', () =>
     assert.equal(res.status, 200);
     assert.match(await res.text(), /data-testid="todo-list"/);
   }));
+
+test('GET /todos?overdue=1 lists overdue todos only', () =>
+  withServer(async (base) => {
+    await fetch(`${base}/todos`, json('POST', { title: 'old', due: '2001-01-01' }));
+    await fetch(`${base}/todos`, json('POST', { title: 'new', due: '2999-01-01' }));
+    const res = await fetch(`${base}/todos?overdue=1`);
+    assert.deepEqual((await res.json()).map((t) => t.title), ['old']);
+  }));
+
+test('an impossible due date is a 400', () =>
+  withServer(async (base) => {
+    await fetch(`${base}/todos`, json('POST', { title: 'A' }));
+    const res = await fetch(`${base}/todos/1`, json('PATCH', { due: '2026-04-31' }));
+    assert.equal(res.status, 400);
+  }));
diff --git a/test/due-date.test.mjs b/test/due-date.test.mjs
new file mode 100644
index 0000000..fa40268
--- /dev/null
+++ b/test/due-date.test.mjs
@@ -0,0 +1,29 @@
+import { test } from 'node:test';
+import assert from 'node:assert/strict';
+import { createStore, ValidationError } from '../src/store.mjs';
+
+const at = (day) => createStore({ clock: () => day });
+
+test('due is optional, can be set, changed and removed', () => {
+  const s = at('2026-05-10');
+  assert.equal(s.add({ title: 'A' }).due, null);
+  const { id } = s.add({ title: 'B', due: '2026-05-20' });
+  assert.equal(s.update(id, { due: '2026-06-01' }).due, '2026-06-01');
+  assert.equal(s.update(id, { due: null }).due, null);
+});
+
+test('invalid due dates are validation errors', () => {
+  for (const due of ['2026-02-30', '01.05.2026', '2026-13-01', 5]) {
+    assert.throws(() => at('2026-05-10').add({ title: 'A', due }), ValidationError, String(due));
+  }
+});
+
+test('only open todos due before today are overdue', () => {
+  const s = at('2026-05-10');
+  s.add({ title: 'late', due: '2026-05-09' });
+  const done = s.add({ title: 'done', due: '2026-05-01' });
+  s.update(done.id, { done: true });
+  s.add({ title: 'today', due: '2026-05-10' });
+  s.add({ title: 'none' });
+  assert.deepEqual(s.list({ onlyOverdue: true }).map((t) => t.title), ['late']);
+});
````

### `e2e/tasks/demo-todo/calibration/broken-done.patch`

````diff
diff --git a/public/index.html b/public/index.html
index de8f94a..7db0ce5 100644
--- a/public/index.html
+++ b/public/index.html
@@ -3,19 +3,38 @@
 <head><meta charset="utf-8"><title>demo-todo</title></head>
 <body>
   <h1>Todos</h1>
+  <label><input type="checkbox" data-testid="overdue-filter"> nur überfällige</label>
   <ul data-testid="todo-list"></ul>
   <script type="module">
     const list = document.querySelector('[data-testid="todo-list"]');
+    const filter = document.querySelector('[data-testid="overdue-filter"]');
     const todos = await (await fetch('/todos')).json();
-    for (const todo of todos) {
-      const li = document.createElement('li');
-      li.dataset.testid = 'todo-item';
-      const title = document.createElement('span');
-      title.dataset.testid = 'todo-title';
-      title.textContent = todo.title + (todo.done ? ' ✓' : '');
-      li.append(title);
-      list.append(li);
+    function render() {
+      list.replaceChildren();
+      for (const todo of todos.filter((t) => !filter.checked || t.overdue)) {
+        const li = document.createElement('li');
+        li.dataset.testid = 'todo-item';
+        const title = document.createElement('span');
+        title.dataset.testid = 'todo-title';
+        title.textContent = todo.title + (todo.done ? ' ✓' : '');
+        li.append(title);
+        if (todo.dueDate) {
+          const due = document.createElement('span');
+          due.dataset.testid = 'todo-due';
+          due.textContent = ` ${todo.dueDate}`;
+          li.append(due);
+        }
+        if (todo.overdue) {
+          const mark = document.createElement('strong');
+          mark.dataset.testid = 'todo-overdue';
+          mark.textContent = ' überfällig';
+          li.append(mark);
+        }
+        list.append(li);
+      }
     }
+    filter.addEventListener('change', render);
+    render();
   </script>
 </body>
 </html>
diff --git a/src/app.mjs b/src/app.mjs
index 9db56cc..c925e07 100644
--- a/src/app.mjs
+++ b/src/app.mjs
@@ -15,7 +15,9 @@ export function createApp(store = createStore()) {
         return res.end(await readFile(new URL('../public/index.html', import.meta.url)));
       }
       if (url.pathname === '/health') return send(200, { ok: true });
-      if (url.pathname === '/todos' && req.method === 'GET') return send(200, store.list());
+      if (url.pathname === '/todos' && req.method === 'GET') {
+        return send(200, store.list({ overdue: url.searchParams.get('overdue') === 'true' }));
+      }
       if (url.pathname === '/todos' && req.method === 'POST') {
         return send(201, store.add(await readJson(req)));
       }
diff --git a/src/store.mjs b/src/store.mjs
index 3caed3c..bd3fda5 100644
--- a/src/store.mjs
+++ b/src/store.mjs
@@ -1,21 +1,24 @@
 // In-memory todo store.
-export function createStore() {
+export function createStore({ today = () => new Date().toISOString().slice(0, 10) } = {}) {
   const todos = new Map();
   let nextId = 1;
+  const view = (todo) => ({ ...todo, overdue: isOverdue(todo, today()) });
   return {
-    list() {
-      return [...todos.values()];
+    list({ overdue = false } = {}) {
+      const all = [...todos.values()].map(view);
+      return overdue ? all.filter((todo) => todo.dueDate !== null && todo.dueDate < today()) : all;
     },
     get(id) {
-      return todos.get(id);
+      const todo = todos.get(id);
+      return todo && view(todo);
     },
-    add({ title }) {
+    add({ title, dueDate = null }) {
       if (typeof title !== 'string' || title.trim() === '') {
         throw new ValidationError('title is required');
       }
-      const todo = { id: nextId++, title: title.trim(), done: false };
+      const todo = { id: nextId++, title: title.trim(), done: false, dueDate: parseDueDate(dueDate) };
       todos.set(todo.id, todo);
-      return todo;
+      return view(todo);
     },
     update(id, patch) {
       const todo = todos.get(id);
@@ -30,7 +33,8 @@ export function createStore() {
         if (typeof patch.done !== 'boolean') throw new ValidationError('done must be a boolean');
         todo.done = patch.done;
       }
-      return todo;
+      if ('dueDate' in patch) todo.dueDate = parseDueDate(patch.dueDate);
+      return view(todo);
     },
     remove(id) {
       return todos.delete(id);
@@ -38,4 +42,22 @@ export function createStore() {
   };
 }
 
+// A due date is a calendar date (YYYY-MM-DD) or null.
+export function parseDueDate(value) {
+  if (value === null) return null;
+  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
+    throw new ValidationError('dueDate must be a date in the form YYYY-MM-DD, or null');
+  }
+  const date = new Date(`${value}T00:00:00Z`);
+  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
+    throw new ValidationError('dueDate is not a valid calendar date');
+  }
+  return value;
+}
+
+// Overdue: not done and due before today (both YYYY-MM-DD, so they compare as strings).
+export function isOverdue(todo, today) {
+  return !todo.done && todo.dueDate !== null && todo.dueDate < today;
+}
+
 export class ValidationError extends Error {}
diff --git a/test/app.test.mjs b/test/app.test.mjs
index 2ce65b0..e2076ee 100644
--- a/test/app.test.mjs
+++ b/test/app.test.mjs
@@ -25,7 +25,7 @@ test('creates and lists todos', () =>
     const created = await fetch(`${base}/todos`, json('POST', { title: 'Milch kaufen' }));
     assert.equal(created.status, 201);
     const list = await (await fetch(`${base}/todos`)).json();
-    assert.deepEqual(list, [{ id: 1, title: 'Milch kaufen', done: false }]);
+    assert.deepEqual(list, [{ id: 1, title: 'Milch kaufen', done: false, dueDate: null, overdue: false }]);
   }));
 
 test('rejects an empty title', () =>
@@ -47,3 +47,17 @@ test('serves the list page', () =>
     assert.equal(res.status, 200);
     assert.match(await res.text(), /data-testid="todo-list"/);
   }));
+
+test('rejects an invalid due date', () =>
+  withServer(async (base) => {
+    const res = await fetch(`${base}/todos`, json('POST', { title: 'A', dueDate: '2026-02-30' }));
+    assert.equal(res.status, 400);
+  }));
+
+test('lists only overdue todos with ?overdue=true', () =>
+  withServer(async (base) => {
+    await fetch(`${base}/todos`, json('POST', { title: 'late', dueDate: '2000-01-01' }));
+    await fetch(`${base}/todos`, json('POST', { title: 'later', dueDate: '2999-01-01' }));
+    const list = await (await fetch(`${base}/todos?overdue=true`)).json();
+    assert.deepEqual(list.map((t) => t.title), ['late']);
+  }));
diff --git a/test/due-date.test.mjs b/test/due-date.test.mjs
new file mode 100644
index 0000000..bc5b049
--- /dev/null
+++ b/test/due-date.test.mjs
@@ -0,0 +1,34 @@
+import { test } from 'node:test';
+import assert from 'node:assert/strict';
+import { createStore, ValidationError } from '../src/store.mjs';
+
+const store = () => createStore({ today: () => '2026-05-10' });
+
+test('a todo gets an optional due date', () => {
+  const s = store();
+  assert.equal(s.add({ title: 'A' }).dueDate, null);
+  assert.equal(s.add({ title: 'B', dueDate: '2026-05-20' }).dueDate, '2026-05-20');
+});
+
+test('the due date can be changed and cleared', () => {
+  const s = store();
+  const { id } = s.add({ title: 'A', dueDate: '2026-05-20' });
+  assert.equal(s.update(id, { dueDate: '2026-06-01' }).dueDate, '2026-06-01');
+  assert.equal(s.update(id, { dueDate: null }).dueDate, null);
+});
+
+test('rejects malformed and impossible due dates', () => {
+  const s = store();
+  for (const dueDate of ['2026-02-30', '10.05.2026', '2026-5-1', '2026-05-10T12:00:00Z', 20260510]) {
+    assert.throws(() => s.add({ title: 'A', dueDate }), ValidationError, String(dueDate));
+  }
+});
+
+test('overdue means not done and due before today', () => {
+  const s = store();
+  s.add({ title: 'late', dueDate: '2026-05-09' });
+  s.add({ title: 'today', dueDate: '2026-05-10' });
+  s.add({ title: 'no date' });
+  assert.deepEqual(s.list({ overdue: true }).map((t) => t.title), ['late']);
+  assert.deepEqual(s.list().map((t) => t.overdue), [true, false, false]);
+});
````

### `e2e/tasks/demo-todo/calibration/broken-ui.patch`

````diff
diff --git a/public/index.html b/public/index.html
index de8f94a..9e5691a 100644
--- a/public/index.html
+++ b/public/index.html
@@ -14,6 +14,12 @@
       title.dataset.testid = 'todo-title';
       title.textContent = todo.title + (todo.done ? ' ✓' : '');
       li.append(title);
+      if (todo.dueDate) {
+        const due = document.createElement('span');
+        due.dataset.testid = 'todo-due';
+        due.textContent = ` ${todo.dueDate}`;
+        li.append(due);
+      }
       list.append(li);
     }
   </script>
diff --git a/src/app.mjs b/src/app.mjs
index 9db56cc..c925e07 100644
--- a/src/app.mjs
+++ b/src/app.mjs
@@ -15,7 +15,9 @@ export function createApp(store = createStore()) {
         return res.end(await readFile(new URL('../public/index.html', import.meta.url)));
       }
       if (url.pathname === '/health') return send(200, { ok: true });
-      if (url.pathname === '/todos' && req.method === 'GET') return send(200, store.list());
+      if (url.pathname === '/todos' && req.method === 'GET') {
+        return send(200, store.list({ overdue: url.searchParams.get('overdue') === 'true' }));
+      }
       if (url.pathname === '/todos' && req.method === 'POST') {
         return send(201, store.add(await readJson(req)));
       }
diff --git a/src/store.mjs b/src/store.mjs
index 3caed3c..d1529ac 100644
--- a/src/store.mjs
+++ b/src/store.mjs
@@ -1,21 +1,24 @@
 // In-memory todo store.
-export function createStore() {
+export function createStore({ today = () => new Date().toISOString().slice(0, 10) } = {}) {
   const todos = new Map();
   let nextId = 1;
+  const view = (todo) => ({ ...todo, overdue: isOverdue(todo, today()) });
   return {
-    list() {
-      return [...todos.values()];
+    list({ overdue = false } = {}) {
+      const all = [...todos.values()].map(view);
+      return overdue ? all.filter((todo) => todo.overdue) : all;
     },
     get(id) {
-      return todos.get(id);
+      const todo = todos.get(id);
+      return todo && view(todo);
     },
-    add({ title }) {
+    add({ title, dueDate = null }) {
       if (typeof title !== 'string' || title.trim() === '') {
         throw new ValidationError('title is required');
       }
-      const todo = { id: nextId++, title: title.trim(), done: false };
+      const todo = { id: nextId++, title: title.trim(), done: false, dueDate: parseDueDate(dueDate) };
       todos.set(todo.id, todo);
-      return todo;
+      return view(todo);
     },
     update(id, patch) {
       const todo = todos.get(id);
@@ -30,7 +33,8 @@ export function createStore() {
         if (typeof patch.done !== 'boolean') throw new ValidationError('done must be a boolean');
         todo.done = patch.done;
       }
-      return todo;
+      if ('dueDate' in patch) todo.dueDate = parseDueDate(patch.dueDate);
+      return view(todo);
     },
     remove(id) {
       return todos.delete(id);
@@ -38,4 +42,22 @@ export function createStore() {
   };
 }
 
+// A due date is a calendar date (YYYY-MM-DD) or null.
+export function parseDueDate(value) {
+  if (value === null) return null;
+  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
+    throw new ValidationError('dueDate must be a date in the form YYYY-MM-DD, or null');
+  }
+  const date = new Date(`${value}T00:00:00Z`);
+  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
+    throw new ValidationError('dueDate is not a valid calendar date');
+  }
+  return value;
+}
+
+// Overdue: not done and due before today (both YYYY-MM-DD, so they compare as strings).
+export function isOverdue(todo, today) {
+  return !todo.done && todo.dueDate !== null && todo.dueDate < today;
+}
+
 export class ValidationError extends Error {}
diff --git a/test/app.test.mjs b/test/app.test.mjs
index 2ce65b0..e2076ee 100644
--- a/test/app.test.mjs
+++ b/test/app.test.mjs
@@ -25,7 +25,7 @@ test('creates and lists todos', () =>
     const created = await fetch(`${base}/todos`, json('POST', { title: 'Milch kaufen' }));
     assert.equal(created.status, 201);
     const list = await (await fetch(`${base}/todos`)).json();
-    assert.deepEqual(list, [{ id: 1, title: 'Milch kaufen', done: false }]);
+    assert.deepEqual(list, [{ id: 1, title: 'Milch kaufen', done: false, dueDate: null, overdue: false }]);
   }));
 
 test('rejects an empty title', () =>
@@ -47,3 +47,17 @@ test('serves the list page', () =>
     assert.equal(res.status, 200);
     assert.match(await res.text(), /data-testid="todo-list"/);
   }));
+
+test('rejects an invalid due date', () =>
+  withServer(async (base) => {
+    const res = await fetch(`${base}/todos`, json('POST', { title: 'A', dueDate: '2026-02-30' }));
+    assert.equal(res.status, 400);
+  }));
+
+test('lists only overdue todos with ?overdue=true', () =>
+  withServer(async (base) => {
+    await fetch(`${base}/todos`, json('POST', { title: 'late', dueDate: '2000-01-01' }));
+    await fetch(`${base}/todos`, json('POST', { title: 'later', dueDate: '2999-01-01' }));
+    const list = await (await fetch(`${base}/todos?overdue=true`)).json();
+    assert.deepEqual(list.map((t) => t.title), ['late']);
+  }));
diff --git a/test/due-date.test.mjs b/test/due-date.test.mjs
new file mode 100644
index 0000000..9237b5c
--- /dev/null
+++ b/test/due-date.test.mjs
@@ -0,0 +1,36 @@
+import { test } from 'node:test';
+import assert from 'node:assert/strict';
+import { createStore, ValidationError } from '../src/store.mjs';
+
+const store = () => createStore({ today: () => '2026-05-10' });
+
+test('a todo gets an optional due date', () => {
+  const s = store();
+  assert.equal(s.add({ title: 'A' }).dueDate, null);
+  assert.equal(s.add({ title: 'B', dueDate: '2026-05-20' }).dueDate, '2026-05-20');
+});
+
+test('the due date can be changed and cleared', () => {
+  const s = store();
+  const { id } = s.add({ title: 'A', dueDate: '2026-05-20' });
+  assert.equal(s.update(id, { dueDate: '2026-06-01' }).dueDate, '2026-06-01');
+  assert.equal(s.update(id, { dueDate: null }).dueDate, null);
+});
+
+test('rejects malformed and impossible due dates', () => {
+  const s = store();
+  for (const dueDate of ['2026-02-30', '10.05.2026', '2026-5-1', '2026-05-10T12:00:00Z', 20260510]) {
+    assert.throws(() => s.add({ title: 'A', dueDate }), ValidationError, String(dueDate));
+  }
+});
+
+test('overdue means not done and due before today', () => {
+  const s = store();
+  s.add({ title: 'late', dueDate: '2026-05-09' });
+  const done = s.add({ title: 'late but done', dueDate: '2026-05-01' });
+  s.update(done.id, { done: true });
+  s.add({ title: 'today', dueDate: '2026-05-10' });
+  s.add({ title: 'no date' });
+  assert.deepEqual(s.list({ overdue: true }).map((t) => t.title), ['late']);
+  assert.deepEqual(s.list().map((t) => t.overdue), [true, false, false, false]);
+});
````

### `e2e/tasks/demo-todo/calibration/messy.patch`

````diff
diff --git a/public/index.html b/public/index.html
index de8f94a..7db0ce5 100644
--- a/public/index.html
+++ b/public/index.html
@@ -3,19 +3,38 @@
 <head><meta charset="utf-8"><title>demo-todo</title></head>
 <body>
   <h1>Todos</h1>
+  <label><input type="checkbox" data-testid="overdue-filter"> nur überfällige</label>
   <ul data-testid="todo-list"></ul>
   <script type="module">
     const list = document.querySelector('[data-testid="todo-list"]');
+    const filter = document.querySelector('[data-testid="overdue-filter"]');
     const todos = await (await fetch('/todos')).json();
-    for (const todo of todos) {
-      const li = document.createElement('li');
-      li.dataset.testid = 'todo-item';
-      const title = document.createElement('span');
-      title.dataset.testid = 'todo-title';
-      title.textContent = todo.title + (todo.done ? ' ✓' : '');
-      li.append(title);
-      list.append(li);
+    function render() {
+      list.replaceChildren();
+      for (const todo of todos.filter((t) => !filter.checked || t.overdue)) {
+        const li = document.createElement('li');
+        li.dataset.testid = 'todo-item';
+        const title = document.createElement('span');
+        title.dataset.testid = 'todo-title';
+        title.textContent = todo.title + (todo.done ? ' ✓' : '');
+        li.append(title);
+        if (todo.dueDate) {
+          const due = document.createElement('span');
+          due.dataset.testid = 'todo-due';
+          due.textContent = ` ${todo.dueDate}`;
+          li.append(due);
+        }
+        if (todo.overdue) {
+          const mark = document.createElement('strong');
+          mark.dataset.testid = 'todo-overdue';
+          mark.textContent = ' überfällig';
+          li.append(mark);
+        }
+        list.append(li);
+      }
     }
+    filter.addEventListener('change', render);
+    render();
   </script>
 </body>
 </html>
diff --git a/src/app.mjs b/src/app.mjs
index 9db56cc..7cd3860 100644
--- a/src/app.mjs
+++ b/src/app.mjs
@@ -15,9 +15,24 @@ export function createApp(store = createStore()) {
         return res.end(await readFile(new URL('../public/index.html', import.meta.url)));
       }
       if (url.pathname === '/health') return send(200, { ok: true });
-      if (url.pathname === '/todos' && req.method === 'GET') return send(200, store.list());
+      if (url.pathname === '/todos' && req.method === 'GET') {
+        let todos = store.list().map((t) => ({ ...t, dueDate: t.dueDate ?? null, overdue: !t.done && !!t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10) }));
+        if (url.searchParams.get('overdue') === 'true') {
+          const today = new Date().toISOString().slice(0, 10);
+          todos = todos.filter((t) => !t.done && t.dueDate && t.dueDate < today);
+        }
+        return send(200, todos);
+      }
       if (url.pathname === '/todos' && req.method === 'POST') {
-        return send(201, store.add(await readJson(req)));
+        const body = await readJson(req);
+        if (body.dueDate !== undefined && body.dueDate !== null) {
+          if (typeof body.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate) || isNaN(new Date(body.dueDate)) || new Date(body.dueDate).toISOString().slice(0, 10) !== body.dueDate) {
+            return send(400, { error: 'bad date' });
+          }
+        }
+        const todo = store.add(body);
+        todo.dueDate = body.dueDate ?? null;
+        return send(201, todo);
       }
       const match = url.pathname.match(/^\/todos\/(\d+)$/);
       if (match) {
@@ -27,7 +42,14 @@ export function createApp(store = createStore()) {
           return todo ? send(200, todo) : send(404, { error: 'not found' });
         }
         if (req.method === 'PATCH') {
-          const todo = store.update(id, await readJson(req));
+          const body = await readJson(req);
+          if (body.dueDate !== undefined && body.dueDate !== null) {
+            if (typeof body.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate) || isNaN(new Date(body.dueDate)) || new Date(body.dueDate).toISOString().slice(0, 10) !== body.dueDate) {
+              return send(400, { error: 'invalid date!!' });
+            }
+          }
+          const todo = store.update(id, body);
+          if (todo && 'dueDate' in body) todo.dueDate = body.dueDate;
           return todo ? send(200, todo) : send(404, { error: 'not found' });
         }
         if (req.method === 'DELETE') {
diff --git a/test/app.test.mjs b/test/app.test.mjs
index 2ce65b0..ced71a7 100644
--- a/test/app.test.mjs
+++ b/test/app.test.mjs
@@ -25,7 +25,7 @@ test('creates and lists todos', () =>
     const created = await fetch(`${base}/todos`, json('POST', { title: 'Milch kaufen' }));
     assert.equal(created.status, 201);
     const list = await (await fetch(`${base}/todos`)).json();
-    assert.deepEqual(list, [{ id: 1, title: 'Milch kaufen', done: false }]);
+    assert.equal(list[0].title, 'Milch kaufen');
   }));
 
 test('rejects an empty title', () =>
````

## Appendix B: throwaway oracle `check-variant.mjs` (not committed)

Runs inside `ai-dev-workflow-node:latest` with the variant checkout mounted at `/v`. Arguments: the due-date field name and the overdue query (`dueDate overdue=true`, or `due overdue=1` for alt-interface).

```js
// Throwaway: checks AC1-AC7 of one calibration variant mounted at /v. Args: field query
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire('/opt/agent-tools/node_modules/');
const { chromium } = require('playwright');
const [field, query] = process.argv.slice(2);
const base = 'http://127.0.0.1:3111';
const server = spawn('node', ['src/server.mjs'], { cwd: '/v', env: { ...process.env, PORT: '3111' }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { try { await fetch(`${base}/health`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
const req = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) }); return { status: r.status, body: await r.text() }; };
const res = {};
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
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(base + '/');
await page.waitForTimeout(500);
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
await browser.close();
server.kill();
console.log(JSON.stringify(res));
```
