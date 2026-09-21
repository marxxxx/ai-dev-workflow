# QA Evidence Rules, Reviewer Locator Check, PR Human Steps, and Subagent Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the QA evidence checks that the token-reduction rewrite removed from the `dev-cycle` orchestrator by moving them into the `qa-engineer`. Add a locator check to the `code-reviewer`. Extend the automated PR description with human review and test steps while keeping it under 3000 characters. Give every spawned subagent, on every platform, a name that carries its role.

**Architecture:** The rewrite made `dev-cycle` a workflow coordinator: it checks protocol and does not reassess the subagents' conclusions. Content validation belongs to the subagents that own it. This plan changes only shared prose in `agent-src` unit bodies. Each rule is pinned by a render test in `agent-src/lib/pipeline.test.mjs` that asserts on every platform's output (Claude, Codex, OpenCode).

**Tech Stack:** Zero-dependency Node (`>=24`), `node --test`, the `agent-src` render pipeline (`renderAll` from `agent-src/generate.mjs`).

**Spec:** No separate spec document. The requirements come from the regression review of Wire Terminal commits `942ba5752..40ef36d6b`. They are restated under Background so this plan stands on its own.

## Background: Checks Lost From `dev-cycle`

Before the rewrite, the orchestrator audited `Test Results` and required:

1. no `PASS` based solely on unit tests, direct component or utility calls, mocked events, API calls, or DOM state injection;
2. every UI criterion names the route, control, and action used;
3. evidence artifact paths for every browser-tested UI criterion;
4. any criterion that was untested, blocked, or verified only by internal calls means QA did not pass;
5. `NEEDS HUMAN REVIEW` only for subjective visual claims, never for untested functional behavior, except when no E2E runtime is documented;
6. before/after screenshots for visual work when a baseline comparison is safe;
7. incomplete QA evidence never advances to PR handoff.

The Codex spawn overlay also lost its concrete name pattern `ticket_<id>_developer_i<iteration>_c<continuation>`. It now only asks for "a unique `task_name`", so Codex subagent names no longer show the role (`developer`, `code-reviewer`, `qa-engineer`). The old pattern covered developers only, and reviewer and QA names never had one. Claude Code and OpenCode never had a naming rule at all, so the fix belongs in the shared `dev-cycle` body and applies to every platform.

It also required the PR body to carry explicit human acceptance steps and every `NEEDS HUMAN REVIEW` criterion with its screenshot references. The rewrite reduced that to "the ticket and a concise implementation summary (<3000 characters)".

## Global Constraints

- **`dev-cycle` stays a coordinator.** Do not re-add content audits to `agent-src/skills/dev-cycle/body.md`. Keep "Do not rerun tests or reassess QA conclusions." In that file, only the PR description rule (Task 3) and the new `## Subagent Names` section (Task 4) change.
- **Edit sources only.** Change `agent-src/**/body.md`, never generated platform files. Every generated file carries a `DO NOT EDIT` banner.
- **Use tokens, not literals,** for artifact names and branches: `{{artifact.testResults}}`, `{{artifact.implementationNotes}}`, `{{repo.defaultBranch}}`. Rendered output must contain no unresolved `{{…}}`.
- **PR description limit: under 3000 characters,** stated in the rendered `dev-cycle` skill.
- **Zero runtime dependencies. LF line endings. Wrap prose at 100 columns** to match the existing bodies.
- **Every existing test must pass unchanged.**
- **Subagent naming is platform-neutral.** The name patterns live in the shared `agent-src/skills/dev-cycle/body.md`. The Codex overlay only says which `spawn_agent` field carries the name (`task_name`).

## File Map

