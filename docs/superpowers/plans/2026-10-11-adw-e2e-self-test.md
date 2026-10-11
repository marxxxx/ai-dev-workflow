# ADW E2E Self-Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally triggered E2E self-test that runs the full `agent-dev` workflow in Claude
Code, Codex and OpenCode through Harbor against a demo repo plus a throwaway Gitea, scores every
trial, stores the results under `docs/adw-e2e/`, and compares two result sets.

**Architecture:**
- A zero-dependency Node CLI (`e2e/run.mjs`) orchestrates everything:
  1. a preflight;
  2. rendering of the demo repo's adw files with the generator;
  3. one `harbor run` per trial, using thin Python custom agents (subscription auth) and an
     ACP-bridged simulated user;
  4. host-side metrics from the native session logs, an LLM judge, a fingerprint, reports and
     compare.
- A Node verifier inside the task container checks `agent-dev`'s contract against the Gitea API and
  runs the hidden API and UI acceptance tests.

**Tech Stack:**
- Node ≥ 24, builtins only (`node:test`, `node:sqlite`, `node:child_process`).
- Harbor 0.24.0 as an external CLI (`uv tool`).
- Python only for the Harbor agent subclasses.
- Docker Compose (Gitea 1.24 sidecar).
- Playwright from the existing image.

**Spec:** `docs/superpowers/specs/2026-10-11-adw-e2e-self-test-design.md`. Background:
`docs/superpowers/specs/2026-10-10-adw-e2e-spike-findings.md`. The throwaway spike code in
`spike/` (untracked) is the working reference for every container-side piece.

## Global Constraints

- Zero npm runtime dependencies. Everything under `e2e/` uses Node builtins only. Python appears only
  in `e2e/agents/`.
- Nothing under `e2e/` ships in the npm package. `package.json` `files` stays unchanged, and
  `npm pack --dry-run` must list no `e2e/` path.
- LF line endings everywhere.
- Never hand-edit generated files. The demo repo's adw files are rendered by
  `node agent-src/generate.mjs generate --root <demo repo>` at run time and are git-ignored.
- The product image is unchanged. E2E-only additions (`tea` 0.15.1, `acpx` 0.11.2,
  `@zed-industries/claude-code-acp` 0.16.2, `@agentclientprotocol/codex-acp` 1.12.0, agent-user
  write access to the global npm prefix) go in the task Dockerfile only. **This refines the spec's
  "image changes via inventory.json"; Task 15 updates the spec.**
- Harness versions come from `docker/tools/inventory.json` `npmPackages` (single source). Nothing
  else pins them.
- Standard configuration (from the spec, verbatim):

  | Role | Setting |
  |---|---|
  | Claude Code | `claude-opus-5-5`, subagents `claude-sonnet-5-5` |
  | Codex | `openai/gpt-6.1-sol`, reasoning `high` |
  | OpenCode | `mistral/mistral-large-4` |
  | Simulated user | `claude-haiku-4-5-20251001` |
  | Judge | `claude-opus-5-5` |
  | Repetitions | 3 |
  | Harbor | `0.24.0` |

- **Coupling rule.** Checks cover only `agent-dev`'s contract, observable outcomes and outcome-based
  judging. Never assert on superpowers internals (path classification, worktrees, TDD order, review
  steps, internal skill names). "Superpowers active" is a soft, unscored signal.
- Secrets never land in git or in `docs/adw-e2e/`. Auth copies live under `e2e/jobs/.secrets/`
  (git-ignored, 0600) and are deleted after the invocation. The host's own `~/.codex/auth.json` and
  `~/.local/share/opencode/auth.json` are only read, never written.
- Harness ids are exactly `claude-code`, `codex`, `opencode`. The timestamp directory format is
  `YYYY-MM-DDTHHMMZ` (UTC).
- Tests use `import { test } from 'node:test'` and `import assert from 'node:assert/strict'`, with
  try/finally cleanup and no describe blocks (repo style). TDD applies to logic; prose and config
  files get no tests.

---

## File structure

```
e2e/
  .gitignore                        # jobs/, .env, rendered adw files in the demo repo
  config.json                       # standard configuration, thresholds, rubric, paths
  run.mjs                           # CLI: preflight | run | compare | report
  lib/
    config.mjs        (+test)       # loadConfig(), configHash(), harnessVersion()
    fsutil.mjs                      # readJsonl(), sha256File(), sha256Dir(), walk()
    metrics.mjs       (+test)       # tokens/durations/errors/e2e/soft signals per harness
    ccusage.mjs       (+test)       # isolated ccusage cross-check
    fingerprint.mjs   (+test)       # buildFingerprint(), diffFingerprints()
    judge.mjs         (+test)       # buildJudgePrompt(), parseJudgeOutput(), runJudge()
    trial.mjs         (+test)       # buildTrialRecord()
    summary.mjs       (+test)       # summarizeTrials(), median()
    compare.mjs       (+test)       # compareRuns(), findBaseline()
    report.mjs        (+test)       # renderRunReport(), renderSummary(), renderCompare()
    secrets.mjs       (+test)       # stageSecrets(), scanForSecrets()
    harbor.mjs        (+test)       # buildHarborArgs(), runHarbor(), cleanupCompose()
    preflight.mjs     (+test)       # runPreflight()
    fixtures/                       # trimmed spike session/rollout/result samples
  agents/
    __init__.py
    claude_subscription.py
    codex_subscription.py
    opencode_subscription.py
  tasks/demo-todo/
    task.toml  instruction.md  persona.md  bridge-prompt.md
    environment/
      Dockerfile  docker-compose.yaml  gitea-init.sh
      seed/seed.sh  seed/issue.md  seed/answers.json
      seed/repo/                    # demo app source (generated adw files ignored)
    tests/
      test.sh  verify.mjs  checks.mjs  checks.test.mjs
      acceptance.test.mjs  acceptance-ui.mjs
  jobs/                             # git-ignored Harbor output + .secrets/
docs/adw-e2e/README.md              # how to run, read and compare results
```

`package.json` `scripts.test` is extended to include `e2e/lib/*.test.mjs` and
`e2e/tasks/demo-todo/tests/*.test.mjs`, so CI runs them. They need no credentials.

---

### Task 1: Scaffold, config and shared fs helpers

**Files:**
- Create: `e2e/.gitignore`, `e2e/config.json`, `e2e/lib/fsutil.mjs`, `e2e/lib/config.mjs`, `e2e/lib/config.test.mjs`
**Interfaces:**
- Produces:
  - `loadConfig(path?: string) => Config`, where `Config` is the parsed `e2e/config.json` with an
    added `root` (absolute repo root).
  - `configHash(config) => string`: sha256 of the canonical JSON, without `root`.
  - `harnessVersion(harnessId, inventoryPath?) => string`.
  - `readJsonl(file) => object[]`: invalid lines are skipped.
  - `sha256File(file) => string`.
  - `sha256Dir(dir, {exclude?: RegExp}) => string`: sorted relative paths plus contents.
  - `walk(dir) => string[]`: absolute file paths.

- [ ] **Step 1: Create `e2e/.gitignore`**

```gitignore
jobs/
.env
tasks/demo-todo/environment/seed/repo/.claude/
tasks/demo-todo/environment/seed/repo/.agents/
tasks/demo-todo/environment/seed/repo/.opencode/
tasks/demo-todo/environment/seed/repo/.mcp.json
tasks/demo-todo/environment/seed/repo/.codex/
tasks/demo-todo/environment/seed/repo/ai-project.json
```

- [ ] **Step 2: Create `e2e/config.json`**

```json
{
  "schema": 1,
  "harbor": { "version": "0.24.0" },
  "task": "tasks/demo-todo",
  "repetitions": 3,
  "agentTimeoutSec": 1800,
  "app": { "port": 3000 },
  "harnesses": {
    "claude-code": {
      "agent": "agents.claude_subscription:ClaudeSubscription",
      "inventoryPackage": "@anthropic-ai/claude-code",
      "model": "claude-opus-5-5",
      "subagentModel": "claude-sonnet-5-5",
      "agentKwargs": { "max_budget_usd": "20" }
    },
    "codex": {
      "agent": "agents.codex_subscription:CodexSubscription",
      "inventoryPackage": "@openai/codex",
      "model": "openai/gpt-6.1-sol",
      "agentKwargs": { "reasoning_effort": "high" }
    },
    "opencode": {
      "agent": "agents.opencode_subscription:OpenCodeSubscription",
      "inventoryPackage": "opencode-ai",
      "model": "mistral/mistral-large-4",
      "agentKwargs": {}
    }
  },
  "simulatedUser": {
    "agent": "claude-code",
    "model": "claude-haiku-4-5-20251001",
    "disallowedTools": "Skill,Edit,Write,NotebookEdit,Task",
    "appendSystemPrompt": "You are only the human user. You never do the engineering work yourself: no skills, no ticket commands, no code edits. Your only channel to the coding agent is acpx prompt."
  },
  "judge": {
    "model": "claude-opus-5-5",
    "criteria": {
      "requirements": "Did the posted spec and the diff capture every requirement of the briefing? (measures interview quality by its outcome)",
      "scope": "No unrequested features or unrelated changes?",
      "tests": "Do the agent's own tests meaningfully cover the new behaviour?",
      "readability": "Clear, idiomatic, consistent with the repo's conventions?"
    }
  },
  "thresholds": { "tokensMedianRise": 0.5, "agentTimeMedianRise": 0.5, "judgeMedianDrop": 1 },
  "auth": {
    "claudeEnvFile": "e2e/.env",
    "codexAuthJson": "~/.codex/auth.json",
    "opencodeAuthJson": "~/.local/share/opencode/auth.json"
  },
  "image": "ai-dev-workflow-node:latest",
  "resultsDir": "docs/adw-e2e",
  "jobsDir": "e2e/jobs"
}
```

- [ ] **Step 3: Write the failing test `e2e/lib/config.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, configHash, harnessVersion } from './config.mjs';

test('loadConfig reads e2e/config.json and adds the repo root', () => {
  const config = loadConfig();
  assert.equal(config.repetitions, 3);
  assert.deepEqual(Object.keys(config.harnesses), ['claude-code', 'codex', 'opencode']);
  assert.ok(path.isAbsolute(config.root));
});

test('configHash ignores root and is stable', () => {
  const a = { schema: 1, root: '/a', x: { b: 1, a: 2 } };
  const b = { x: { a: 2, b: 1 }, schema: 1, root: '/b' };
  assert.equal(configHash(a), configHash(b));
  assert.notEqual(configHash(a), configHash({ ...a, schema: 2 }));
});

test('harnessVersion reads the pin from the inventory', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    const inv = path.join(dir, 'inventory.json');
    writeFileSync(inv, JSON.stringify({ npmPackages: { '@openai/codex': '0.161.0' } }));
    const config = { harnesses: { codex: { inventoryPackage: '@openai/codex' } } };
    assert.equal(harnessVersion(config, 'codex', inv), '0.161.0');
    assert.throws(() => harnessVersion(config, 'opencode', inv), /unknown harness/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: Run it and verify that it fails**

Run: `node --test e2e/lib/config.test.mjs`
Expected: FAIL (`Cannot find module './config.mjs'`).

- [ ] **Step 5: Implement `e2e/lib/fsutil.mjs` and `e2e/lib/config.mjs`**

```js
// e2e/lib/fsutil.mjs
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export function readJsonl(file) {
  const out = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* partial or foreign line */ }
  }
  return out;
}

export function walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries.flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.isFile() ? [p] : [];
  });
}

export function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export function sha256Dir(dir, { exclude } = {}) {
  const hash = createHash('sha256');
  for (const file of walk(dir).map((f) => path.relative(dir, f)).sort()) {
    if (exclude?.test(file)) continue;
    hash.update(file).update('\0').update(readFileSync(path.join(dir, file))).update('\0');
  }
  return hash.digest('hex');
}

export const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
```

```js
// e2e/lib/config.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadConfig(file = path.join(ROOT, 'e2e', 'config.json')) {
  return { ...JSON.parse(readFileSync(file, 'utf8')), root: ROOT };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  }
  return value;
}

export function configHash(config) {
  const { root, ...rest } = config;
  return createHash('sha256').update(JSON.stringify(canonical(rest))).digest('hex');
}

