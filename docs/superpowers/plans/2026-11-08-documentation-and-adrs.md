# Documentation and ADRs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `agent-dev` keeps a project's technical documentation (architecture doc, ADRs, README, changelog) current in the same PR as the code, applies one shipped comment rule, and offers to discard spec/plan at handover — with the pinned `documentation-and-adrs` skill and a new runtime include.

**Architecture:** The skill is pinned and installed exactly like show-me (`agentSkills` → `config/skills.json` → `skills.mjs`). A new rendered include `.agents/includes/documentation.md` is assembled by a new `lib/documentation.mjs` from two source fragments: the comment rules (always) and the documentation rules (only when `skills.documentation-and-adrs` is not `false`). The `agent-dev` body gets event hooks that defer to that include. E2E gets three new contract checks, a persona answer and two review-criteria changes.

**Tech Stack:** Node >= 24, builtins only, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-08-documentation-and-adrs-design.md` (issue #93)

## Global Constraints

- `agent-src/` is the only source; never hand-edit generated files or derived files (`agent-src/config/skills.json` comes from `node docker/tools/inventory.mjs sync`).
- Zero runtime dependencies; LF line endings.
- Every new non-test `agent-src/lib/*.mjs` gets its own entry in `package.json` `files` in the same commit (`agent-src/includes` is already listed as a directory). Verify with `npm pack --dry-run`.
- `agent-dev` names no superpowers skill except `brainstorming` and `writing-plans`, by bare id; hooks are events, not superpowers steps. Keep added body text minimal — detail goes in the include.
- The opt-out key is `skills.documentation-and-adrs` in `ai-project.json`; missing means opted in, `false` means opted out. No second key.
- Default layout (only without an existing convention): `docs/architecture/architecture.md`, topic files `docs/architecture/<topic>.md` linked from it, ADRs `docs/architecture/decisions/NNNN-<title>.md`.
- `architecture.md` default sections: Overview · Building blocks · Key flows · Data · Interfaces · Operations · Cross-cutting · Decisions; Mermaid for diagrams; current state only.
- The PR description never names the spec or plan files; the ticket's implementation summary keeps the `Spec: … · Plan: …` line and marks discarded files as removed.
- E2E checks never assert on superpowers internals (no `docs/superpowers/` path in any check).
- Skill pin: repository `addyosmani/agent-skills`, path `skills/documentation-and-adrs`, revision `301b02b12bff98e4688e6984af6556802322bbde` (repo HEAD on 2026-11-01, as `inventory.mjs update` would propose), purpose `"ADRs, architecture docs, README/changelog and comment rules"`.

## Review Focus

- A project that already has an ADR/doc convention (e.g. `docs/adr/0007-x.md`) must get it continued, never a second `docs/architecture/` scheme — the include states "match the existing convention first" before any default (Task 2 test).
- An opted-out project (`"documentation-and-adrs": false`) must get an include with only the comment rules — no architecture/ADR/README wording and no pointer to the skill — while the body stays identical (Task 2 test).
- A project not yet upgraded (no `skills` key at all) renders with documentation on, matching what `upgrade` then records (Task 2 test).
- A run that pushes the branch but cannot open a PR (file backend without host CLI, failed create) must still get the discard question (Task 3 test on the body wording).
- Implementer subagents never see `agent-dev`; the body must tell the agent to point every code-writing subagent at the include's comment section (Task 3 test).

---

### Task 1: Pin and install the `documentation-and-adrs` skill

**Files:**
- Modify: `docker/tools/inventory.json` (`agentSkills.skills`)
- Derived: `agent-src/config/skills.json` (via `node docker/tools/inventory.mjs sync`, never by hand)
- Modify: `agent-src/lib/onboard.mjs:47-49` (tooling help text)
- Modify: `e2e/tasks/_shared/environment/seed/answers.json`
- Test: `agent-src/lib/skills.test.mjs`

**Interfaces:**
- Produces: `loadSkillPins().skills['documentation-and-adrs']` = `{ purpose, repository: 'addyosmani/agent-skills', path: 'skills/documentation-and-adrs', revision }`. `skills.mjs`, `askSkills` and `syncSkills` are already generic; no code change there.

- [ ] **Step 1: Write the failing test** in `skills.test.mjs`, next to the existing shipped-pins test:

```js
test('the shipped pins name documentation-and-adrs at a full commit', () => {
  const pins = loadSkillPins();
  const skill = pins.skills['documentation-and-adrs'];
  assert.equal(skill.repository, 'addyosmani/agent-skills');
  assert.equal(skill.path, 'skills/documentation-and-adrs');
  assert.match(skill.revision, /^[0-9a-f]{40}$/);
});
```

- [ ] **Step 2: Run it, expect FAIL** — `node --test --test-name-pattern "documentation-and-adrs" agent-src/lib/skills.test.mjs` → `Cannot read properties of undefined`.
- [ ] **Step 3: Add the entry** to `inventory.json` `agentSkills.skills` with the values from Global Constraints, then run `node docker/tools/inventory.mjs sync` and confirm `git diff agent-src/config/skills.json` shows the new entry. Run `node docker/tools/inventory.mjs check` → no drift.
- [ ] **Step 4: Run it, expect PASS**, then the full `npm test` (onboarding tests iterate all pins; fix any that hard-code a single skill).
- [ ] **Step 5: Help text and E2E seed answers.** Add a `documentation-and-adrs` entry to the tooling text in `onboard.mjs` in the show-me entry's format: "Skill: ADRs, architecture docs, README/changelog and comment rules for agent-dev; `init` and `upgrade` install it unless you opt out — opting out also turns off agent-dev's documentation updates" + `https://github.com/addyosmani/agent-skills`. In `answers.json` set `"skills": { "show-me": true, "documentation-and-adrs": true }` (an answers file without the key means no).
- [ ] **Step 6: Commit** — `feat(skills): pin documentation-and-adrs (#93)`.

### Task 2: Render the documentation include

**Files:**
- Create: `agent-src/includes/documentation-comments.md`, `agent-src/includes/documentation-docs.md`
- Create: `agent-src/lib/documentation.mjs`
- Modify: `agent-src/config/ai-workflow.json` (add `"documentation": { "includePath": ".agents/includes/documentation.md" }`)
- Modify: `agent-src/lib/config.mjs` (`loadConfig`: package-owned `documentation.includePath` like `cost`; `buildGlobalTokens`: `put('documentation.include', c.documentation?.includePath)`)
- Modify: `agent-src/lib/pipeline.mjs` (emit it right after the cost include, same unresolved-placeholder guard)
- Modify: `package.json` `files` (add `agent-src/lib/documentation.mjs`)
- Test: `agent-src/lib/pipeline.test.mjs`

**Interfaces:**
- Consumes: `loadConfig`, `buildGlobalTokens`, `substituteTokens`, `normalizeLF` (as `cost.mjs` does).
- Produces: `renderDocumentationInclude(config, globalTokens) -> { path, content, plain: true } | null` (null only without an `includePath`); `documentationEnabled(config) -> boolean` = `config.skills?.['documentation-and-adrs'] !== false`; token `{{documentation.include}}` = `.agents/includes/documentation.md`.

Include content (the spec, section 2, is the source; keep it short):
- `documentation-comments.md` — `## Comments`: comment the why, not the what; no commented-out code (git has history); no TODOs for what can be done now; document non-obvious gotchas where they bite; a project's comment rules in `AGENTS.md` apply in addition and win on conflict.
- `documentation-docs.md` — `## Documentation`: match the existing convention first (an existing ADR/doc layout, numbering, headings wins; never introduce a second scheme; surface conflicts); otherwise the default layout and section list from Global Constraints; current state only (rewrite what changed, delete what is no longer true, link ADRs for the why); ADRs only for fundamental technical decisions whose reasoning stays relevant, the agreed spec being the usual source, status `Accepted`; README/changelog when the change is visible to users or developers, following an existing changelog format; for the ADR template, README/changelog structure and the checklist read `.agents/skills/documentation-and-adrs/SKILL.md`, and if it is missing say once that adw's `upgrade` command installs it and continue (never block).
- Rendered output: banner `<!-- DO NOT EDIT — generated from agent-src/includes/documentation-*.md; run \`node agent-src/generate.mjs\` -->`, then the comments fragment, then (if enabled) the docs fragment.

- [ ] **Step 1: Write the failing tests** in `pipeline.test.mjs`:
  - Update `renderAll emits only the agent-dev skill plus the ticketing and cost includes` to also expect `'.agents/includes/documentation.md'` (rename the test to "…plus its includes").
  - `test('the documentation include carries comment and documentation rules by default', …)` on `tmpProject()` (no `skills` key): content matches `/## Comments/`, `/why, not the what/i`, `/commented-out code/i`, `/AGENTS\.md/`, `/## Documentation/`, `/match the existing convention first/i`, `/docs\/architecture\/architecture\.md/`, `/docs\/architecture\/decisions\//`, `/current state/i`, `/\.agents\/skills\/documentation-and-adrs\/SKILL\.md/`, `/upgrade/`; no `/\{\{.*?\}\}/`; and the `## Comments` heading comes before `## Documentation`.
  - `test('opting out of documentation-and-adrs leaves only the comment rules', …)`: write `ai-project.json` with `skills: { 'documentation-and-adrs': false }` (keep the rest of the `tmpProject` config); content matches `/## Comments/` and does not match `/## Documentation|docs\/architecture|ADR|documentation-and-adrs/`; the agent-dev SKILL.md outputs are byte-identical to the opted-in render.
  - In `loadConfig` tests (near line 293): `cfg.documentation.includePath === '.agents/includes/documentation.md'`.
- [ ] **Step 2: Run, expect FAIL** — `node --test agent-src/lib/pipeline.test.mjs`.
- [ ] **Step 3: Implement** the two fragments, `documentation.mjs` (mirror `cost.mjs`), the config/token/pipeline wiring and the `files` entry.
- [ ] **Step 4: Run, expect PASS** — `npm test`; `npm pack --dry-run | grep documentation` lists `lib/documentation.mjs` and both include fragments.
- [ ] **Step 5: Commit** — `feat(agent-dev): documentation include with comment and docs rules (#93)`.

### Task 3: `agent-dev` body hooks

**Files:**
- Modify: `agent-src/skills/agent-dev/body.md`
- Test: `agent-src/lib/pipeline.test.mjs` (the `agent-dev enters the superpowers workflow…` test)

**Interfaces:**
- Consumes: `{{documentation.include}}` (Task 2).

Body changes (spec section 3; wording is the implementer's, keep each addition to one or two lines):
- Intro: read `{{documentation.include}}` when you write code or update documentation.
- New hook **Code written** (by you or a subagent you dispatch): follow the include's Comments section; tell every code-writing subagent to read it.
- Extend **Implementation verified, before integrating**: update the documentation as the include says and commit it on the branch, before the PR.
- New hook **Work handed over for review** (draft PR opened, or branch pushed without one): ask whether to discard spec and plan — both, only the plan, or neither; delete the chosen file(s) in one commit and push; do this before posting the summaries.
- **Integration options offered**: the PR description is the summary *without* its Spec/Plan line, plus the ticket reference.
- Summary template: add `**Documentation** — which docs were updated (architecture, ADR, README, changelog), or why none.`; the Spec/Plan line marks discarded files as removed.
- Replace "The spec and plan the workflow writes, if any, are the only durable working files" — they are working files; the durable documentation is the project's docs per the include.

- [ ] **Step 1: Write the failing assertions** in the existing body test loop:

```js
assert.match(body, /\.agents\/includes\/documentation\.md/);
assert.match(body, /subagent/i, 'the comment rule must reach code-writing subagents');
assert.match(body, /both, only the plan, or neither/i, 'discard question offers exactly three choices');
assert.match(body, /pushed without/i, 'the discard question also fires when no PR could be opened');
assert.match(body, /\*\*Documentation\*\*/, 'the summary reports the documentation updates');
assert.match(body, /without (its|the) Spec\/Plan line/i, 'PR descriptions never name spec or plan');
assert.doesNotMatch(body, /only durable working files/);
```

- [ ] **Step 2: Run, expect FAIL** — `node --test agent-src/lib/pipeline.test.mjs`.
- [ ] **Step 3: Edit `body.md`** as listed above.
- [ ] **Step 4: Run, expect PASS** — `npm test` (the existing "names only entry skills" and "no `{{…}}`" assertions must still pass). Check the growth: `wc -c` of the rendered `.claude/skills/agent-dev/SKILL.md` before/after; report the delta in the commit body.
- [ ] **Step 5: Commit** — `feat(agent-dev): documentation, comment and spec/plan discard hooks (#93)`.

### Task 4: E2E contract checks, persona and review criteria

**Files:**
- Modify: `e2e/tasks/_shared/tests/checks.mjs`, `e2e/tasks/_shared/tests/checks.test.mjs`
- Modify: `e2e/lib/trial.mjs` (`CONTRACT_CHECKS`), `e2e/lib/trial.test.mjs` if it pins the count
- Modify: `e2e/tasks/_shared/persona.md`
- Modify: `e2e/config.json` (`review.criteria`)

**Interfaces:**
- Produces three checks from `evaluateContract({ issue, comments, pulls, prDiff, appListening })` (`pulls[0].body` is the Gitea PR description; `verify.mjs` already passes the raw API objects):
  - `docs_architecture` — `prDiff` has a `diff --git a/docs/architecture/architecture.md ` header.
  - `spec_plan_discard` — every `.md` path named on the Implementation Summary's `Spec:`/`Plan:` line is absent from the `diff --git` headers of `prDiff` (no paths named → 1).
  - `pr_description_clean` — the PR body contains none of those paths and no `Spec: …\.md` / `Plan: …\.md` line (no PR → 0).
- `CONTRACT_CHECKS` gains the same three names (after `no_screenshots_in_repo`).
- `adw e2e` local (`e2e/local/contract.mjs`) stays unchanged (planner's call, which the spec leaves to the builder): a consumer project may have its own docs layout, the discard answer comes from that project's real user via `askHuman`, and the PR fakes record no body.

- [ ] **Step 1: Write the failing tests** in `checks.test.mjs`: extend `good` with `pulls[0].body: 'Approach…\n\nRefs #1'`, `prDiff` adding `diff --git a/docs/architecture/architecture.md b/docs/architecture/architecture.md\n`, and a summary `'## Implementation Summary\nEnd-to-end: tested with Playwright\nSpec: docs/specs/s.md (removed) · Plan: docs/plans/p.md (removed)'`; the count assertion becomes 15. Add to the "each deviation fails exactly its check" table:
  - `['docs_architecture', { prDiff: 'diff --git a/src/app.mjs b/src/app.mjs\n' }]`
  - `['spec_plan_discard', { prDiff: good.prDiff + 'diff --git a/docs/plans/p.md b/docs/plans/p.md\n' }]`
  - `['pr_description_clean', { pulls: [{ ...good.pulls[0], body: 'Spec: docs/specs/s.md' }] }]`
- [ ] **Step 2: Run, expect FAIL** — `node --test e2e/tasks/_shared/tests/checks.test.mjs`.
- [ ] **Step 3: Implement** the three checks in `checks.mjs` (paths: `/\b(?:Spec|Plan):\s*`?([\w./-]+\.md)/g` over the summary) and add the names to `CONTRACT_CHECKS`.
- [ ] **Step 4: Persona and review criteria.** Append to `persona.md`: "If the agent asks whether to discard the spec and plan, answer: both." In `e2e/config.json`: `scope` → `"No unrequested features and no unrelated changes? Documentation updates (architecture docs, ADRs, README, changelog) and removing the spec/plan files count as in scope."`; add `"comments": "Do code comments explain the why rather than restate the what, with no commented-out code and no TODOs for work that could be done now?"`. (`compare.mjs` already skips a criterion without a baseline value.)
- [ ] **Step 5: Run, expect PASS** — `npm test` (includes `e2e/lib` and verifier tests).
- [ ] **Step 6: Commit** — `test(e2e): documentation, spec/plan discard and PR description checks (#93)`.

### Task 5: README and upgrade note

**Files:**
- Modify: `README.md` (the "What lands in your repo" skills row, the Tooling table, a new `### Documentation and comments` section after `### Reviewing specs and plans with show-me`, the `## Updating` paragraph naming the pinned skills, and an "Upgrading to v0.31.0" note above v0.30.0)

- [ ] **Step 1: Write the user-facing text** (no implementation details; no tests — prose only):
  - Section: what `agent-dev` now does (architecture doc with current state only, ADRs for fundamental decisions, README/changelog, the default `docs/architecture/` layout, an existing convention wins), the shipped comment rule and that `AGENTS.md` rules still apply on top, the discard question after handover, and that `"skills": { "documentation-and-adrs": false }` turns off the documentation updates (the comment rule and discard question stay).
  - Upgrading note: "`upgrade` installs the documentation-and-adrs skill and regenerates `agent-dev`. Comment sentences in your `AGENTS.md` that only restate adw's rule can be deleted; project-specific ones stay. To keep documentation elsewhere, set `"documentation-and-adrs": false` first."
- [ ] **Step 2: Commit** — `docs(readme): documentation and ADRs in agent-dev (#93)`.

### Task 6: Verify end to end

- [ ] **Step 1:** `npm test` → all pass; `npm pack --dry-run` lists `agent-src/lib/documentation.mjs`.
- [ ] **Step 2:** On a scratch copy of a consumer project (`cp -r` into the scratchpad): `node agent-src/generate.mjs upgrade --root <copy>` → records `"documentation-and-adrs": true`, installs the skill, writes `.agents/includes/documentation.md`; then `check --root <copy>` exits 0. Set the key to `false`, `generate`, and confirm the include holds only `## Comments`.
- [ ] **Step 3:** The review-criteria change alters the verifier hash, so the calibration must be redone: ask the user to run `node e2e/run.mjs calibrate`, then an E2E run with the `e2e-run` skill (subscription quota — the user triggers both). Expect the three new checks at 1 and report how the run compares with the previous one.