| File | Change |
|---|---|
| `agent-src/agents/qa-engineer/body.md` | Add an `## Evidence Rules` section; move the baseline-comparison sentence into it |
| `agent-src/agents/code-reviewer/body.md` | Add a UI locator check before the outcome decision |
| `agent-src/skills/dev-cycle/body.md` | Replace the PR description sentence in `## Acceptance Handoff` |
| `agent-src/skills/dev-cycle/body.md` | Also: add a `## Subagent Names` section with role-bearing patterns for all three roles (Task 4) |
| `agent-src/skills/dev-cycle/overlays/codex.md` | Map the shared name to `task_name`; drop the developer-only naming sentence |
| `agent-src/lib/pipeline.test.mjs` | Add four render tests (one per task) |

The render tests use one shared helper. Task 1 adds it and Tasks 2–4 reuse it:

```js
// Rendered copies of one unit across all three platforms.
function renderedUnit(outputs, kind, name) {
  const claude = kind === 'agents'
    ? path.join('.claude', 'agents', `${name}.md`)
    : path.join('.claude', 'skills', name, 'SKILL.md');
  const codex = kind === 'agents'
    ? path.join('.codex', 'agents', `${name}.toml`)
    : path.join('.agents', 'skills', name, 'SKILL.md');
  const opencode = kind === 'agents'
    ? path.join('.opencode', 'agents', `${name}.md`)
    : path.join('.opencode', 'skills', name, 'SKILL.md');
  return [claude, codex, opencode].map((p) => {
    const out = outputs.find((o) => o.path === p);
    assert.ok(out, `expected rendered output ${p}`);
    return out;
  });
}
```

> These paths match what `renderAll` emits today (checked against a file-backend `tmpProject()`).

---

### Task 1: QA engineer enforces its own evidence rules

**Files:**
- Modify: `agent-src/agents/qa-engineer/body.md` (the paragraph after `## Testing` step 5, and a new section before `## Outcome And State`)
- Test: `agent-src/lib/pipeline.test.mjs` (append the helper above and one test)

**Interfaces:**
- Consumes: `renderAll(root)`, `tmpProject()` (existing).
- Produces: `renderedUnit(outputs, kind, name)`, used by Tasks 2, 3, and 4.

- [ ] **Step 1: Write the failing test**

Append to `agent-src/lib/pipeline.test.mjs` (the `renderedUnit` helper first, then):

```js
test('qa-engineer owns the evidence rules that dev-cycle no longer audits', () => {
  const { root, cleanup } = tmpProject();
  try {
    for (const qa of renderedUnit(renderAll(root), 'agents', 'qa-engineer')) {
      const c = qa.content;
      assert.match(c, /## Evidence Rules/, qa.path);
      assert.match(c, /mocked events/, `${qa.path}: internal-only verification is named`);
      assert.match(c, /never `PASS`/, `${qa.path}: unexercised criteria cannot pass`);
      assert.match(c, /route, control, and action/, `${qa.path}: UI criteria name their path`);
      assert.match(c, /evidence paths/, `${qa.path}: per-criterion evidence`);
      assert.match(c, /Never use it for functional behavior you could not test/, qa.path);
      assert.match(c, /before\/after screenshots/, `${qa.path}: visual baseline screenshots`);
      assert.match(c, /audit your own `Test Results`/, `${qa.path}: self-audit before transition`);
      assert.match(c, /never move to `acceptance-test` on incomplete evidence/, qa.path);
      assert.doesNotMatch(c, /\{\{.*?\}\}/, qa.path);
    }
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-name-pattern="qa-engineer owns the evidence rules" agent-src/lib/pipeline.test.mjs`
Expected: FAIL at `/## Evidence Rules/`.

- [ ] **Step 3: Edit the QA body**

In `agent-src/agents/qa-engineer/body.md`, replace this paragraph:

```markdown
Capture relevant screenshots and console/network errors for browser-tested UI criteria. When a safe
checkout/worktree strategy is provided, compare subjective visual work with
`{{repo.defaultBranch}}` without disturbing local changes.
```

with:

```markdown
Capture relevant screenshots and console/network errors for browser-tested UI criteria.

## Evidence Rules

- A UI/interactive functional criterion is `PASS` only when exercised through user-visible behavior
  in the running app. Unit tests, direct component or utility calls, mocked events, API calls, or
  DOM state injection never justify that `PASS`. A criterion you could not exercise this way is
  `BLOCKED` with the reason, never `PASS`.
- For each browser-tested UI criterion, name the route, control, and action used, and reference its
  evidence paths.
- Use `NEEDS HUMAN REVIEW` only for subjective visual claims, or for UI/interactive criteria deferred
  by the include's no-runtime path. Never use it for functional behavior you could not test.
- For visual work, when a safe checkout/worktree strategy is provided, take before/after screenshots
  against `{{repo.defaultBranch}}` without disturbing local changes.
- Before any transition, audit your own `{{artifact.testResults}}`: every criterion present, every
  browser-tested UI criterion with route, control, action, and evidence paths, and no unexercised
  criterion marked `PASS`. If the audit fails, correct the results, or leave the ticket in `test`
  and report the gap; never move to `acceptance-test` on incomplete evidence.
```

Leave `## Outcome And State` unchanged. Its `BLOCKED` bullet (leave the ticket in `test`) already covers the new `BLOCKED` result.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-name-pattern="qa-engineer owns the evidence rules" agent-src/lib/pipeline.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests PASS, including `renderAll emits the single AGENTS-driven e2e include and the qa-engineer points at it`.

- [ ] **Step 6: Commit**

```bash
git add agent-src/agents/qa-engineer/body.md agent-src/lib/pipeline.test.mjs
git commit -m "feat(qa-engineer): own the evidence rules dev-cycle no longer audits"
```

---

### Task 2: Code reviewer checks UI test locators

**Files:**
- Modify: `agent-src/agents/code-reviewer/body.md` (between the "Begin only with…" paragraph and "Prioritize correctness…")
- Test: `agent-src/lib/pipeline.test.mjs`

**Interfaces:**
- Consumes: `renderedUnit` from Task 1.
- Produces: nothing new.

Background: the developer body (`agent-src/agents/developer/body.md:36-39, 52`) already requires stable locators for acceptance-relevant controls and content, and a **Test locators** section in `Implementation Notes`. Nobody checks this before QA, so a missing locator only shows up late, as a QA "testability gap".

- [ ] **Step 1: Write the failing test**

```js
test('code-reviewer checks UI test locators and the Test locators section', () => {
  const { root, cleanup } = tmpProject();
  try {
    for (const cr of renderedUnit(renderAll(root), 'agents', 'code-reviewer')) {
      const c = cr.content;
      assert.match(c, /stable locators/, `${cr.path}: locator check present`);
      assert.match(c, /removed or renamed/, `${cr.path}: existing locators protected`);
      assert.match(c, /`Implementation Notes` lists them\s+under \*\*Test locators\*\*/, cr.path);
      assert.match(c, /important finding/, `${cr.path}: missing locator blocks the review`);
      assert.doesNotMatch(c, /\{\{.*?\}\}/, cr.path);
    }
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-name-pattern="code-reviewer checks UI test locators" agent-src/lib/pipeline.test.mjs`
Expected: FAIL at `/stable locators/`.

- [ ] **Step 3: Edit the reviewer body**

In `agent-src/agents/code-reviewer/body.md`, insert this paragraph before `Prioritize correctness, regressions, architectural drift, security, and missing tests.`:

```markdown
For UI changes, verify that the controls and content acceptance testing needs carry stable locators
(the project's locator convention, or short kebab-case `data-id` values when none exists), that no
existing locator was removed or renamed, and that `{{artifact.implementationNotes}}` lists them
under **Test locators**. A missing locator for an element QA must target, or a missing section, is
an important finding. Decorative markup needs no locator.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-name-pattern="code-reviewer checks UI test locators" agent-src/lib/pipeline.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add agent-src/agents/code-reviewer/body.md agent-src/lib/pipeline.test.mjs
git commit -m "feat(code-reviewer): check UI test locators and the Test locators section"
```