export function harnessVersion(config, harnessId, inventory = path.join(ROOT, 'docker', 'tools', 'inventory.json')) {
  const harness = config.harnesses?.[harnessId];
  if (!harness) throw new Error(`unknown harness: ${harnessId}`);
  const version = JSON.parse(readFileSync(inventory, 'utf8')).npmPackages?.[harness.inventoryPackage];
  if (!version) throw new Error(`no inventory pin for ${harness.inventoryPackage}`);
  return version;
}
```

- [ ] **Step 6: Run the tests and verify that they pass**

Run: `node --test e2e/lib/config.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add e2e/.gitignore e2e/config.json e2e/lib/fsutil.mjs e2e/lib/config.mjs e2e/lib/config.test.mjs
git commit -m "feat(e2e): scaffold config and fs helpers"
```

---

### Task 2: Metrics: tokens, durations and errors per harness

**Files:**
- Create: `e2e/lib/metrics.mjs`, `e2e/lib/metrics.test.mjs`, and fixtures under `e2e/lib/fixtures/`

**Interfaces:**
- Consumes: `readJsonl`, `walk` from `fsutil.mjs`.
- Produces:
  - `targetTokens(harness, trialDir) => {input, output, cacheRead, cacheWrite, total}`.
  - `userTokens(trialDir) => {total}`: from Harbor `result.json` `agent_result`.
  - `durations(resultJson) => {setup, agent, verifier, total}` in seconds, rounded.
  - `errors(harness, trialDir, resultJson) => {harbor: string|null, bridge: string|null, tool: number, timeout: boolean}`.

Trial directory layout (Harbor 0.24.0, observed in the spike):
- Claude: `agent/sessions/projects/<slug>/*.jsonl`, subagents under `<slug>/<id>/subagents/*.jsonl`.
- Codex: `agent/sessions/YYYY/MM/DD/rollout-*.jsonl`.
- OpenCode: `agent/opencode/xdg-data/opencode/opencode.db`.
- Simulated user log: `user-agent/claude-code.txt`.

- [ ] **Step 1: Create the fixtures**

```js
// e2e/lib/fixtures/make.mjs: builds fixture trial dirs in a temp dir for tests
import { mkdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const line = (o) => `${JSON.stringify(o)}\n`;

export function makeClaudeTrial(dir) {
  const s = path.join(dir, 'agent/sessions/projects/-workspace');
  mkdirSync(path.join(s, 'abc/subagents'), { recursive: true });
  const usage = (i, o, cr, cc) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: cr, cache_creation_input_tokens: cc });
  writeFileSync(path.join(s, 'abc.jsonl'),
    line({ type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: usage(10, 100, 1000, 50),
      content: [{ type: 'tool_use', name: 'mcp__playwright__browser_navigate', input: { url: 'http://localhost:3000/' } }] } }) +
    line({ type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: usage(10, 100, 1000, 50), content: [] } }) +
    line({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'Exit code 1' }] } }) +
    line({ type: 'assistant', message: { id: 'm2', model: 'claude-opus-5-5', usage: usage(5, 20, 500, 0),
      content: [{ type: 'text', text: 'done' }] } }) +
    'not json\n');
  writeFileSync(path.join(s, 'abc/subagents/agent-1.jsonl'),
    line({ type: 'assistant', message: { id: 's1', model: 'claude-sonnet-5-5', usage: usage(1, 10, 100, 5), content: [] } }));
  writeUserLog(dir, false);
  return dir;
}

export function makeCodexTrial(dir) {
  const s = path.join(dir, 'agent/sessions/2026/10/10');
  mkdirSync(s, { recursive: true });
  const total = (i, c, o) => ({ input_tokens: i, cached_input_tokens: c, output_tokens: o, total_tokens: i + o });
  writeFileSync(path.join(s, 'rollout-1.jsonl'),
    line({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: total(100, 80, 10) } } }) +
    line({ type: 'response_item', payload: { type: 'function_call', name: 'mcp__playwright__browser_navigate', arguments: '{"url":"http://127.0.0.1:3000"}' } }) +
    line({ type: 'response_item', payload: { type: 'function_call_output', output: 'failed to parse function arguments: unknown field' } }) +
    line({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: total(1000, 900, 50) } } }));
  writeUserLog(dir, false);
  return dir;
}

export function makeOpenCodeTrial(dir) {
  const d = path.join(dir, 'agent/opencode/xdg-data/opencode');
  mkdirSync(d, { recursive: true });
  const db = new DatabaseSync(path.join(d, 'opencode.db'));
  db.exec('create table message (id text, data text); create table part (id text, data text);');
  const msg = db.prepare('insert into message values (?, ?)');
  msg.run('1', JSON.stringify({ role: 'user' }));
  msg.run('2', JSON.stringify({ role: 'assistant', tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 400, write: 0 } } }));
  msg.run('3', JSON.stringify({ role: 'assistant', tokens: { input: 50, output: 10, reasoning: 0, cache: { read: 300, write: 7 } } }));
  const part = db.prepare('insert into part values (?, ?)');
  part.run('a', JSON.stringify({ type: 'tool', tool: 'playwright_browser_navigate', state: { status: 'completed', input: { url: 'http://localhost:3000' } } }));
  part.run('b', JSON.stringify({ type: 'tool', tool: 'bash', state: { status: 'error', input: { command: 'x' } } }));
  db.close();
  writeUserLog(dir, true);
  return dir;
}

function writeUserLog(dir, bridgeFailure) {
  mkdirSync(path.join(dir, 'user-agent'), { recursive: true });
  writeFileSync(path.join(dir, 'user-agent/claude-code.txt'),
    line({ type: 'assistant', message: { content: [{ type: 'text', text: bridgeFailure ? 'BRIDGE FAILURE: Token refresh failed: 401' : 'Danke!' }] } }));
}

export const RESULT = {
  started_at: '2026-10-10T11:46:00Z', finished_at: '2026-10-10T11:52:43Z',
  environment_setup: { started_at: '2026-10-10T11:46:01Z', finished_at: '2026-10-10T11:46:15Z' },
  agent_execution: { started_at: '2026-10-10T11:46:39Z', finished_at: '2026-10-10T11:52:39Z' },
  verifier: { started_at: '2026-10-10T11:52:42Z', finished_at: '2026-10-10T11:52:43Z' },
  agent_result: { n_input_tokens: 235649, n_cache_tokens: 224706, n_output_tokens: 2072 },
  exception_info: null,
};
```

- [ ] **Step 2: Write the failing test `e2e/lib/metrics.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { targetTokens, userTokens, durations, errors } from './metrics.mjs';
import { makeClaudeTrial, makeCodexTrial, makeOpenCodeTrial, RESULT } from './fixtures/make.mjs';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));

test('claude tokens dedupe message ids and include subagents', () => {
  const dir = makeClaudeTrial(tmp());
  try {
    assert.deepEqual(targetTokens('claude-code', dir),
      { input: 16, output: 130, cacheRead: 1600, cacheWrite: 55, total: 1801 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('codex tokens use the last token_count event', () => {
  const dir = makeCodexTrial(tmp());
  try {
    assert.deepEqual(targetTokens('codex', dir),
      { input: 100, output: 50, cacheRead: 900, cacheWrite: 0, total: 1050 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('opencode tokens sum assistant messages, reasoning counts as output', () => {
  const dir = makeOpenCodeTrial(tmp());
  try {
    assert.deepEqual(targetTokens('opencode', dir),
      { input: 150, output: 35, cacheRead: 700, cacheWrite: 7, total: 892 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('missing session data yields null tokens', () => {
  const dir = tmp();
  try { assert.equal(targetTokens('codex', dir), null); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('durations come from result.json phases', () => {
  assert.deepEqual(durations(RESULT), { setup: 14, agent: 360, verifier: 1, total: 403 });
});

test('userTokens reads agent_result', () => {
  assert.deepEqual(userTokens(RESULT), { total: 235649 + 2072 });
});

test('errors count tool errors and detect bridge failure', () => {
  const c = makeClaudeTrial(tmp()), o = makeOpenCodeTrial(tmp());
  try {
    assert.deepEqual(errors('claude-code', c, RESULT), { harbor: null, bridge: null, tool: 1, timeout: false });
    const e = errors('opencode', o, { ...RESULT, exception_info: { exception_type: 'AgentTimeoutError', exception_message: 'x' } });
    assert.equal(e.bridge, 'BRIDGE FAILURE: Token refresh failed: 401');
    assert.equal(e.tool, 1);
    assert.equal(e.timeout, true);
    assert.equal(e.harbor, 'AgentTimeoutError');
  } finally { rmSync(c, { recursive: true, force: true }); rmSync(o, { recursive: true, force: true }); }
});
```

- [ ] **Step 3: Run it and verify that it fails**

Run: `node --test e2e/lib/metrics.test.mjs`
Expected: FAIL (`Cannot find module './metrics.mjs'`).

- [ ] **Step 4: Implement `e2e/lib/metrics.mjs`**

```js
// Host-side metrics from a Harbor trial directory. Target tokens come from the agent's native
// session logs, because Harbor's own numbers cover the simulated user or only the last turn.
import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { readJsonl, walk } from './fsutil.mjs';

const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
const finish = (t) => ({ ...t, total: t.input + t.output + t.cacheRead + t.cacheWrite });

export function claudeEvents(trialDir) {
  return walk(path.join(trialDir, 'agent/sessions/projects'))
    .filter((f) => f.endsWith('.jsonl')).flatMap(readJsonl);
}
export function codexEvents(trialDir) {
  return walk(path.join(trialDir, 'agent/sessions'))
    .filter((f) => /rollout-.*\.jsonl$/.test(f)).sort().flatMap(readJsonl);
}
export function openCodeRows(trialDir, table) {
  const file = path.join(trialDir, 'agent/opencode/xdg-data/opencode/opencode.db');
  if (!existsSync(file)) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare(`select data from ${table}`).all().map((r) => JSON.parse(r.data)); }
  finally { db.close(); }
}

export function targetTokens(harness, trialDir) {
  if (harness === 'claude-code') {
    const events = claudeEvents(trialDir);
    if (!events.length) return null;
    const seen = new Set(); const t = zero();
    for (const e of events) {
      const m = e.message;
      if (e.type !== 'assistant' || !m?.usage || seen.has(m.id)) continue;
      seen.add(m.id);
      t.input += m.usage.input_tokens ?? 0; t.output += m.usage.output_tokens ?? 0;
      t.cacheRead += m.usage.cache_read_input_tokens ?? 0; t.cacheWrite += m.usage.cache_creation_input_tokens ?? 0;
    }
    return finish(t);
  }
  if (harness === 'codex') {
    const last = codexEvents(trialDir)
      .filter((e) => e.type === 'event_msg' && e.payload?.type === 'token_count' && e.payload.info)
      .at(-1)?.payload.info.total_token_usage;
    if (!last) return null;
    return finish({ input: last.input_tokens - last.cached_input_tokens, output: last.output_tokens,
      cacheRead: last.cached_input_tokens, cacheWrite: 0 });
  }
  if (harness === 'opencode') {
    const msgs = openCodeRows(trialDir, 'message').filter((m) => m.role === 'assistant');
    if (!msgs.length) return null;
    const t = zero();
    for (const { tokens: k = {} } of msgs) {
      t.input += k.input ?? 0; t.output += (k.output ?? 0) + (k.reasoning ?? 0);
      t.cacheRead += k.cache?.read ?? 0; t.cacheWrite += k.cache?.write ?? 0;
    }
    return finish(t);
  }
  throw new Error(`unknown harness: ${harness}`);
}

export function userTokens(result) {
  const a = result.agent_result ?? {};
  return { total: (a.n_input_tokens ?? 0) + (a.n_output_tokens ?? 0) };
}

const secs = (p) => (p?.started_at && p?.finished_at
  ? Math.round((new Date(p.finished_at) - new Date(p.started_at)) / 1000) : null);

export function durations(result) {
  return { setup: secs(result.environment_setup), agent: secs(result.agent_execution),
    verifier: secs(result.verifier), total: secs(result) };
}

// Every tool call as {name, text}: the e2e detector and error counter read only this shape.
export function toolCalls(harness, trialDir) {
  if (harness === 'claude-code') {
    return claudeEvents(trialDir).flatMap((e) => (e.type === 'assistant' ? e.message?.content ?? [] : [])
      .filter((c) => c.type === 'tool_use').map((c) => ({ name: c.name, text: JSON.stringify(c.input) })));
  }
  if (harness === 'codex') {
    return codexEvents(trialDir).filter((e) => e.type === 'response_item' && ['function_call', 'custom_tool_call'].includes(e.payload?.type))
      .map((e) => ({ name: e.payload.name ?? '', text: String(e.payload.arguments ?? e.payload.input ?? '') }));
  }
  return openCodeRows(trialDir, 'part').filter((p) => p.type === 'tool')
    .map((p) => ({ name: p.tool, text: JSON.stringify(p.state?.input ?? {}) }));
}

function toolErrorCount(harness, trialDir) {
  if (harness === 'claude-code') {
    return claudeEvents(trialDir).flatMap((e) => (e.type === 'user' && Array.isArray(e.message?.content) ? e.message.content : []))
      .filter((c) => c.type === 'tool_result' && c.is_error).length;
  }
  if (harness === 'codex') {
    return codexEvents(trialDir).filter((e) => e.payload?.type === 'function_call_output'
      && /^(failed to|error:|Exit code [1-9])/i.test(String(e.payload.output ?? ''))).length;
  }
  return openCodeRows(trialDir, 'part').filter((p) => p.type === 'tool' && p.state?.status === 'error').length;
}

export function errors(harness, trialDir, result) {
  const log = path.join(trialDir, 'user-agent/claude-code.txt');
  const bridge = existsSync(log) ? readFileSync(log, 'utf8').match(/BRIDGE FAILURE:[^"\\]*/)?.[0].trim() ?? null : null;
  const type = result.exception_info?.exception_type ?? null;
  return { harbor: type, bridge, tool: toolErrorCount(harness, trialDir), timeout: /Timeout/i.test(type ?? '') };
}
```

- [ ] **Step 5: Run the tests and verify that they pass**

Run: `node --test e2e/lib/metrics.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add e2e/lib/metrics.mjs e2e/lib/metrics.test.mjs e2e/lib/fixtures/make.mjs
git commit -m "feat(e2e): extract target tokens, durations and errors from trial logs"
```

---

### Task 3: Metrics: e2e detection and soft signals

**Files:**
- Modify: `e2e/lib/metrics.mjs`, `e2e/lib/metrics.test.mjs`

**Interfaces:**
- Consumes: `toolCalls`, `claudeEvents`, `codexEvents`, `openCodeRows` (Task 2).
- Produces:
  - `e2ePerformed(harness, trialDir, port) => 0|1`: at least one Playwright `browser_navigate` call
    whose input contains `:<port>`. Playwright MCP tool names all contain `browser_`, under any
    harness prefix.
  - `softSignals(harness, trialDir) => {superpowersActive: boolean}`: whether the target session
    contains the superpowers bootstrap marker `using-superpowers`. Unscored.

- [ ] **Step 1: Append the failing tests to `e2e/lib/metrics.test.mjs`**

```js
import { e2ePerformed, softSignals } from './metrics.mjs';
import { appendFileSync } from 'node:fs';

test('e2ePerformed detects Playwright navigation to the app port in every harness', () => {
  const dirs = [['claude-code', makeClaudeTrial(tmp())], ['codex', makeCodexTrial(tmp())], ['opencode', makeOpenCodeTrial(tmp())]];
  try {
    for (const [h, d] of dirs) {
      assert.equal(e2ePerformed(h, d, 3000), 1, h);
      assert.equal(e2ePerformed(h, d, 4000), 0, h);
    }
  } finally { for (const [, d] of dirs) rmSync(d, { recursive: true, force: true }); }
});

test('softSignals reports the superpowers bootstrap', () => {
  const dir = makeClaudeTrial(tmp());
  try {
    assert.deepEqual(softSignals('claude-code', dir), { superpowersActive: false });
    appendFileSync(path.join(dir, 'agent/sessions/projects/-workspace/abc.jsonl'),
      `${JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'skills/using-superpowers/SKILL.md' }] } })}\n`);
    assert.deepEqual(softSignals('claude-code', dir), { superpowersActive: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run them and verify that they fail**

Run: `node --test e2e/lib/metrics.test.mjs`
Expected: FAIL (`e2ePerformed is not a function`).

- [ ] **Step 3: Implement both functions at the end of `e2e/lib/metrics.mjs`**

```js
export function e2ePerformed(harness, trialDir, port) {
  return toolCalls(harness, trialDir)
    .some((c) => /browser_navigate/.test(c.name + c.text) && c.text.includes(`:${port}`)) ? 1 : 0;
}

export function softSignals(harness, trialDir) {
  const blob = harness === 'opencode'
    ? JSON.stringify([openCodeRows(trialDir, 'message'), openCodeRows(trialDir, 'part')])
    : JSON.stringify(harness === 'codex' ? codexEvents(trialDir) : claudeEvents(trialDir));
  return { superpowersActive: blob.includes('using-superpowers') };
}
```

- [ ] **Step 4: Run the tests and verify that they pass**

Run: `node --test e2e/lib/metrics.test.mjs`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add e2e/lib/metrics.mjs e2e/lib/metrics.test.mjs
git commit -m "feat(e2e): detect Playwright e2e and superpowers bootstrap from sessions"
```

---

### Task 4: Isolated ccusage cross-check

**Files:**
- Create: `e2e/lib/ccusage.mjs`, `e2e/lib/ccusage.test.mjs`

**Interfaces:**
- Consumes: `targetTokens` result shape.
- Produces:
  - `ccusageCrossCheck(harness, trialDir, tokens, {run?}) => {ccusageTotal: number|null, deviation: number|null, warning: string|null}`.
  - `run` is an injectable `(cmd, args, opts) => {status, stdout}` (default: `spawnSync`).
  - OpenCode returns all-null fields, because ccusage@20 does not cover it.
  - Above 1 % deviation, `warning` is set.

- [ ] **Step 1: Write the failing test `e2e/lib/ccusage.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ccusageCrossCheck } from './ccusage.mjs';
import { makeClaudeTrial } from './fixtures/make.mjs';

test('cross-check runs ccusage with an isolated HOME holding a copy of the sessions', () => {
  const dir = makeClaudeTrial(mkdtempSync(path.join(tmpdir(), 'adw-e2e-')));
  let seen;
  const run = (cmd, args, opts) => {
    seen = { cmd, args, home: opts.env.HOME, hasCopy: existsSync(path.join(opts.env.HOME, '.claude/projects/-workspace/abc.jsonl')) };
    return { status: 0, stdout: JSON.stringify({ totals: { totalTokens: 1801 } }) };
  };
  try {
    const r = ccusageCrossCheck('claude-code', dir, { total: 1801 }, { run });
    assert.deepEqual(r, { ccusageTotal: 1801, deviation: 0, warning: null });
    assert.equal(seen.cmd, 'npx');
    assert.deepEqual(seen.args, ['-y', 'ccusage@20', 'session', '--json', '--offline']);
    assert.equal(seen.hasCopy, true);
    assert.equal(existsSync(seen.home), false, 'isolated HOME is removed afterwards');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deviation above 1% produces a warning; opencode is skipped', () => {
  const dir = makeClaudeTrial(mkdtempSync(path.join(tmpdir(), 'adw-e2e-')));
  try {
    const run = () => ({ status: 0, stdout: JSON.stringify({ totals: { totalTokens: 2000 } }) });
    const r = ccusageCrossCheck('claude-code', dir, { total: 1801 }, { run });
    assert.equal(r.ccusageTotal, 2000);
    assert.match(r.warning, /deviation/);
    assert.deepEqual(ccusageCrossCheck('opencode', dir, { total: 1 }, { run }), { ccusageTotal: null, deviation: null, warning: null });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run it and verify that it fails**

Run: `node --test e2e/lib/ccusage.test.mjs`
Expected: FAIL (`Cannot find module`).

- [ ] **Step 3: Implement `e2e/lib/ccusage.mjs`**

```js
// Cross-checks our session-log token sum against ccusage, run with an isolated HOME. Without the
// isolation, ccusage would also count every session on the host.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const LAYOUT = {
  'claude-code': { from: 'agent/sessions/projects', to: '.claude/projects', env: (h) => ({ CLAUDE_CONFIG_DIR: path.join(h, '.claude') }) },
  codex: { from: 'agent/sessions', to: '.codex/sessions', env: (h) => ({ CODEX_HOME: path.join(h, '.codex') }) },
};

export function ccusageCrossCheck(harness, trialDir, tokens, { run = spawnSync } = {}) {
  const layout = LAYOUT[harness];
  if (!layout || !tokens) return { ccusageTotal: null, deviation: null, warning: null };
  const home = mkdtempSync(path.join(tmpdir(), 'adw-ccusage-'));
  try {
    cpSync(path.join(trialDir, layout.from), path.join(home, layout.to), { recursive: true });
    const r = run('npx', ['-y', 'ccusage@20', 'session', '--json', '--offline'],
      { env: { ...process.env, HOME: home, ...layout.env(home) }, encoding: 'utf8' });
    if (r.status !== 0) return { ccusageTotal: null, deviation: null, warning: `ccusage failed (exit ${r.status})` };
    const total = JSON.parse(r.stdout).totals?.totalTokens ?? null;
    if (total === null) return { ccusageTotal: null, deviation: null, warning: 'ccusage returned no totals' };
    const deviation = tokens.total ? Math.abs(total - tokens.total) / tokens.total : 0;
    return { ccusageTotal: total, deviation: Number(deviation.toFixed(4)),
      warning: deviation > 0.01 ? `token deviation ${(deviation * 100).toFixed(1)}% vs ccusage` : null };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run the tests and verify that they pass**

Run: `node --test e2e/lib/ccusage.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add e2e/lib/ccusage.mjs e2e/lib/ccusage.test.mjs
git commit -m "feat(e2e): cross-check token sums with isolated ccusage"
```

---

### Task 5: Fingerprint

**Files:**
- Create: `e2e/lib/fingerprint.mjs`, `e2e/lib/fingerprint.test.mjs`

**Interfaces:**
- Consumes: `sha256File`, `sha256Dir`, `walk` (fsutil); `configHash`, `harnessVersion` (config).
- Produces:
  - `buildFingerprint({config, harness, demoRepo, exec?}) => Fingerprint`. `exec(cmd, args) => string`
    is injectable; it is used for git and docker.
  - `diffFingerprints(a, b) => Array<{key: string, from: any, to: any}>`: flattened dotted keys.

`Fingerprint` shape:

```js
{ adw: { version, sha, dirty }, skill: { claude, codex, opencode, includes },
  image: { ref, id, inventory, harnessVersion, superpowers }, harbor: { version, acpx: '0.11.2',
  claudeCodeAcp: '0.16.2', codexAcp: '1.12.0' }, config: <configHash>, task: <sha256Dir(task)> }
```

- [ ] **Step 1: Write the failing test `e2e/lib/fingerprint.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildFingerprint, diffFingerprints } from './fingerprint.mjs';
import { loadConfig } from './config.mjs';

function demoRepo() {
  const d = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  for (const [p, c] of [['.claude/skills/agent-dev/SKILL.md', 'c'], ['.agents/skills/agent-dev/SKILL.md', 'x'],
    ['.opencode/skills/agent-dev/SKILL.md', 'o'], ['.agents/includes/ticketing.md', 't']]) {
    mkdirSync(path.dirname(path.join(d, p)), { recursive: true });
    writeFileSync(path.join(d, p), c);
  }
  return d;
}
const exec = (cmd, args) => {
  const key = `${cmd} ${args.join(' ')}`;
  if (key === 'git rev-parse HEAD') return 'abc123\n';
  if (key === 'git status --porcelain') return '';
  if (key.startsWith('docker image inspect')) return 'sha256:img1\n';
  if (key === 'harbor --version') return '0.24.0\n';
  throw new Error(`unexpected ${key}`);
};

test('fingerprint records versions, hashes and image', () => {
  const repo = demoRepo();
  try {
    const fp = buildFingerprint({ config: loadConfig(), harness: 'codex', demoRepo: repo, exec });
    assert.equal(fp.adw.sha, 'abc123');
    assert.equal(fp.adw.dirty, false);
    assert.equal(fp.image.id, 'sha256:img1');
    assert.equal(fp.harbor.version, '0.24.0');
    assert.match(fp.skill.claude, /^[0-9a-f]{64}$/);
    assert.match(fp.image.harnessVersion, /^\d+\.\d+\.\d+/);
    assert.match(fp.image.superpowers, /^[0-9a-f]{40}$/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('diffFingerprints lists changed dotted keys only', () => {
  const a = { adw: { sha: '1', dirty: false }, skill: { claude: 'h1' }, config: 'c' };
  const b = { adw: { sha: '2', dirty: false }, skill: { claude: 'h2' }, config: 'c' };
  assert.deepEqual(diffFingerprints(a, b), [
    { key: 'adw.sha', from: '1', to: '2' }, { key: 'skill.claude', from: 'h1', to: 'h2' }]);
});
```

- [ ] **Step 2: Run it and verify that it fails**

Run: `node --test e2e/lib/fingerprint.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `e2e/lib/fingerprint.mjs`**

```js
// Records every component version that can change a run's outcome; compare diffs these.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { configHash, harnessVersion } from './config.mjs';
import { sha256Dir, sha256File, walk } from './fsutil.mjs';

export const ACP_VERSIONS = { acpx: '0.11.2', claudeCodeAcp: '0.16.2', codexAcp: '1.12.0' };
export function buildFingerprint({ config, harness, demoRepo,
  exec = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', cwd: config.root }) }) {
  const root = config.root;
  const inventory = path.join(root, 'docker/tools/inventory.json');
  const inv = JSON.parse(readFileSync(inventory, 'utf8'));
  const skill = (p) => sha256File(path.join(demoRepo, p, 'skills/agent-dev/SKILL.md'));
  const includes = walk(path.join(demoRepo, '.agents/includes')).sort().map(sha256File).join(':');
  return {
    adw: { version: JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version,
      sha: exec('git', ['rev-parse', 'HEAD']).trim(), dirty: exec('git', ['status', '--porcelain']).trim() !== '' },
    skill: { claude: skill('.claude'), codex: skill('.agents'), opencode: skill('.opencode'), includes },
    image: { ref: config.image, id: exec('docker', ['image', 'inspect', '--format', '{{.Id}}', config.image]).trim(),
      inventory: sha256File(inventory), harnessVersion: harnessVersion(config, harness, inventory),
      superpowers: inv.sourceRevisions.superpowers },
    harbor: { version: exec('harbor', ['--version']).trim(), ...ACP_VERSIONS },
    config: configHash(config),
    task: sha256Dir(path.join(root, 'e2e', config.task), { exclude: /(^|\/)(\.claude|\.agents|\.opencode|\.codex)\/|\.mcp\.json$/ }),
  };
}

function flatten(obj, prefix = '') {
  return Object.entries(obj ?? {}).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v)
    ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));
}

export function diffFingerprints(a, b) {
  const fa = Object.fromEntries(flatten(a)); const fb = Object.fromEntries(flatten(b));
  return [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort()
    .filter((k) => JSON.stringify(fa[k]) !== JSON.stringify(fb[k]))
    .map((key) => ({ key, from: fa[key], to: fb[key] }));
}
```

- [ ] **Step 4: Run the tests and verify that they pass**

Run: `node --test e2e/lib/fingerprint.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add e2e/lib/fingerprint.mjs e2e/lib/fingerprint.test.mjs
git commit -m "feat(e2e): fingerprint every component version of a run"
```

---

### Task 6: Judge

**Files:**
- Create: `e2e/lib/judge.mjs`, `e2e/lib/judge.test.mjs`

**Interfaces:**
- Consumes: `config.judge` (`model`, `criteria`).
- Produces:
  - `buildJudgePrompt({criteria, briefing, spec, diff, summary}) => string`.
  - `parseJudgeOutput(stdout, criteria) => {scores: {requirements, scope, tests, readability}, reasons: {...}}`.
    It throws on invalid output.
  - `runJudge({config, briefing, spec, diff, summary, run?}) => {scores, reasons, error: string|null}`.
    On failure the scores are `null` per criterion. `run` is injectable (default `spawnSync`).

- [ ] **Step 1: Write the failing test `e2e/lib/judge.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJudgePrompt, parseJudgeOutput, runJudge } from './judge.mjs';
import { loadConfig } from './config.mjs';

const config = loadConfig();
const { criteria } = config.judge;
const input = { briefing: 'B', spec: 'S', diff: 'D', summary: 'U' };
const good = { requirements: { score: 5, reason: 'r1' }, scope: { score: 4, reason: 'r2' },
  tests: { score: 3, reason: 'r3' }, readability: { score: 5, reason: 'r4' } };

test('prompt contains every criterion and all inputs', () => {
  const p = buildJudgePrompt({ criteria, ...input });
  for (const k of Object.keys(criteria)) assert.ok(p.includes(k));
  for (const tag of ['<briefing>\nB', '<spec>\nS', '<diff>\nD', '<summary>\nU']) assert.ok(p.includes(tag), tag);
});

test('parse accepts claude -p json with a fenced JSON result', () => {
  const stdout = JSON.stringify({ type: 'result', result: `Here:\n\`\`\`json\n${JSON.stringify(good)}\n\`\`\`` });
  assert.deepEqual(parseJudgeOutput(stdout, criteria), {
    scores: { requirements: 5, scope: 4, tests: 3, readability: 5 },
    reasons: { requirements: 'r1', scope: 'r2', tests: 'r3', readability: 'r4' } });
});

test('parse rejects missing criteria and out-of-range scores', () => {
  const wrap = (o) => JSON.stringify({ result: JSON.stringify(o) });
  assert.throws(() => parseJudgeOutput(wrap({ ...good, scope: undefined }), criteria), /scope/);
  assert.throws(() => parseJudgeOutput(wrap({ ...good, tests: { score: 9, reason: 'x' } }), criteria), /tests/);
});

test('runJudge calls claude -p with the judge model and returns null scores on failure', () => {
  let args;
  const ok = runJudge({ config, ...input, run: (cmd, a) => { args = [cmd, ...a]; return { status: 0, stdout: JSON.stringify({ result: JSON.stringify(good) }) }; } });
  assert.equal(args[0], 'claude');
  assert.deepEqual(args.slice(1, 5), ['-p', '--model', 'claude-opus-5-5', '--output-format']);
  assert.equal(ok.scores.requirements, 5);
  assert.equal(ok.error, null);
  const bad = runJudge({ config, ...input, run: () => ({ status: 1, stdout: '', stderr: 'boom' }) });
  assert.deepEqual(bad.scores, { requirements: null, scope: null, tests: null, readability: null });
  assert.match(bad.error, /boom/);
});
```

- [ ] **Step 2: Run it and verify that it fails**

Run: `node --test e2e/lib/judge.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `e2e/lib/judge.mjs`**

```js
// Outcome-based quality judge: one claude -p call per trial with a fixed rubric.
import { spawnSync } from 'node:child_process';

export function buildJudgePrompt({ criteria, briefing, spec, diff, summary }) {
  const rubric = Object.entries(criteria).map(([k, q]) => `- ${k}: ${q}`).join('\n');
  return `You are a strict senior reviewer. Score the coding agent's work against the product owner's briefing.
Score each criterion from 1 (poor) to 5 (excellent) with one short sentence of reasoning.

Criteria:
${rubric}

Answer with JSON only, exactly this shape:
{${Object.keys(criteria).map((k) => `"${k}": {"score": <1-5>, "reason": "<sentence>"}`).join(', ')}}

<briefing>
${briefing}
</briefing>

<spec>
${spec}
</spec>

<diff>
${diff}
</diff>

<summary>
${summary}
</summary>
`;
}

export function parseJudgeOutput(stdout, criteria) {
  const text = JSON.parse(stdout).result ?? '';
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error('judge returned no JSON object');
  const parsed = JSON.parse(json);
  const scores = {}; const reasons = {};
  for (const k of Object.keys(criteria)) {
    const v = parsed[k];
    if (!v || !Number.isInteger(v.score) || v.score < 1 || v.score > 5) throw new Error(`judge criterion ${k} invalid`);
    scores[k] = v.score; reasons[k] = String(v.reason ?? '');
  }
  return { scores, reasons };
}

export function runJudge({ config, briefing, spec, diff, summary, run = spawnSync }) {
  const { model, criteria } = config.judge;
  const nulls = Object.fromEntries(Object.keys(criteria).map((k) => [k, null]));
  try {
    const r = run('claude', ['-p', '--model', model, '--output-format', 'json'],
      { input: buildJudgePrompt({ criteria, briefing, spec, diff, summary }), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`judge exit ${r.status}: ${String(r.stderr ?? '').slice(0, 300)}`);
    return { ...parseJudgeOutput(r.stdout, criteria), error: null };
  } catch (err) {
    return { scores: nulls, reasons: {}, error: err.message };
  }
}
```

- [ ] **Step 4: Run the tests and verify that they pass**

Run: `node --test e2e/lib/judge.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add e2e/lib/judge.mjs e2e/lib/judge.test.mjs
git commit -m "feat(e2e): add outcome-based LLM judge with fixed rubric"
```

---

### Task 7: Trial record and summary

**Files:**
- Create: `e2e/lib/trial.mjs`, `e2e/lib/trial.test.mjs`, `e2e/lib/summary.mjs`, `e2e/lib/summary.test.mjs`

**Interfaces:**
- Consumes: the metrics functions (Tasks 2–3), `ccusageCrossCheck` (Task 4) and `runJudge` (Task 6),
  all injectable through `deps`.
- Produces:
  - `CONTRACT_CHECKS`: the array of contract check names.
  - `buildTrialRecord({id, harness, trialDir, config, briefing, deps?}) => Trial`. It reads
    `<trialDir>/result.json` and `<trialDir>/verifier/reward.json` and the evidence files
    `ticket.json` and `pr.diff`.
  - `summarizeTrials(trials) => {rewardRate, checkRates, median: {tokens, agent}, judgeMedian, errorClasses}`.
  - `median(numbers) => number|null`: nulls are ignored.

`Trial` shape (as in the spec's `run.json`): `{id, reward, contract, checks, acceptance, ownTests,
judge, judgeReasons, durations, tokens, ccusage, userTokens, errors, soft}`.

Contract checks: `ticket_open, ticket_review, spec_comment, spec_comment_complete, summary_comment,
cost_comment, only_allowed_comments, pr_draft, branch_naming, pr_title_naming, app_stopped,
no_screenshots_in_repo` come from the verifier. `e2e_performed` is added on the host.

- [ ] **Step 1: Write the failing test `e2e/lib/summary.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTrials, median } from './summary.mjs';

test('median ignores nulls', () => {
  assert.equal(median([3, null, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([null]), null);
});

test('summary computes rates, medians and error classes', () => {
  const t = (reward, spec, tokens, agent, req, errs = {}) => ({ reward, checks: { spec_comment: spec, pr_draft: 1 },
    acceptance: reward, ownTests: 1, tokens: { total: tokens }, durations: { agent }, judge: { requirements: req },
    errors: { harbor: null, bridge: null, tool: 0, timeout: false, ...errs } });
  const s = summarizeTrials([t(1, 1, 100, 10, 5), t(0, 0, 300, 30, 3, { bridge: 'BRIDGE FAILURE: x' }), t(1, 1, 200, 20, 4)]);
  assert.equal(s.rewardRate, 0.67);
  assert.deepEqual(s.checkRates, { spec_comment: 0.67, pr_draft: 1, acceptance: 0.67, ownTests: 1 });
  assert.deepEqual(s.median, { tokens: 200, agent: 20 });
  assert.deepEqual(s.judgeMedian, { requirements: 4 });
  assert.deepEqual(s.errorClasses, ['bridge']);
});
```

- [ ] **Step 2: Write the failing test `e2e/lib/trial.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildTrialRecord, CONTRACT_CHECKS } from './trial.mjs';
import { RESULT } from './fixtures/make.mjs';

test('trial record merges verifier rewards, host e2e check, metrics and judge', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    mkdirSync(path.join(dir, 'verifier'));
    writeFileSync(path.join(dir, 'result.json'), JSON.stringify(RESULT));
    const checks = Object.fromEntries(CONTRACT_CHECKS.filter((c) => c !== 'e2e_performed').map((c) => [c, 1]));
    writeFileSync(path.join(dir, 'verifier/reward.json'), JSON.stringify({ ...checks, own_tests_pass: 1, acceptance: 1 }));
    writeFileSync(path.join(dir, 'verifier/ticket.json'), JSON.stringify({ comments: [
      { body: '## Approved Spec\nSPEC' }, { body: '## Implementation Summary\nSUM' }] }));
    writeFileSync(path.join(dir, 'verifier/pr.diff'), 'DIFF');
    let judged;
    const deps = {
      targetTokens: () => ({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 }),
      userTokens: () => ({ total: 5 }),
      durations: () => ({ setup: 1, agent: 2, verifier: 3, total: 6 }),
      errors: () => ({ harbor: null, bridge: null, tool: 0, timeout: false }),
      e2ePerformed: () => 0,
      softSignals: () => ({ superpowersActive: true }),
      ccusageCrossCheck: () => ({ ccusageTotal: 10, deviation: 0, warning: null }),
      runJudge: (a) => { judged = a; return { scores: { requirements: 5 }, reasons: { requirements: 'ok' }, error: null }; },
    };
    const t = buildTrialRecord({ id: 'codex-1', harness: 'codex', trialDir: dir, config: { app: { port: 3000 } }, briefing: 'BRIEF', deps });
    assert.equal(t.checks.e2e_performed, 0);
    assert.equal(t.contract, Number(((CONTRACT_CHECKS.length - 1) / CONTRACT_CHECKS.length).toFixed(4)));
    assert.equal(t.reward, 0, 'missing e2e makes reward 0');
    assert.deepEqual([judged.spec, judged.summary, judged.diff, judged.briefing], ['## Approved Spec\nSPEC', '## Implementation Summary\nSUM', 'DIFF', 'BRIEF']);
    assert.equal(t.judge.requirements, 5);
    assert.equal(t.tokens.total, 10);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a trial without verifier output scores zero instead of throwing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ ...RESULT, exception_info: { exception_type: 'RuntimeError' } }));
    const deps = { targetTokens: () => null, userTokens: () => ({ total: 0 }), durations: () => ({}), e2ePerformed: () => 0,
      errors: () => ({ harbor: 'RuntimeError', bridge: null, tool: 0, timeout: false }), softSignals: () => ({ superpowersActive: false }),
      ccusageCrossCheck: () => ({ ccusageTotal: null, deviation: null, warning: null }),
      runJudge: () => { throw new Error('must not judge without evidence'); } };
    const t = buildTrialRecord({ id: 'x-1', harness: 'codex', trialDir: dir, config: { app: { port: 3000 } }, briefing: '', deps });
    assert.equal(t.reward, 0);
    assert.equal(t.contract, 0);
    assert.equal(t.judge, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 3: Run both and verify that they fail**

Run: `node --test e2e/lib/summary.test.mjs e2e/lib/trial.test.mjs`
Expected: FAIL.

- [ ] **Step 4: Implement `e2e/lib/summary.mjs`**

```js
export function median(values) {
  const v = values.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const rate = (xs) => (xs.length ? Number((xs.filter((x) => x === 1).length / xs.length).toFixed(2)) : null);

export function summarizeTrials(trials) {
  const checkNames = [...new Set(trials.flatMap((t) => Object.keys(t.checks ?? {})))];
  const checkRates = Object.fromEntries(checkNames.map((c) => [c, rate(trials.map((t) => t.checks?.[c] ?? 0))]));
  checkRates.acceptance = rate(trials.map((t) => t.acceptance));
  checkRates.ownTests = rate(trials.map((t) => t.ownTests));
  const criteria = [...new Set(trials.flatMap((t) => Object.keys(t.judge ?? {})))];
  return {
    rewardRate: rate(trials.map((t) => t.reward)),
    checkRates,
    median: { tokens: median(trials.map((t) => t.tokens?.total)), agent: median(trials.map((t) => t.durations?.agent)) },
    judgeMedian: Object.fromEntries(criteria.map((c) => [c, median(trials.map((t) => t.judge?.[c]))])),
    errorClasses: [...new Set(trials.flatMap((t) => ['harbor', 'bridge', 'timeout'].filter((k) => t.errors?.[k])))].sort(),
  };
}
```

- [ ] **Step 5: Implement `e2e/lib/trial.mjs`**

```js
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as metrics from './metrics.mjs';
import { ccusageCrossCheck } from './ccusage.mjs';
import { runJudge } from './judge.mjs';

export const CONTRACT_CHECKS = ['ticket_open', 'ticket_review', 'spec_comment', 'spec_comment_complete',
  'summary_comment', 'cost_comment', 'only_allowed_comments', 'pr_draft', 'branch_naming', 'pr_title_naming',
  'e2e_performed', 'app_stopped', 'no_screenshots_in_repo'];

const DEFAULT_DEPS = { ...metrics, ccusageCrossCheck, runJudge };
const readJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
const readText = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
const section = (comments, title) => comments.filter((c) => c.body.trimStart().startsWith(`## ${title}`)).map((c) => c.body).join('\n\n');

export function buildTrialRecord({ id, harness, trialDir, config, briefing, deps = DEFAULT_DEPS }) {
  const result = readJson(path.join(trialDir, 'result.json')) ?? {};
  const reward = readJson(path.join(trialDir, 'verifier/reward.json'));
  const ticket = readJson(path.join(trialDir, 'verifier/ticket.json'));
  const checks = Object.fromEntries(CONTRACT_CHECKS.map((c) => [c, reward?.[c] === 1 ? 1 : 0]));
  checks.e2e_performed = deps.e2ePerformed(harness, trialDir, config.app.port);
  const contract = Number((Object.values(checks).reduce((a, b) => a + b, 0) / CONTRACT_CHECKS.length).toFixed(4));
  const acceptance = reward?.acceptance ?? 0;
  const ownTests = reward?.own_tests_pass ?? 0;
  const tokens = deps.targetTokens(harness, trialDir);
  let judge = null; let judgeReasons = null; let judgeError = null;
  if (ticket) {
    const j = deps.runJudge({ config, briefing, spec: section(ticket.comments, 'Approved Spec'),
      diff: readText(path.join(trialDir, 'verifier/pr.diff')), summary: section(ticket.comments, 'Implementation Summary') });
    judge = j.scores; judgeReasons = j.reasons; judgeError = j.error;
  }
  return {
    id, reward: contract === 1 && ownTests === 1 && acceptance === 1 ? 1 : 0, contract, checks, acceptance, ownTests,
    judge, judgeReasons, judgeError, durations: deps.durations(result), tokens,
    ccusage: deps.ccusageCrossCheck(harness, trialDir, tokens), userTokens: deps.userTokens(result),
    errors: deps.errors(harness, trialDir, result), soft: deps.softSignals(harness, trialDir),
  };
}
```

- [ ] **Step 6: Run the tests and verify that they pass**

Run: `node --test e2e/lib/summary.test.mjs e2e/lib/trial.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add e2e/lib/trial.mjs e2e/lib/trial.test.mjs e2e/lib/summary.mjs e2e/lib/summary.test.mjs
git commit -m "feat(e2e): build trial records and per-harness summaries"
```

---

### Task 8: Compare and baseline selection

**Files:**
- Create: `e2e/lib/compare.mjs`, `e2e/lib/compare.test.mjs`

**Interfaces:**
- Consumes: the `summary` shape (Task 7) and `diffFingerprints` (Task 5).
- Produces:
  - `compareRuns(baseRun, candRun, thresholds) => {verdict, signals, fingerprintDiff}`.
    - `verdict` ∈ `better|same|worse|inconclusive`.
    - `signals` is a list of `{signal, base, cand, kind}` with `kind` ∈ `regression|improvement|noise`.
    - Each run has the shape `{summary, trials, fingerprint}`.
  - `findBaseline({resultsDir, harness, before, isAncestor}) => string|null`: the newest earlier
    `<ts>/<harness>/run.json` whose `fingerprint.adw.sha` passes `isAncestor(sha)`.

Rules (from the spec):
- Any drop in reward rate, in a check rate or in acceptance/own-tests is `regression`.
- A judge median that drops by ≥ `judgeMedianDrop` is `regression`.
- A median tokens or agent-time rise above the threshold is a `regression` only if the candidate's
  minimum is above the baseline's maximum. Otherwise it is `noise`, which makes the verdict
  `inconclusive`.
- A new error class is `regression`.

The verdict is `worse` if there is any regression, else `inconclusive` if there is any noise, else
`better` if there is an improvement (a rate up, a judge median up by ≥ 1, or tokens or time down
beyond the threshold with non-overlapping ranges), else `same`.

- [ ] **Step 1: Write the failing test `e2e/lib/compare.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compareRuns, findBaseline } from './compare.mjs';
import { summarizeTrials } from './summary.mjs';

const TH = { tokensMedianRise: 0.5, agentTimeMedianRise: 0.5, judgeMedianDrop: 1 };
const trial = (o = {}) => ({ reward: 1, checks: { spec_comment: 1 }, acceptance: 1, ownTests: 1,
  tokens: { total: 100 }, durations: { agent: 10 }, judge: { requirements: 5 },
  errors: { harbor: null, bridge: null, tool: 0, timeout: false }, ...o });
const run = (trials, sha = 'a') => ({ trials, summary: summarizeTrials(trials), fingerprint: { adw: { sha } } });

test('identical runs are same', () => {
  const r = compareRuns(run([trial(), trial()]), run([trial(), trial()]), TH);
  assert.equal(r.verdict, 'same');
});

test('a dropped check rate is worse, and the fingerprint diff names the change', () => {
  const r = compareRuns(run([trial(), trial()], 'a'), run([trial(), trial({ checks: { spec_comment: 0 }, reward: 0 })], 'b'), TH);
  assert.equal(r.verdict, 'worse');
  assert.ok(r.signals.some((s) => s.signal === 'check:spec_comment' && s.kind === 'regression'));
  assert.deepEqual(r.fingerprintDiff, [{ key: 'adw.sha', from: 'a', to: 'b' }]);
});

test('token rise with overlapping ranges is inconclusive, disjoint ranges are worse', () => {
  const base = run([trial({ tokens: { total: 100 } }), trial({ tokens: { total: 400 } })]);
  const overlap = run([trial({ tokens: { total: 300 } }), trial({ tokens: { total: 500 } })]);
  assert.equal(compareRuns(base, overlap, TH).verdict, 'inconclusive');
  const disjoint = run([trial({ tokens: { total: 900 } }), trial({ tokens: { total: 1000 } })]);
  assert.equal(compareRuns(base, disjoint, TH).verdict, 'worse');
});

test('judge drop and new error class are regressions; improvements are better', () => {
  assert.equal(compareRuns(run([trial()]), run([trial({ judge: { requirements: 3 } })]), TH).verdict, 'worse');
  assert.equal(compareRuns(run([trial()]), run([trial({ errors: { harbor: null, bridge: 'x', tool: 0, timeout: false } })]), TH).verdict, 'worse');
  assert.equal(compareRuns(run([trial({ reward: 0, acceptance: 0 })]), run([trial()]), TH).verdict, 'better');
});

test('findBaseline picks the newest earlier run whose sha is on main', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    for (const [ts, sha] of [['2026-10-01T0900Z', 'old'], ['2026-10-02T0900Z', 'branch'], ['2026-10-03T0900Z', 'cand']]) {
      mkdirSync(path.join(dir, ts, 'codex'), { recursive: true });
      writeFileSync(path.join(dir, ts, 'codex', 'run.json'), JSON.stringify({ fingerprint: { adw: { sha } } }));
    }
    const found = findBaseline({ resultsDir: dir, harness: 'codex', before: '2026-10-03T0900Z', isAncestor: (s) => s === 'old' });
    assert.equal(found, path.join(dir, '2026-10-01T0900Z', 'codex'));
    assert.equal(findBaseline({ resultsDir: dir, harness: 'opencode', before: 'z', isAncestor: () => true }), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run it and verify that it fails**

Run: `node --test e2e/lib/compare.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `e2e/lib/compare.mjs`**

```js
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { diffFingerprints } from './fingerprint.mjs';

const range = (trials, pick) => {
  const v = trials.map(pick).filter((x) => typeof x === 'number');
  return v.length ? [Math.min(...v), Math.max(...v)] : null;
};

function numeric(signal, base, cand, pickTrial, threshold, out) {
  const b = base.summary.median[signal]; const c = cand.summary.median[signal];
  if (b == null || c == null || b === 0) return;
  const [bMin, bMax] = range(base.trials, pickTrial); const [cMin, cMax] = range(cand.trials, pickTrial);
  if (c > b * (1 + threshold)) out.push({ signal: `median:${signal}`, base: b, cand: c, kind: cMin > bMax ? 'regression' : 'noise' });
  else if (c < b * (1 - threshold)) out.push({ signal: `median:${signal}`, base: b, cand: c, kind: cMax < bMin ? 'improvement' : 'noise' });
}

export function compareRuns(base, cand, thresholds) {
  const signals = [];
  const rates = [['rewardRate', base.summary.rewardRate, cand.summary.rewardRate],
    ...Object.keys({ ...base.summary.checkRates, ...cand.summary.checkRates })
      .map((k) => [`check:${k}`, base.summary.checkRates[k] ?? 0, cand.summary.checkRates[k] ?? 0])];
  for (const [signal, b, c] of rates) {
    if (c < b) signals.push({ signal, base: b, cand: c, kind: 'regression' });
    else if (c > b) signals.push({ signal, base: b, cand: c, kind: 'improvement' });
  }
  for (const k of Object.keys(base.summary.judgeMedian)) {
    const b = base.summary.judgeMedian[k]; const c = cand.summary.judgeMedian[k];
    if (b == null || c == null) continue;
    if (b - c >= thresholds.judgeMedianDrop) signals.push({ signal: `judge:${k}`, base: b, cand: c, kind: 'regression' });
    else if (c - b >= 1) signals.push({ signal: `judge:${k}`, base: b, cand: c, kind: 'improvement' });
  }
  numeric('tokens', base, cand, (t) => t.tokens?.total, thresholds.tokensMedianRise, signals);
  numeric('agent', base, cand, (t) => t.durations?.agent, thresholds.agentTimeMedianRise, signals);
  for (const e of cand.summary.errorClasses) {
    if (!base.summary.errorClasses.includes(e)) signals.push({ signal: `error:${e}`, base: 0, cand: 1, kind: 'regression' });
  }
  const has = (k) => signals.some((s) => s.kind === k);
  const verdict = has('regression') ? 'worse' : has('noise') ? 'inconclusive' : has('improvement') ? 'better' : 'same';
  return { verdict, signals, fingerprintDiff: diffFingerprints(base.fingerprint, cand.fingerprint) };
}

export function findBaseline({ resultsDir, harness, before, isAncestor }) {
  if (!existsSync(resultsDir)) return null;
  for (const ts of readdirSync(resultsDir).filter((d) => d < before).sort().reverse()) {
    const file = path.join(resultsDir, ts, harness, 'run.json');
    if (!existsSync(file)) continue;
    const sha = JSON.parse(readFileSync(file, 'utf8')).fingerprint?.adw?.sha;
    if (sha && isAncestor(sha)) return path.dirname(file);
  }
  return null;
}
```

- [ ] **Step 4: Run the tests and verify that they pass**

Run: `node --test e2e/lib/compare.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add e2e/lib/compare.mjs e2e/lib/compare.test.mjs
git commit -m "feat(e2e): compare runs by rates, medians and fingerprint diff"
```

---

### Task 9: Demo repo with UI, task definition and verifier

**Files:**
- Modify: `package.json` (`scripts.test`)
- Create: `e2e/tasks/demo-todo/` (all files listed in the file structure). Port them from
  `spike/demo-todo/`, with the changes below.
- Test: `e2e/tasks/demo-todo/tests/checks.test.mjs`

**Interfaces:**
- Produces:
  - `evaluateContract({issue, comments, pulls, prDiff, appListening}) => Record<string, 0|1>` in
    `tests/checks.mjs`, with the verifier-side contract check names from Task 7.
  - The `reward.json` keys: those checks plus `own_tests_pass` and `acceptance`.
  - The evidence files in `/logs/verifier/`: `ticket.json`, `pulls.json`, `pr.diff`,
    `pr-commits.txt`, `acceptance.tap`, `acceptance-ui.txt`, `notes.txt`.

- [ ] **Step 1: Write the failing test `e2e/tasks/demo-todo/tests/checks.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateContract } from './checks.mjs';

const spec = `## Approved Spec\n${'x'.repeat(420)}`;
const good = {
  issue: { state: 'open', labels: [{ name: 'status:review' }] },
  comments: [{ body: spec }, { body: '## Implementation Summary\nEnd-to-end: tested with Playwright' }, { body: '## Cost Summary\n|a|' }],
  pulls: [{ title: 'WIP: 1: Due dates', merged: false, base: { ref: 'main' }, head: { ref: '1_due_dates' } }],
  prDiff: 'diff --git a/src/app.mjs b/src/app.mjs\n',
  appListening: false,
};

test('a correct run passes every verifier-side contract check', () => {
  const c = evaluateContract(good);
  assert.ok(Object.values(c).every((v) => v === 1), JSON.stringify(c));
  assert.equal(Object.keys(c).length, 12);
});

test('each deviation fails exactly its check', () => {
  const cases = [
    ['ticket_review', { issue: { state: 'open', labels: [{ name: 'status:new' }, { name: 'status:review' }] } }],
    ['ticket_open', { issue: { state: 'closed', labels: [{ name: 'status:review' }] } }],
    ['spec_comment_complete', { comments: [{ body: '## Approved Spec\n`spec.md`\n\n$(cat spec.md)' }, ...good.comments.slice(1)] }],
    ['summary_comment', { comments: [good.comments[0], { body: '## Implementation Summary\nDone.' }, good.comments[2]] }],
    ['only_allowed_comments', { comments: [...good.comments, { body: 'hello' }] }],
    ['pr_draft', { pulls: [{ ...good.pulls[0], title: '1: Due dates' }] }],
    ['branch_naming', { pulls: [{ ...good.pulls[0], head: { ref: 'feature/due' } }] }],
    ['app_stopped', { appListening: true }],
    ['no_screenshots_in_repo', { prDiff: 'diff --git a/shot.png b/shot.png\nnew file mode 100644\n' }],
  ];
  for (const [check, patch] of cases) {
    const c = evaluateContract({ ...good, ...patch });
    assert.equal(c[check], 0, check);
  }
});
```

- [ ] **Step 2: Run it and verify that it fails**

Run: `node --test e2e/tasks/demo-todo/tests/checks.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `e2e/tasks/demo-todo/tests/checks.mjs`**

```js
// agent-dev contract checks, evaluated from the Gitea state after a trial. Never asserts on
// superpowers internals.
const starts = (b, t) => b.trimStart().startsWith(`## ${t}`);

export function evaluateContract({ issue, comments, pulls, prDiff, appListening }) {
  const bodies = comments.map((c) => c.body);
  const status = issue.labels.map((l) => l.name).filter((n) => n.startsWith('status:'));
  const spec = bodies.filter((b) => starts(b, 'Approved Spec')).join('\n');
  const summary = bodies.find((b) => starts(b, 'Implementation Summary')) ?? '';
  const pr = pulls.length === 1 ? pulls[0] : null;
  const ok = (v) => (v ? 1 : 0);
  return {
    ticket_open: ok(issue.state === 'open'),
    ticket_review: ok(status.length === 1 && status[0] === 'status:review'),
    spec_comment: ok(spec !== ''),
    spec_comment_complete: ok(spec.length >= 400 && !/\$\(|\$\{/.test(spec)),
    summary_comment: ok(summary !== '' && /end[- ]to[- ]end|e2e/i.test(summary)),
    cost_comment: ok(bodies.some((b) => starts(b, 'Cost Summary'))),
    only_allowed_comments: ok(bodies.every((b) => /^## (Approved Spec|Implementation Summary|Cost Summary)/.test(b.trimStart()))),
    pr_draft: ok(pr && /^WIP:/i.test(pr.title) && pr.base?.ref === 'main' && !pr.merged),
    branch_naming: ok(/^1_[a-z0-9_]+$/.test(pr?.head?.ref ?? '')),
    pr_title_naming: ok(/^WIP:\s*1: \S/.test(pr?.title ?? '')),
    app_stopped: ok(!appListening),
    no_screenshots_in_repo: ok(!/^diff --git a\/\S+\.(png|jpe?g|webp|gif) /mi.test(prDiff)),
  };
}
```

- [ ] **Step 4: Run the test and verify that it passes**

Run: `node --test e2e/tasks/demo-todo/tests/checks.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Create the demo app with its UI (`environment/seed/repo/`)**

Copy `spike/demo-todo/environment/seed/repo/` (`package.json`, `src/store.mjs`, `src/server.mjs`,
`test/app.test.mjs`, `.gitignore`) **without** `ai-project.json`, `.claude/`, `.agents/` and
`.opencode/`. Then:

`src/app.mjs`: add the page route as the first handler line inside `try {`:

```js
      if (url.pathname === '/' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(await readFile(new URL('../public/index.html', import.meta.url)));
      }
```

Also add `import { readFile } from 'node:fs/promises';` at the top.

`public/index.html`:

```html
<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><title>demo-todo</title></head>
<body>
  <h1>Todos</h1>
  <ul data-testid="todo-list"></ul>
  <script type="module">
    const list = document.querySelector('[data-testid="todo-list"]');
    const todos = await (await fetch('/todos')).json();
    for (const todo of todos) {
      const li = document.createElement('li');
      li.dataset.testid = 'todo-item';
      const title = document.createElement('span');
      title.dataset.testid = 'todo-title';
      title.textContent = todo.title + (todo.done ? ' ✓' : '');
      li.append(title);
      list.append(li);
    }
  </script>
</body>
</html>
```

`test/app.test.mjs`: add one test:

```js
test('serves the list page', () =>
  withServer(async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /data-testid="todo-list"/);
  }));
```

`AGENTS.md` (demo repo): replace the spike's end-to-end section with:

```markdown
## End-to-end testing

- Services: none besides the app itself.
- Start: `PORT=3000 npm start &` from the repo root.
- Readiness: `GET http://localhost:3000/health` returns `{"ok":true}`.
- Base URL: `http://localhost:3000` — the todo list page is `/`; the JSON API is under `/todos`.
- Locators: every UI element tests rely on carries a `data-testid` attribute (existing:
  `todo-list`, `todo-item`, `todo-title`); give new elements one too.
- Drive the UI with the Playwright MCP tools; save screenshots outside the repository.
- Stop: kill the background `npm start` process.
```

Also change the Commands block to state that `npm start` serves the list page at `/`.

Run: `cd e2e/tasks/demo-todo/environment/seed/repo && npm test`
Expected: PASS (4 tests).

- [ ] **Step 6: Create the task files**

`seed/issue.md`:

```
Todos sollen ein Fälligkeitsdatum bekommen, damit man sieht, was überfällig ist – in der API und in der Liste.
```

`seed/answers.json`:

```json
{ "name": "demo-todo", "repoSlug": "adw/demo-todo", "backend": "gitea", "gitea": { "login": "e2e" }, "prTarget": "main" }
```

`instruction.md` is the spike version with an updated requirements list. Keep the opening message,
the fallback slash commands, the process answers and the end condition exactly as in
`spike/demo-todo/instruction.md`. Replace the requirements bullets with:

```markdown
- A todo gets an optional field `dueDate`, a calendar date in the form `YYYY-MM-DD` (no time).
- It can be set when creating (`POST /todos`) and changed or cleared (`null`) via `PATCH /todos/:id`.
- An invalid date (wrong format or impossible date like `2026-02-30`) is rejected with HTTP 400.
- `GET /todos?overdue=true` returns only todos that are not done and whose `dueDate` is before
  today (UTC). Todos without `dueDate` are never overdue.
- The list page shows each todo's due date next to its title.
- Overdue todos are visibly marked with the word "überfällig".
- The list page has a toggle labelled "nur überfällige" that shows only overdue todos (using the
  filter).
- Nothing else: no sorting, no reminders, no styling work.
```

The process answer for end-to-end stays: "the agent should test end to end".

`persona.md` and `bridge-prompt.md`: copy them unchanged from `spike/demo-todo/`.

`task.toml`: copy from the spike, then set `version = "1.0.0"` and
`description = "agent-dev end-to-end: due dates in API and list page via a Gitea ticket"`. Keep
`[agent] user = "dev"`, `timeout_sec = 3600.0`, `[environment] workdir = "/workspace"` and
`build_timeout_sec = 1200.0`.

`environment/gitea-init.sh` and `environment/docker-compose.yaml`: copy them unchanged from the
spike.

`environment/seed/seed.sh`: copy from the spike (the version that inits git in `/workspace`, pushes
it and appends `.acpxrc.json` to `.git/info/exclude`).

`environment/Dockerfile`:

```dockerfile
# E2E task image: the workflow image plus E2E-only tooling. The product image stays unchanged.
FROM ai-dev-workflow-node:latest
ARG TEA_VERSION=0.15.1
RUN curl -fsSL -o /usr/local/bin/tea "https://dl.gitea.com/tea/${TEA_VERSION}/tea-${TEA_VERSION}-linux-amd64" \
    && chmod 0755 /usr/local/bin/tea \
    # Harbor npm-installs its ACP bridge/adapters as the agent user at runtime: preinstall the
    # versions Harbor 0.24.0 pins and let the agent user own the global prefix.
    && npm install -g acpx@0.11.2 @zed-industries/claude-code-acp@0.16.2 @agentclientprotocol/codex-acp@1.12.0 \
    && chown -R 1000:1000 /usr/local/lib/node_modules /usr/local/bin \
    && mkdir -p /opt/e2e
COPY --chown=1000:1000 seed/repo /workspace
COPY seed/issue.md /opt/e2e/issue.md
COPY seed/seed.sh /usr/local/lib/agent-runtime/startup.d/50-e2e-seed
RUN chmod 0755 /usr/local/lib/agent-runtime/startup.d/50-e2e-seed
ENV PROJECT_ROOT=/workspace
WORKDIR /workspace
HEALTHCHECK --interval=3s --timeout=3s --retries=100 CMD test -f /tmp/e2e-ready
```

- [ ] **Step 7: Create the hidden acceptance tests**

`tests/acceptance.test.mjs`: the spike's file **without** the skipped "no `dueDate` key" test. Keep
the remaining four API tests exactly.

`tests/acceptance-ui.mjs`:

```js
// Hidden UI acceptance test. It uses only visible text and roles, never agent-chosen markup.
// Run: node acceptance-ui.mjs <baseUrl>. Prints TAP-like lines; exit code 0 means all passed.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/agent-tools/package.json')('playwright');

const base = process.argv[2];
const day = (o) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10);
const post = (b) => fetch(`${base}/todos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
await post({ title: 'Rechnung zahlen', dueDate: day(-2) });
await post({ title: 'Urlaub planen', dueDate: day(10) });
await post({ title: 'Ohne Datum' });

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(`ok - ${name}`); } catch (e) { results.push(`not ok - ${name}: ${e.message.split('\n')[0]}`); }
};
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(base);
  const item = (title) => page.getByRole('listitem').filter({ hasText: title });
  await check('due dates are shown', async () => {
    await item('Rechnung zahlen').getByText(day(-2)).waitFor({ timeout: 5000 });
    await item('Urlaub planen').getByText(day(10)).waitFor({ timeout: 5000 });
  });
  await check('overdue todo is marked "überfällig", others are not', async () => {
    await item('Rechnung zahlen').getByText(/überfällig/i).waitFor({ timeout: 5000 });
    if (await item('Urlaub planen').getByText(/überfällig/i).count()) throw new Error('future todo marked overdue');
  });
  await check('"nur überfällige" toggle filters the list', async () => {
    const toggle = page.getByLabel(/nur überfällige/i).or(page.getByRole('button', { name: /nur überfällige/i })).first();
    await toggle.click();
    await page.waitForTimeout(500);
    if (!(await item('Rechnung zahlen').count())) throw new Error('overdue todo hidden');
    if (await item('Urlaub planen').count()) throw new Error('future todo still shown');
  });
} finally {
  await browser.close();
}
console.log(results.join('\n'));
process.exit(results.every((r) => r.startsWith('ok')) ? 0 : 1);
```

- [ ] **Step 8: Write `tests/verify.mjs` (IO wrapper around `checks.mjs`) and `tests/test.sh`**

```js
// Harbor verifier: Gitea contract checks, own tests and hidden API+UI acceptance on the PR head.
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluateContract } from './checks.mjs';

const OUT = '/logs/verifier';
const TOKEN = readFileSync('/shared/token', 'utf8').trim();
const API = 'http://gitea:3000/api/v1/repos/adw/demo-todo';
const get = async (p) => {
  const res = await fetch(`${API}${p}`, { headers: { authorization: `token ${TOKEN}` } });
  if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
  return res.json();
};
const write = (f, d) => writeFileSync(path.join(OUT, f), typeof d === 'string' ? d : JSON.stringify(d, null, 2));
const run = (cwd, cmd, args, env = {}) => {
  try { return { ok: true, out: execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, ...env } }) }; }
  catch (e) { return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }; }
};
const listening = async (url) => { try { await fetch(url, { signal: AbortSignal.timeout(1500) }); return true; } catch { return false; } };

const issue = await get('/issues/1');
const comments = await get('/issues/1/comments');
const pulls = await get('/pulls?state=all');
write('ticket.json', { issue: { state: issue.state, labels: issue.labels.map((l) => ({ name: l.name })) },
  comments: comments.map((c) => ({ body: c.body, created_at: c.created_at })) });
write('pulls.json', pulls.map((p) => ({ title: p.title, merged: p.merged, state: p.state, base: { ref: p.base.ref }, head: { ref: p.head.ref } })));

let prDiff = ''; let ownTests = 0; let acceptance = 0;
const pr = pulls[0];
if (pr) {
  const dir = mkdtempSync(path.join(tmpdir(), 'acc-'));
  execFileSync('git', ['clone', '-q', '-b', pr.head.ref, `http://adw:${TOKEN}@gitea:3000/adw/demo-todo.git`, dir]);
  prDiff = execFileSync('git', ['-C', dir, 'diff', 'origin/main...HEAD'], { encoding: 'utf8' });
  write('pr.diff', prDiff);
  write('pr-commits.txt', execFileSync('git', ['-C', dir, 'log', '--format=%h %s', 'origin/main..HEAD'], { encoding: 'utf8' }));
  ownTests = run(dir, 'node', ['--test']).ok ? 1 : 0;
  copyFileSync('/tests/acceptance.test.mjs', path.join(dir, 'test', 'zz-acceptance.test.mjs'));
  const api = run(dir, 'node', ['--test', '--test-reporter=tap', 'test/zz-acceptance.test.mjs']);
  write('acceptance.tap', api.out);
  const apiPass = Number(/^# pass (\d+)/m.exec(api.out)?.[1] ?? 0);
  const apiTotal = Number(/^# tests (\d+)/m.exec(api.out)?.[1] ?? 0);
  const server = spawn('node', ['src/server.mjs'], { cwd: dir, env: { ...process.env, PORT: '3100' }, stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await listening('http://127.0.0.1:3100/health')); i++) await new Promise((r) => setTimeout(r, 200));
  const ui = run(dir, 'node', ['/tests/acceptance-ui.mjs', 'http://127.0.0.1:3100']);
  server.kill();
  write('acceptance-ui.txt', ui.out);
  const uiPass = (ui.out.match(/^ok - /gm) ?? []).length;
  const uiTotal = uiPass + (ui.out.match(/^not ok - /gm) ?? []).length || 3;
  acceptance = Number(((apiPass + uiPass) / (apiTotal + uiTotal)).toFixed(4));
}

const checks = evaluateContract({ issue, comments, pulls, prDiff, appListening: await listening('http://127.0.0.1:3000/health') });
const reward = { ...checks, own_tests_pass: ownTests, acceptance };
write('reward.json', reward);
write('notes.txt', Object.entries(reward).filter(([, v]) => v !== 1).map(([k, v]) => `${k}=${v}`).join('\n'));
console.log(JSON.stringify(reward, null, 2));
```

```bash
#!/bin/bash
# Harbor verifier entry.
node /tests/verify.mjs
```

The API pass ratio already excludes skipped tests, because the skipped test is removed.

- [ ] **Step 9: Extend `package.json` `scripts.test` and run the unit tests**

```json
"test": "node --test agent-src/*.test.mjs agent-src/lib/*.test.mjs e2e/lib/*.test.mjs e2e/tasks/demo-todo/tests/*.test.mjs"
```

Run: `npm test`
Expected: PASS (all agent-src tests, `e2e/lib/*` tests and `checks.test.mjs`).

- [ ] **Step 10: Commit**

```bash
git add e2e/tasks/demo-todo package.json
git commit -m "feat(e2e): add demo-todo task with list page, Gitea seed and contract verifier"
```

---

### Task 10: Harbor custom agents

**Files:**
- Create: `e2e/agents/__init__.py`, `e2e/agents/claude_subscription.py`,
  `e2e/agents/codex_subscription.py`, `e2e/agents/opencode_subscription.py`

**Interfaces:**
- Consumes these host environment variables, set by the runner in Task 12:
  - `CLAUDE_CODE_OAUTH_TOKEN`, `E2E_CLAUDE_SUBAGENT_MODEL`;
  - `CODEX_AUTH_JSON_PATH`;
  - `OPENCODE_AUTH_JSON_PATH`.
- Produces: the import paths `agents.claude_subscription:ClaudeSubscription`,
  `agents.codex_subscription:CodexSubscription` and
  `agents.opencode_subscription:OpenCodeSubscription`, with `PYTHONPATH=e2e`.

There are no unit tests: the classes are thin overrides of Harbor internals, and Task 14's live run
verifies them.

- [ ] **Step 1: Copy the three classes from `spike/agents/`**

Copy them verbatim from `spike/agents/` (the versions that worked in the final series), plus an
empty `__init__.py`.

- [ ] **Step 2: Add the subagent model to `ClaudeSubscription.acp_command`**

Replace the body of `acp_command` in `claude_subscription.py` with:

```python
    @override
    def acp_command(self) -> list[str]:
        inner = " ".join(shlex.quote(part) for part in super().acp_command())
        subagent = os.environ.get("E2E_CLAUDE_SUBAGENT_MODEL", "").strip()
        sub = f"CLAUDE_CODE_SUBAGENT_MODEL={shlex.quote(subagent)} " if subagent else ""
        script = f'CLAUDE_CODE_OAUTH_TOKEN="$(cat {TOKEN_PATH})" {sub}exec {inner}'
        return ["sh", "-c", script]
```

- [ ] **Step 3: Force the pinned superpowers for Codex under ACP**

At the end of `CodexSubscription.acp_install` (after uploading `auth.json`), register the image's
managed marketplace in the ACP `CODEX_HOME` and disable OpenAI's curated copy. `launch-agent.mjs
--configure` has already created `~/.cache/ai-dev-workflow/codex-marketplace` at container start.

```python
        home = self._REMOTE_ACP_CODEX_HOME.as_posix()
        real_codex = "/opt/agent-tools/node_modules/.bin/codex"
        marketplace = "/home/dev/.cache/ai-dev-workflow/codex-marketplace"
        await self.exec_as_agent(
            environment,
            command=(
                f"set -e; export CODEX_HOME={home}; "
                f"name=$(node -p \"require('{marketplace}/.claude-plugin/marketplace.json').name\"); "
                f"{real_codex} plugin marketplace add {marketplace} --json >/dev/null; "
                f"{real_codex} plugin add superpowers@$name --json >/dev/null; "
                f"printf '\\n[plugins.\"superpowers@openai-curated-remote\"]\\nenabled = false\\n' >> {home}/config.toml"
            ),
        )
```

Verify in Task 14: in a Codex trial, `grep -r "plugins/cache/openai-curated-remote/superpowers"` over
the rollout returns nothing, and the rollout references the managed marketplace path. If Codex
rejects the `enabled = false` table, remove that line and record in the spec's open questions that
the curated copy can only be shadowed, not disabled.

- [ ] **Step 4: Check that the Python is syntactically valid**

Run: `python3 -c "import ast,sys; [ast.parse(open(f).read()) for f in sys.argv[1:]]" e2e/agents/*.py && echo ok`
Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add e2e/agents
git commit -m "feat(e2e): add Harbor subscription agents with pinned superpowers for Codex"
```

---

### Task 11: Secrets, Harbor invocation and preflight

**Files:**
- Create: `e2e/lib/secrets.mjs` (+test), `e2e/lib/harbor.mjs` (+test), `e2e/lib/preflight.mjs` (+test)

**Interfaces:**
- Consumes: `harnessVersion`, `loadConfig` (Task 1).
- Produces:
  - `stageSecrets({config, invocationDir}) => {env: object, values: string[], cleanup: () => void}`.
    `env` carries `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_FORCE_OAUTH=1`, `CODEX_AUTH_JSON_PATH` and
    `OPENCODE_AUTH_JSON_PATH` (the copies, mode 0600). `values` are the secret strings for scanning.
  - `scanForSecrets(dir, values) => string[]`: the files that contain any value.
  - `buildHarborArgs({config, harness, jobName, jobsDir}) => string[]`.
  - `runHarbor({args, env, cwd, spawn?}) => Promise<number>`: the exit code.
  - `cleanupCompose({exec?})`: removes `demo-todo__*` compose projects.
  - `runPreflight({config, harnesses, exec?, probe?, authPresent, platform?, root?}) => {ok: boolean, problems: string[], warnings: string[]}`.
    - `platform` defaults to `process.platform` and `root` to `config.root`.
    - On native Windows (`win32`) it returns only the problem "run in WSL2" and skips every other check.
    - A repo under `/mnt/<drive>/` adds a warning (file modes and CRLF line endings break the task).

- [ ] **Step 1: Write the failing tests**

`e2e/lib/secrets.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stageSecrets, scanForSecrets } from './secrets.mjs';

test('stageSecrets copies auth files 0600, exposes env and cleans up', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    writeFileSync(path.join(dir, '.env'), 'CLAUDE_CODE_OAUTH_TOKEN=tok-123\n');
    writeFileSync(path.join(dir, 'codex.json'), '{"tokens":{"access_token":"cx-9"}}');
    writeFileSync(path.join(dir, 'oc.json'), '{"mistral":{"type":"api","key":"mk-7"}}');
    const config = { root: dir, auth: { claudeEnvFile: '.env', codexAuthJson: path.join(dir, 'codex.json'), opencodeAuthJson: path.join(dir, 'oc.json') } };
    const s = stageSecrets({ config, invocationDir: path.join(dir, 'inv') });
    assert.equal(s.env.CLAUDE_CODE_OAUTH_TOKEN, 'tok-123');
    assert.equal(s.env.CLAUDE_FORCE_OAUTH, '1');
    assert.equal(statSync(s.env.CODEX_AUTH_JSON_PATH).mode & 0o777, 0o600);
    assert.equal(readFileSync(s.env.OPENCODE_AUTH_JSON_PATH, 'utf8'), '{"mistral":{"type":"api","key":"mk-7"}}');
    assert.ok(s.values.includes('tok-123') && s.values.includes('cx-9') && s.values.includes('mk-7'));
    s.cleanup();
    assert.equal(existsSync(s.env.CODEX_AUTH_JSON_PATH), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('scanForSecrets finds leaked values', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    mkdirSync(path.join(dir, 'e'));
    writeFileSync(path.join(dir, 'e/a.txt'), 'clean');
    writeFileSync(path.join(dir, 'e/b.txt'), 'oops tok-123');
    assert.deepEqual(scanForSecrets(dir, ['tok-123']), [path.join(dir, 'e/b.txt')]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

`e2e/lib/harbor.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildHarborArgs } from './harbor.mjs';
import { loadConfig } from './config.mjs';

test('harbor args pin agent, model, version and the constrained simulated user', () => {
  const config = loadConfig();
  const a = buildHarborArgs({ config, harness: 'codex', jobName: 'codex-1', jobsDir: '/j' });
  const pair = (flag) => a[a.indexOf(flag) + 1];
  assert.equal(a[0], 'run');
  assert.equal(pair('-a'), 'agents.codex_subscription:CodexSubscription');
  assert.equal(pair('-m'), 'openai/gpt-6.1-sol');
  const pin = JSON.parse(readFileSync(new URL('../../docker/tools/inventory.json', import.meta.url), 'utf8')).npmPackages['@openai/codex'];
  assert.ok(a.includes(`version=${pin}`));
  assert.ok(a.includes('reasoning_effort=high'));
  assert.equal(pair('--user-model'), 'claude-haiku-4-5-20251001');
  assert.ok(a.includes('disallowed_tools=Skill,Edit,Write,NotebookEdit,Task'));
  assert.equal(pair('--bridge'), 'acp');
  assert.equal(pair('--job-name'), 'codex-1');
  assert.equal(pair('-o'), '/j');
  assert.match(pair('-p'), /e2e\/tasks\/demo-todo$/);
});
```

`e2e/lib/preflight.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPreflight } from './preflight.mjs';
import { loadConfig, harnessVersion } from './config.mjs';

const config = loadConfig();
const versions = { claude: harnessVersion(config, 'claude-code'), codex: harnessVersion(config, 'codex'), opencode: harnessVersion(config, 'opencode') };
const exec = (cmd, args) => {
  const k = `${cmd} ${args.join(' ')}`;
  if (k === 'harbor --version') return '0.24.0';
  if (k === 'docker info --format {{.ServerVersion}}') return '29.8.1';
  if (k.startsWith('docker image inspect')) return 'sha256:x';
  if (k.startsWith('docker run')) return `${versions.claude} (Claude Code)\ncodex-cli ${versions.codex}\n${versions.opencode}\n`;
  throw new Error(k);
};

test('preflight passes when everything matches', () => {
  const r = runPreflight({ config, harnesses: ['codex'], exec, probe: () => null, authPresent: () => true, platform: 'linux', root: '/home/u/src/adw' });
  assert.deepEqual(r, { ok: true, problems: [], warnings: [] });
});

test('preflight refuses native Windows and warns for a repo on a Windows drive under WSL', () => {
  const win = runPreflight({ config, harnesses: ['codex'], exec: () => { throw new Error('must not run'); },
    probe: () => null, authPresent: () => true, platform: 'win32', root: 'C:\\src\\adw' });
  assert.equal(win.ok, false);
  assert.deepEqual(win.problems, ['native Windows is not supported: run the E2E self-test inside WSL2 (see docs/adw-e2e/README.md)']);
  const mnt = runPreflight({ config, harnesses: ['codex'], exec, probe: () => null, authPresent: () => true, platform: 'linux', root: '/mnt/c/src/adw' });
  assert.equal(mnt.ok, true);
  assert.match(mnt.warnings[0], /\/mnt\/c/);
});

test('preflight reports version drift, missing auth and failing model probes', () => {
  const bad = (cmd, args) => (cmd === 'harbor' ? '0.25.0' : exec(cmd, args));
  const r = runPreflight({ config, harnesses: ['codex', 'claude-code'], exec: bad, platform: 'linux', root: '/home/u/adw',
    probe: (h) => (h === 'codex' ? 'model not supported' : null), authPresent: (h) => h !== 'claude-code' });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /harbor 0.25.0/.test(p)));
  assert.ok(r.problems.some((p) => /claude-code: login missing/.test(p)));
  assert.ok(r.problems.some((p) => /codex: model probe failed: model not supported/.test(p)));
});
```

- [ ] **Step 2: Run them and verify that they fail**

Run: `node --test e2e/lib/secrets.test.mjs e2e/lib/harbor.test.mjs e2e/lib/preflight.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `e2e/lib/secrets.mjs`**

```js
import { copyFileSync, chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { walk } from './fsutil.mjs';

const expand = (p, root) => (p.startsWith('~/') ? path.join(homedir(), p.slice(2)) : path.resolve(root, p));

function leafStrings(value) {
  if (typeof value === 'string') return value.length >= 8 ? [value] : [];
  if (value && typeof value === 'object') return Object.values(value).flatMap(leafStrings);
  return [];
}

export function stageSecrets({ config, invocationDir }) {
  const dir = path.join(invocationDir, '.secrets');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const env = { CLAUDE_FORCE_OAUTH: '1' }; const values = [];
  const envFile = expand(config.auth.claudeEnvFile, config.root);
  const token = existsSync(envFile)
    ? readFileSync(envFile, 'utf8').match(/^CLAUDE_CODE_OAUTH_TOKEN=(.+)$/m)?.[1].trim() : process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (token) { env.CLAUDE_CODE_OAUTH_TOKEN = token; values.push(token); }
  for (const [key, src, name] of [['CODEX_AUTH_JSON_PATH', config.auth.codexAuthJson, 'codex-auth.json'],
    ['OPENCODE_AUTH_JSON_PATH', config.auth.opencodeAuthJson, 'opencode-auth.json']]) {
    const from = expand(src, config.root);
    if (!existsSync(from)) continue;
    const to = path.join(dir, name);
    copyFileSync(from, to); chmodSync(to, 0o600);
    env[key] = to; values.push(...leafStrings(JSON.parse(readFileSync(to, 'utf8'))));
  }
  return { env, values, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function scanForSecrets(dir, values) {
  const needles = values.filter((v) => v.length >= 8);
  return walk(dir).filter((f) => { const text = readFileSync(f, 'utf8'); return needles.some((n) => text.includes(n)); });
}
```

- [ ] **Step 4: Implement `e2e/lib/harbor.mjs`**

```js
import { execFileSync, spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';
import { harnessVersion } from './config.mjs';

export function buildHarborArgs({ config, harness, jobName, jobsDir }) {
  const h = config.harnesses[harness]; const u = config.simulatedUser;
  const task = path.join(config.root, 'e2e', config.task);
  return ['run', '-p', task, '-a', h.agent, '-m', h.model,
    '--ak', `version=${harnessVersion(config, harness)}`,
    ...Object.entries(h.agentKwargs).flatMap(([k, v]) => ['--ak', `${k}=${v}`]),
    '--user-agent', u.agent, '--user-model', u.model,
    '--uk', `disallowed_tools=${u.disallowedTools}`, '--uk', `append_system_prompt=${u.appendSystemPrompt}`,
    '--user-persona-path', path.join(task, 'persona.md'),
    '--bridge', 'acp', '--bridge-prompt-path', path.join(task, 'bridge-prompt.md'),
    '-o', jobsDir, '--job-name', jobName];
}

export function runHarbor({ args, env, cwd, spawn = nodeSpawn, logStream }) {
  return new Promise((resolve) => {
    const child = spawn('harbor', args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.pipe(logStream ?? process.stdout, { end: false });
    child.stderr?.pipe(logStream ?? process.stderr, { end: false });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

export function cleanupCompose({ exec = (c, a) => execFileSync(c, a, { encoding: 'utf8' }) } = {}) {
  const projects = new Set(exec('docker', ['ps', '-a', '--format', '{{.Label "com.docker.compose.project"}}'])
    .split('\n').filter((p) => p.startsWith('demo-todo__')));
  for (const p of projects) {
    try { exec('docker', ['compose', '-p', p, 'down', '-v', '--remove-orphans']); } catch { /* already gone */ }
  }
  return [...projects];
}
```

- [ ] **Step 5: Implement `e2e/lib/preflight.mjs`**

```js
import { execFileSync, spawnSync } from 'node:child_process';
import { harnessVersion } from './config.mjs';

const defaultExec = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// One-line model probe through the host CLI of each harness; returns an error string or null.
export function defaultProbe(harness, config) {
  const h = config.harnesses[harness];
  const [cmd, args] = harness === 'claude-code' ? ['claude', ['-p', '--model', h.model, 'Antworte nur mit OK']]
    : harness === 'codex' ? ['codex', ['exec', '--skip-git-repo-check', '-m', h.model.split('/').pop(), 'Antworte nur mit OK']]
      : ['opencode', ['run', '-m', h.model, 'Antworte nur mit OK']];
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 180000 });
  const out = `${r.stdout}${r.stderr}`;
  return r.status === 0 && /OK/.test(out) && !/not supported|error/i.test(out.split('OK')[1] ?? '') ? null
    : (out.match(/"message":"([^"]+)"/)?.[1] ?? out.trim().split('\n').at(-1) ?? `exit ${r.status}`);
}

export function runPreflight({ config, harnesses, exec = defaultExec, probe = (h) => defaultProbe(h, config), authPresent,
  platform = process.platform, root = config.root }) {
  if (platform === 'win32') {
    return { ok: false, problems: ['native Windows is not supported: run the E2E self-test inside WSL2 (see docs/adw-e2e/README.md)'], warnings: [] };
  }
  const problems = []; const warnings = [];
  const drive = root.match(/^\/mnt\/[a-z](\/|$)/i)?.[0];
  if (drive) warnings.push(`repo lives on a Windows drive (${drive.replace(/\/$/, '')}): clone it inside the WSL filesystem — file modes and CRLF line endings break the task`);
  const tryExec = (cmd, args) => { try { return exec(cmd, args).trim(); } catch (e) { problems.push(`${cmd} ${args[0]}: ${e.message.split('\n')[0]}`); return null; } };
  const harbor = tryExec('harbor', ['--version']);
  if (harbor && harbor !== config.harbor.version) problems.push(`harbor ${harbor} installed, ${config.harbor.version} required (uv tool install harbor==${config.harbor.version})`);
  tryExec('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (tryExec('docker', ['image', 'inspect', '--format', '{{.Id}}', config.image])) {
    const out = tryExec('docker', ['run', '--rm', '-e', 'AGENT_TOOLSTACK_ONLY=1', '--entrypoint', 'bash', config.image, '-lc',
      'claude --version; codex --version; opencode --version']) ?? '';
    for (const h of harnesses) {
      const v = harnessVersion(config, h);
      if (!out.includes(v)) problems.push(`${h}: image does not carry pinned ${v} (rebuild with node docker/build.mjs)`);
    }
  }
  for (const h of harnesses) {
    if (!authPresent(h)) { problems.push(`${h}: login missing`); continue; }
    const err = probe(h);
    if (err) problems.push(`${h}: model probe failed: ${err}`);
  }
  return { ok: problems.length === 0, problems, warnings };
}
```

- [ ] **Step 6: Run the tests and verify that they pass**

Run: `node --test e2e/lib/secrets.test.mjs e2e/lib/harbor.test.mjs e2e/lib/preflight.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add e2e/lib/secrets.mjs e2e/lib/secrets.test.mjs e2e/lib/harbor.mjs e2e/lib/harbor.test.mjs e2e/lib/preflight.mjs e2e/lib/preflight.test.mjs
git commit -m "feat(e2e): stage secrets, build harbor invocations and preflight checks"
```

---

### Task 12: Reports and the `run.mjs` CLI

**Files:**
- Create: `e2e/lib/report.mjs`, `e2e/lib/report.test.mjs`, `e2e/run.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `renderRunReport(run) => string`, `renderSummary(runsByHarness) => string`,
    `renderCompare({harness, base, cand, result}) => string`.
  - The CLI:
    - `node e2e/run.mjs preflight [--harness h]`
    - `node e2e/run.mjs run [--harness h] [--repetitions n]`
    - `node e2e/run.mjs compare <baseDir> <candDir>`
    - `node e2e/run.mjs report <harnessDir>`: re-renders `report.md` from `run.json`.

- [ ] **Step 1: Write the failing test `e2e/lib/report.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRunReport, renderSummary, renderCompare } from './report.mjs';
import { summarizeTrials } from './summary.mjs';

const trial = { id: 'codex-1', reward: 1, contract: 1, checks: { spec_comment: 1, e2e_performed: 1 }, acceptance: 1, ownTests: 1,
  judge: { requirements: 5 }, judgeReasons: { requirements: 'all captured' }, durations: { agent: 225, total: 287 },
  tokens: { total: 916414 }, errors: { harbor: null, bridge: null, tool: 1, timeout: false }, soft: { superpowersActive: true } };
const run = { harness: 'codex', config: { model: 'openai/gpt-6.1-sol' }, fingerprint: { adw: { version: '0.24.0', sha: 'abc' } },
  trials: [trial], summary: summarizeTrials([trial]) };

test('run report shows summary, checks, trials and judge reasons', () => {
  const md = renderRunReport(run);
  for (const s of ['# E2E codex', 'openai/gpt-6.1-sol', '| spec_comment | 1 |', 'codex-1', '916,414', 'all captured', 'superpowers active: yes'])
    assert.ok(md.includes(s), s);
});

test('summary puts harnesses side by side', () => {
  const md = renderSummary({ codex: run, opencode: { ...run, harness: 'opencode' } });
  assert.match(md, /\| codex \| 1 \|/);
  assert.match(md, /\| opencode \| 1 \|/);
});

test('compare report shows verdict, signals and fingerprint diff', () => {
  const md = renderCompare({ harness: 'codex', base: '/b', cand: '/c', result: { verdict: 'worse',
    signals: [{ signal: 'check:spec_comment', base: 1, cand: 0.67, kind: 'regression' }],
    fingerprintDiff: [{ key: 'skill.codex', from: 'h1', to: 'h2' }] } });
  for (const s of ['**worse**', 'check:spec_comment', 'regression', 'skill.codex']) assert.ok(md.includes(s), s);
});
```

- [ ] **Step 2: Run it and verify that it fails**

Run: `node --test e2e/lib/report.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `e2e/lib/report.mjs`**

```js
const n = (v) => (typeof v === 'number' ? v.toLocaleString('en-US') : v ?? '—');

export function renderRunReport(run) {
  const s = run.summary;
  const lines = [`# E2E ${run.harness}`, '',
    `Model: \`${run.config.model}\` · adw ${run.fingerprint.adw.version} (${String(run.fingerprint.adw.sha).slice(0, 7)}) · trials: ${run.trials.length}`, '',
    '## Summary', '', '| Signal | Value |', '|---|---|',
    `| reward rate | ${s.rewardRate} |`, `| median tokens | ${n(s.median.tokens)} |`, `| median agent time (s) | ${n(s.median.agent)} |`,
    ...Object.entries(s.judgeMedian).map(([k, v]) => `| judge ${k} (median) | ${n(v)} |`),
    `| error classes | ${s.errorClasses.join(', ') || 'none'} |`, '',
    '## Check pass rates', '', '| Check | Rate |', '|---|---|',
    ...Object.entries(s.checkRates).map(([k, v]) => `| ${k} | ${v} |`), '', '## Trials', ''];
  for (const t of run.trials) {
    lines.push(`### ${t.id}`, '',
      `reward ${t.reward} · contract ${t.contract} · acceptance ${t.acceptance} · own tests ${t.ownTests} · tokens ${n(t.tokens?.total)} · agent ${n(t.durations?.agent)} s · tool errors ${t.errors?.tool ?? 0}${t.errors?.bridge ? ` · ${t.errors.bridge}` : ''}${t.errors?.harbor ? ` · harbor: ${t.errors.harbor}` : ''}`,
      `superpowers active: ${t.soft?.superpowersActive ? 'yes' : 'no'}`, '',
      `Failed checks: ${Object.entries(t.checks).filter(([, v]) => v !== 1).map(([k]) => k).join(', ') || 'none'}`, '');
    for (const [k, r] of Object.entries(t.judgeReasons ?? {})) lines.push(`- judge ${k} ${t.judge?.[k]}: ${r}`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function renderSummary(runs) {
  const rows = Object.values(runs).map((r) => `| ${r.harness} | ${r.summary.rewardRate} | ${n(r.summary.median.tokens)} | ${n(r.summary.median.agent)} | ${Object.values(r.summary.judgeMedian).map(n).join(' / ')} | ${r.summary.errorClasses.join(', ') || 'none'} |`);
  return `# E2E summary\n\n| Harness | Reward rate | Median tokens | Median agent s | Judge medians | Errors |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
}

export function renderCompare({ harness, base, cand, result }) {
  return [`# Compare ${harness}: **${result.verdict}**`, '', `Baseline: \`${base}\``, `Candidate: \`${cand}\``, '',
    '## Signals', '', '| Signal | Baseline | Candidate | Kind |', '|---|---|---|---|',
    ...(result.signals.length ? result.signals.map((s) => `| ${s.signal} | ${n(s.base)} | ${n(s.cand)} | ${s.kind} |`) : ['| — | | | |']), '',
    '## What changed (fingerprint diff)', '',
    ...(result.fingerprintDiff.length ? result.fingerprintDiff.map((d) => `- \`${d.key}\`: ${d.from} → ${d.to}`) : ['- nothing']), ''].join('\n');
}
```

- [ ] **Step 4: Run the test and verify that it passes**

Run: `node --test e2e/lib/report.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement `e2e/run.mjs`**

```js
#!/usr/bin/env node
// ADW E2E self-test CLI. See docs/adw-e2e/README.md.
import { execFileSync } from 'node:child_process';
import { cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from './lib/config.mjs';
import { buildFingerprint } from './lib/fingerprint.mjs';
import { buildHarborArgs, cleanupCompose, runHarbor } from './lib/harbor.mjs';
import { runPreflight } from './lib/preflight.mjs';
import { stageSecrets, scanForSecrets } from './lib/secrets.mjs';
import { buildTrialRecord } from './lib/trial.mjs';
import { summarizeTrials } from './lib/summary.mjs';
import { compareRuns, findBaseline } from './lib/compare.mjs';
import { renderCompare, renderRunReport, renderSummary } from './lib/report.mjs';

const config = loadConfig();
const { positionals, values: opts } = parseArgs({ allowPositionals: true,
  options: { harness: { type: 'string', multiple: true }, repetitions: { type: 'string' } } });
const [command, ...rest] = positionals;
const harnesses = opts.harness?.length ? opts.harness : Object.keys(config.harnesses);
const task = path.join(config.root, 'e2e', config.task);
const demoRepo = path.join(task, 'environment/seed/repo');
const git = (...a) => execFileSync('git', a, { cwd: config.root, encoding: 'utf8' }).trim();
const timestamp = () => new Date().toISOString().replace(/:\d\d\.\d+Z$/, 'Z').replace(/:/g, '');

function preflight() {
  const staged = stageSecrets({ config, invocationDir: path.join(config.root, config.jobsDir, 'preflight') });
  const has = { 'claude-code': 'CLAUDE_CODE_OAUTH_TOKEN', codex: 'CODEX_AUTH_JSON_PATH', opencode: 'OPENCODE_AUTH_JSON_PATH' };
  const r = runPreflight({ config, harnesses, authPresent: (h) => Boolean(staged.env[has[h]]) });
  staged.cleanup();
  for (const w of r.warnings ?? []) console.warn(`! ${w}`);
  for (const p of r.problems) console.error(`✗ ${p}`);
  console.log(r.ok ? 'preflight ok' : 'preflight failed');
  return r.ok;
}

function compareDirs(baseDir, candDir) {
  const read = (d) => JSON.parse(readFileSync(path.join(d, 'run.json'), 'utf8'));
  const base = read(baseDir); const cand = read(candDir);
  const result = compareRuns(base, cand, config.thresholds);
  writeFileSync(path.join(candDir, 'compare.md'), renderCompare({ harness: cand.harness, base: baseDir, cand: candDir, result }));
  console.log(`${cand.harness}: ${result.verdict} (${path.join(candDir, 'compare.md')})`);
  return result;
}

async function run() {
  if (!preflight()) process.exit(1);
  rmSync(path.join(demoRepo, 'ai-project.json'), { force: true }); // init --answers needs a fresh tree
  execFileSync('node', ['agent-src/generate.mjs', 'init', '--answers', path.join(task, 'environment/seed/answers.json'), '--root', demoRepo],
    { cwd: config.root, stdio: 'inherit', input: '' });
  execFileSync('node', ['agent-src/generate.mjs', 'generate', '--root', demoRepo], { cwd: config.root, stdio: 'inherit' });
  const ts = timestamp();
  const jobsDir = path.join(config.root, config.jobsDir, ts);
  const outRoot = path.join(config.root, config.resultsDir, ts);
  mkdirSync(jobsDir, { recursive: true });
  const staged = stageSecrets({ config, invocationDir: jobsDir });
  const briefing = readFileSync(path.join(task, 'instruction.md'), 'utf8');
  const repetitions = Number(opts.repetitions ?? config.repetitions);
  const runs = {};
  const onExit = () => { staged.cleanup(); cleanupCompose(); };
  process.on('SIGINT', () => { onExit(); process.exit(130); });
  try {
    for (const harness of harnesses) {
      const fingerprint = buildFingerprint({ config, harness, demoRepo });
      const trials = [];
      for (let i = 1; i <= repetitions; i++) {
        const id = `${harness}-${i}`;
        console.log(`▶ ${id}`);
        const log = createWriteStream(path.join(jobsDir, `${id}.log`));
        await runHarbor({ args: buildHarborArgs({ config, harness, jobName: id, jobsDir }), cwd: config.root, logStream: log,
          env: { ...staged.env, PYTHONPATH: path.join(config.root, 'e2e'), E2E_CLAUDE_SUBAGENT_MODEL: config.harnesses[harness].subagentModel ?? '' } });
        log.end();
        cleanupCompose();
        const jobDir = path.join(jobsDir, id);
        const trialDir = existsSync(jobDir) ? readdirSync(jobDir).map((d) => path.join(jobDir, d)).find((d) => path.basename(d).startsWith('demo-todo__')) : null;
        const trial = trialDir ? buildTrialRecord({ id, harness, trialDir, config, briefing })
          : { id, reward: 0, contract: 0, checks: {}, acceptance: 0, ownTests: 0, judge: null, errors: { harbor: 'no trial dir', bridge: null, tool: 0, timeout: false } };
        trials.push(trial);
        if (trialDir && existsSync(path.join(trialDir, 'verifier'))) {
          const ev = path.join(outRoot, harness, 'evidence', id);
          mkdirSync(ev, { recursive: true });
          for (const f of ['ticket.json', 'pulls.json', 'pr.diff', 'pr-commits.txt', 'acceptance.tap', 'acceptance-ui.txt', 'notes.txt']) {
            const src = path.join(trialDir, 'verifier', f);
            if (existsSync(src)) cpSync(src, path.join(ev, f));
          }
          writeFileSync(path.join(ev, 'judge.json'), JSON.stringify({ scores: trial.judge, reasons: trial.judgeReasons, error: trial.judgeError }, null, 2));
        }
        console.log(`  reward ${trial.reward} · contract ${trial.contract} · acceptance ${trial.acceptance}`);
      }
      const h = config.harnesses[harness];
      const runRecord = { schema: 1, harness, fingerprint, config: { model: h.model, subagentModel: h.subagentModel ?? null, agentKwargs: h.agentKwargs, repetitions },
        trials, summary: summarizeTrials(trials) };
      const dir = path.join(outRoot, harness);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'run.json'), `${JSON.stringify(runRecord, null, 2)}\n`);
      writeFileSync(path.join(dir, 'report.md'), renderRunReport(runRecord));
      runs[harness] = runRecord;
      const baseline = findBaseline({ resultsDir: path.join(config.root, config.resultsDir), harness, before: ts,
        isAncestor: (sha) => { try { git('merge-base', '--is-ancestor', sha, 'main'); return true; } catch { return false; } } });
      if (baseline) compareDirs(baseline, dir);
    }
    writeFileSync(path.join(outRoot, 'summary.md'), renderSummary(runs));
    const leaks = scanForSecrets(outRoot, staged.values);
    if (leaks.length) {
      for (const f of leaks) rmSync(f);
      console.error(`✗ secrets found in results; deleted:\n${leaks.join('\n')}`);
      process.exitCode = 1;
    }
    console.log(`results: ${outRoot}`);
  } finally {
    onExit();
  }
}

if (command === 'preflight') process.exit(preflight() ? 0 : 1);
else if (command === 'run') await run();
else if (command === 'compare' && rest.length === 2) compareDirs(path.resolve(rest[0]), path.resolve(rest[1]));
else if (command === 'report' && rest.length === 1) {
  const r = JSON.parse(readFileSync(path.join(rest[0], 'run.json'), 'utf8'));
  writeFileSync(path.join(rest[0], 'report.md'), renderRunReport(r));
} else {
  console.error('usage: node e2e/run.mjs preflight|run [--harness h]... [--repetitions n] | compare <baseDir> <candDir> | report <harnessDir>');
  process.exit(2);
}
```

- [ ] **Step 6: Smoke-test the CLI without live runs**

Run: `node e2e/run.mjs bogus; echo exit=$?`
Expected: the usage line, `exit=2`.

Run: `node e2e/run.mjs preflight --harness opencode`
Expected: `preflight ok` or a clear list of `✗` problems. No stack trace.

- [ ] **Step 7: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add e2e/lib/report.mjs e2e/lib/report.test.mjs e2e/run.mjs
git commit -m "feat(e2e): add run/compare/report CLI and markdown reports"
```

---

### Task 13: Documentation

**Files:**
- Create: `docs/adw-e2e/README.md`
- Modify: `AGENTS.md` (add a section), `README.md` (one paragraph pointing to `docs/adw-e2e/README.md`)

- [ ] **Step 1: Write `docs/adw-e2e/README.md`**

```markdown
# ADW E2E self-test

Runs the full `agent-dev` workflow headlessly in Claude Code, Codex and OpenCode against the
`demo-todo` task (a todo API + list page, ticket #1 in a throwaway Gitea), scores every trial and
compares result sets. Design: `docs/superpowers/specs/2026-10-11-adw-e2e-self-test-design.md`.

## Prerequisites (host)

- Docker, and the local image: `node docker/build.mjs`
- Harbor 0.24.0: `uv tool install harbor==0.24.0`
- Logins, used as copies and never committed:
  - Claude: `claude setup-token`, then put `CLAUDE_CODE_OAUTH_TOKEN=<token>` into `e2e/.env`
  - Codex: `codex login --device-auth` (refresh it if a model is refused)
  - OpenCode: `opencode auth login` for the configured provider

### Windows

Run the self-test inside **WSL2**. Native Windows is not supported, and the preflight refuses it.
- Install Ubuntu (`wsl --install -d Ubuntu`) and Docker Desktop with WSL integration for that
  distribution. Give Docker 8 GB of RAM: Gitea, the agent container and headless Chromium run per
  trial.
- Clone the repo **inside** the WSL filesystem (`~/src/...`), not under `/mnt/c/...`. File modes,
  CRLF line endings and I/O speed break the task there, and the preflight warns about it.
- Install Node 24, uv, Harbor and the `claude`/`codex`/`opencode` CLIs inside WSL, then log in
  again there. Windows logins are not visible to WSL. Device-login links open in the Windows
  browser.
- Build the image inside WSL (`node docker/build.mjs`). Results can be reached from Windows under
  `\\wsl$\Ubuntu\home\<user>\src\ai-dev-workflow`.

## Run

    node e2e/run.mjs preflight
    node e2e/run.mjs run                        # all harnesses, 3 trials each (~1.5–2 h)
    node e2e/run.mjs run --harness codex --repetitions 1
    node e2e/run.mjs compare docs/adw-e2e/<old>/codex docs/adw-e2e/<new>/codex

Raw Harbor output: `e2e/jobs/<ts>/` (inspect with `harbor view e2e/jobs/<ts>`).

## Read the results

`docs/adw-e2e/<ts>/<harness>/`:
- `run.json`: fingerprint, configuration, per-trial checks, metrics and judge, plus the summary.
- `report.md`: the same data for humans.
- `evidence/<trial>/`: ticket comments, PR diff, test outputs, judge reasons.
- `compare.md`: the verdict against the baseline. The baseline is the newest earlier result on `main`.

`summary.md` puts the harnesses side by side.

| Signal | Meaning |
|---|---|
| reward | All `agent-dev` contract checks, own tests and hidden acceptance (API + UI) passed |
| contract | Share of contract checks passed (ticket edges, naming, draft PR, e2e via Playwright, app stopped, no screenshots in the repo) |
| judge | 1–5 per criterion from an LLM judge against the briefing (outcome-based) |
| tokens | Target agent only, from its own session logs (cross-checked with ccusage) |

Variance is large between identical runs. Compare rates and medians, never single trials.
`inconclusive` means the spread is bigger than the difference.

## Changing the test

- `e2e/config.json`: models, repetitions, thresholds, rubric. Any change shows in the fingerprint,
  so treat it as a deliberate comparison.
- Hidden tests may only check what the briefing (`instruction.md`) actively communicates.
- Never add checks on superpowers internals: path names, worktrees, TDD order, review steps.
```

- [ ] **Step 2: Add a section to `AGENTS.md`**, after "Container images (`docker/`)":

```markdown
## E2E self-test (`e2e/`)

Hand-maintained, not generated, not shipped in the npm package. `node e2e/run.mjs run` runs the
full `agent-dev` workflow through Harbor (pinned in `e2e/config.json`) in all three harnesses with
a simulated user and a throwaway Gitea; results land in `docs/adw-e2e/<ts>/`. Runs use subscription
logins and are triggered locally, never in CI; the `e2e/lib` and verifier unit tests run in
`npm test`. Checks cover only `agent-dev`'s own contract and observable outcomes — never
superpowers internals. Python is allowed only in `e2e/agents/` (Harbor custom agents). See
`docs/adw-e2e/README.md`.
```

- [ ] **Step 3: Add one paragraph to `README.md`**, at the end of its development or contributing
  section:

```markdown
**End-to-end self-test.** `node e2e/run.mjs run` exercises the whole workflow in Claude Code, Codex
and OpenCode and compares the result with the previous run — see `docs/adw-e2e/README.md`.
```

- [ ] **Step 4: Commit**

```bash
git add docs/adw-e2e/README.md AGENTS.md README.md
git commit -m "docs(e2e): document running, reading and changing the E2E self-test"
```

---

### Task 14: Live verification (manual, uses subscription quota)

**Files:** none of the code changes. Results under `docs/adw-e2e/` are committed.

- [ ] **Step 1: Preflight**

Run: `node e2e/run.mjs preflight`
Expected: `preflight ok`. Fix the reported problems first: rebuild the image, run `uv tool install`,
and refresh logins.

- [ ] **Step 2: One trial per harness**

Run: `node e2e/run.mjs run --repetitions 1`
Expected: `docs/adw-e2e/<ts>/{claude-code,codex,opencode}/run.json`, `report.md`, `evidence/` and
`summary.md`.

Check by hand:
- `checks.e2e_performed` is 1 for at least one harness. If it is 0 everywhere, inspect a trial with
  `harbor view` and fix the detection regex in `metrics.mjs`, with a test first.
- Codex: `grep -rl "openai-curated-remote/superpowers" e2e/jobs/<ts>/codex-1` returns nothing (Task
  10 Step 3).
- `grep -rF "$(sed -n 's/^CLAUDE_CODE_OAUTH_TOKEN=//p' e2e/.env)" docs/adw-e2e/<ts>` returns
  nothing.
- Tokens are non-null, and `ccusage.warning` is null for claude-code and codex.

- [ ] **Step 3: Baseline**

Run: `node e2e/run.mjs run`, with all harnesses and 3 trials. Commit the result as the first
baseline:

```bash
git add docs/adw-e2e
git commit -m "test(e2e): first E2E baseline"
```

- [ ] **Step 4: Regression detection check**

Temporarily remove the "Written spec approved" hook text (the Approved Spec post) from
`agent-src/skills/agent-dev/body.md`. Then:

Run: `node e2e/run.mjs run --harness claude-code`
Expected: `docs/adw-e2e/<ts>/claude-code/compare.md` shows **worse**, with `check:spec_comment` as
a regression and `skill.claude` in the fingerprint diff. Then revert `body.md`
(`git checkout agent-src/skills/agent-dev/body.md`) and delete that result directory. It is not a
baseline.

- [ ] **Step 5: Package check**

Run: `npm pack --dry-run 2>&1 | grep -c 'e2e/'`
Expected: `0`.

---

### Task 15: Align the spec with implementation decisions

**Files:**
- Modify: `docs/superpowers/specs/2026-10-11-adw-e2e-self-test-design.md`

- [ ] **Step 1: Update the spec** in these places:
  - "Image changes" bullet → "E2E-only tooling lives in the task Dockerfile; the product image is
    unchanged (`tea` for the product image: #53)."
  - Test task → the visible UI requirements: due date shown, the word "überfällig", a toggle
    labelled "nur überfällige". Hidden UI tests use only visible text and roles.
  - Testing → `npm test` includes `e2e/lib` and the verifier unit tests.
  - Metrics and Result files → drop the `userTurnsBeforeSpec` soft signal (YAGNI). The only soft
    signal is `superpowersActive`.
  - Open questions → replace the Codex-superpowers item with the mechanism used (Task 10 Step 3) and
    its verified outcome from Task 14.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-10-11-adw-e2e-self-test-design.md
git commit -m "docs: align E2E self-test spec with implementation decisions"
```