---

### Task 3: PR description carries human review and test steps (under 3000 characters)

**Files:**
- Modify: `agent-src/skills/dev-cycle/body.md` (`## Acceptance Handoff`, step 2)
- Test: `agent-src/lib/pipeline.test.mjs`

**Interfaces:**
- Consumes: `renderedUnit` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

```js
test('dev-cycle PR description carries human steps and stays under 3000 characters', () => {
  const { root, cleanup } = tmpProject();
  try {
    for (const dc of renderedUnit(renderAll(root), 'skills', 'dev-cycle')) {
      const c = dc.content;
      assert.match(c, /under 3000 characters/, `${dc.path}: length limit stated`);
      assert.match(c, /human test steps/, `${dc.path}: acceptance steps required`);
      assert.match(c, /every `NEEDS HUMAN REVIEW` criterion/, `${dc.path}: review items carried`);
      assert.match(c, /Test Results/, `${dc.path}: links QA results instead of copying`);
      // Coordinator boundary stays intact.
      assert.match(c, /reassess QA conclusions/, `${dc.path}: coordinator boundary kept`);
      assert.doesNotMatch(c, /\{\{.*?\}\}/, dc.path);
    }
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-name-pattern="dev-cycle PR description carries human steps" agent-src/lib/pipeline.test.mjs`
Expected: FAIL at `/under 3000 characters/`.

- [ ] **Step 3: Edit the dev-cycle body**

In `agent-src/skills/dev-cycle/body.md`, replace:

```markdown
2. Follow `{{ticketing.include}}` for provider-specific journal cleanup and PR or branch handoff.
   Where automation creates a PR, include the ticket and a concise implementation summary (<3000 characters) in the description.
```

with:

```markdown
2. Follow `{{ticketing.include}}` for provider-specific journal cleanup and PR or branch handoff.
   Where automation creates a PR, keep its description under 3000 characters and include: the
   ticket; a concise implementation summary; numbered human test steps (route, control, action,
   expected result) for acceptance; and every `NEEDS HUMAN REVIEW` criterion with its evidence
   references. Take steps and items from `{{artifact.testResults}}`. When space runs out, shorten
   the summary first and reference `{{artifact.testResults}}` rather than copying it.
```

This is a coordinator task (assembling the handoff), not a content audit. Leave the Global Constraints boundary untouched.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-name-pattern="dev-cycle PR description carries human steps" agent-src/lib/pipeline.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add agent-src/skills/dev-cycle/body.md agent-src/lib/pipeline.test.mjs
git commit -m "feat(dev-cycle): PR description carries human test steps under 3000 characters"
```

---

### Task 4: Every subagent name carries its role, on every platform

**Files:**
- Modify: `agent-src/skills/dev-cycle/body.md` (new `## Subagent Names` section after `## Isolated Prompt Packets`)
- Modify: `agent-src/skills/dev-cycle/overlays/codex.md` (first paragraph of `## Codex Spawn Rules`)
- Test: `agent-src/lib/pipeline.test.mjs`

**Interfaces:**
- Consumes: `renderedUnit` from Task 1.
- Produces: nothing new.

Background: the patterns go in the shared body, which renders into the Claude
(`.claude/skills/dev-cycle/SKILL.md`), Codex (`.agents/skills/dev-cycle/SKILL.md`), and OpenCode
(`.opencode/skills/dev-cycle/SKILL.md`) skills. Each harness puts the name in whatever field its
spawn tool uses for a name or label. The Codex overlay pins that field to `task_name`.

Every attempt gets a pattern, not just developers. The main skill's bounded recovery respawns a
developer "at the same iteration and continuation counters", and a QA run that ends `BLOCKED` can be
repeated at the same iteration. Both would collide with the previous name, so any respawn at
unchanged counters gets an `_r<n>` suffix.

- [ ] **Step 1: Write the failing test**

```js
test('dev-cycle names every subagent by ticket, role, and counters on every platform', () => {
  const { root, cleanup } = tmpProject();
  try {
    const skills = renderedUnit(renderAll(root), 'skills', 'dev-cycle');
    for (const dc of skills) {
      const c = dc.content;
      assert.match(c, /## Subagent Names/, dc.path);
      assert.match(c, /`ticket_<id>_developer_i<iteration>_c<continuation>`/, `${dc.path}: developer`);
      assert.match(c, /`ticket_<id>_code_reviewer_i<iteration>`/, `${dc.path}: reviewer`);
      assert.match(c, /`ticket_<id>_qa_engineer_i<iteration>`/, `${dc.path}: QA`);
      assert.match(c, /`_r<n>`/, `${dc.path}: respawn at unchanged counters stays unique`);
    }
    // Codex pins the name to spawn_agent's task_name field.
    const codex = skills[1];
    assert.match(codex.content, /name from `## Subagent Names` as `task_name`/, codex.path);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-name-pattern="dev-cycle names every subagent" agent-src/lib/pipeline.test.mjs`
Expected: FAIL at `/## Subagent Names/`.

- [ ] **Step 3: Add the shared naming section**

In `agent-src/skills/dev-cycle/body.md`, insert this section directly before `## States` (after the
`Direct subagents to durable context …` paragraph):

```markdown
## Subagent Names

Name every spawned subagent after its ticket, role, and counters. Pass the name in the spawn tool's
name or label field (the task description where no name field exists):

- developer: `ticket_<id>_developer_i<iteration>_c<continuation>`, initial continuation `0`;
- code reviewer: `ticket_<id>_code_reviewer_i<iteration>`;
- QA engineer: `ticket_<id>_qa_engineer_i<iteration>`.

When a role is respawned at unchanged counters (bounded recovery, or QA repeated after `BLOCKED`),
append `_r<n>`, starting at `1`, so every name stays unique.
```

- [ ] **Step 4: Point the Codex overlay at the shared names**

In `agent-src/skills/dev-cycle/overlays/codex.md`, replace:

```markdown
Use `spawn_agent` with the matching `agent_type` and `fork_turns: "none"` for every developer,
reviewer, and QA attempt. Give each a unique `task_name`; for developers, encode the ticket,
implementation-review iteration, and continuation, with the initial continuation numbered `0`.
Supply the self-contained prompt packet as `message`.
```

with:

```markdown
Use `spawn_agent` with the matching `agent_type` and `fork_turns: "none"` for every developer,
reviewer, and QA attempt. Pass the name from `## Subagent Names` as `task_name`, and supply the
self-contained prompt packet as `message`.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test --test-name-pattern="dev-cycle names every subagent" agent-src/lib/pipeline.test.mjs`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add agent-src/skills/dev-cycle/body.md agent-src/skills/dev-cycle/overlays/codex.md agent-src/lib/pipeline.test.mjs
git commit -m "fix(dev-cycle): every subagent name carries its role on all platforms"
```

---

## After The Plan: Consuming Project (Wire Terminal)

Out of scope for this repository. Listed here so it is not forgotten:

1. Release a new tag following the repo's `chore: release vX.Y.Z` convention.
2. In `D:\src\SWA\Wire_Terminal`, run `npx github:marxxxx/ai-dev-workflow#<new-tag> generate`. Confirm the diff touches only the generated `qa-engineer`, `code-reviewer`, and `dev-cycle` files for Claude, Codex, and OpenCode. All three `dev-cycle` skills should gain `## Subagent Names`; only the Codex one mentions `task_name`.

Another regression from the same review is **not** part of this plan and needs its own work:

- `default_tools_approval_mode` in the managed `.codex/config.toml` block moved out of `[mcp_servers.ado]`.
