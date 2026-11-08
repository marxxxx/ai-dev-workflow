# Documentation as part of the change: ADRs, architecture docs and one comment rule

Issue: #93

## Context
Projects that use adw have no central place for architecture decisions and technical documentation
that both humans and agents can reach. Today it lives in a separate, hand-maintained wiki that goes
stale quickly and that agents never read. Separately, every project's `AGENTS.md` carries its own,
slightly different sentence on how agents should write code comments.

The goal: documentation becomes part of the implementation. An `agent-dev` run updates the technical
documentation in the repo, on the same branch and in the same draft PR as the code, so it is reviewed
together with it. The comment rule ships once with adw for every project instead of being restated
per project.

The vehicle is the third-party skill
[`documentation-and-adrs`](https://github.com/addyosmani/agent-skills/tree/main/skills/documentation-and-adrs)
(addyosmani/agent-skills). It is plain Markdown + frontmatter (harness-neutral) and brings an ADR
template and lifecycle (`Proposed → Accepted → Superseded/Deprecated`), a comment policy (comment the
*why*, not the *what*; no commented-out code; no TODOs for things you could do now; document known
gotchas), README/changelog structure, a verification checklist, and the core instruction **"match
the existing convention first"**: an existing ADR/doc convention in the project wins, never a second
scheme.

The wiki is context for *why* this is wanted. Migrating its content is out of scope.

## Goals
- `agent-dev` keeps the repo's technical documentation current as part of every run:
  - **Architecture documentation** describes only the *current* state of the system. The agent
    creates it on the first run where none exists and updates the sections a change touches on
    every later run, deleting what is no longer true.
  - **ADRs** are written only for fundamental technical decisions whose reasoning stays relevant
    for the future (framework, database, data model, auth strategy, API style, anything expensive
    to reverse). Routine implementation choices get no ADR. ADRs are the only documentation with
    history: old ones stay and are superseded by new ones.
  - **README and changelog** are updated incrementally when a change is visible to users or
    developers.
- One comment rule, the skill's, applies in every adw project, including to subagents that write
  code. Comment rules a project keeps in its `AGENTS.md` stay valid on top of it.
- After the draft PR is open, the developer decides whether the superpowers spec and plan files are
  discarded: **both**, **only the plan**, or **neither**.
- An existing project gets all of it with one `npx @strobl_dev/adw@<new> upgrade`.

## Non-goals
- Migrating content from the wiki.
- Business/domain documentation (Fach-Doku); it is written separately.
- Editing a project's `AGENTS.md`/`CLAUDE.md` (hand-owned). The project's own comment rules stay.
- Forking or rewriting the third-party skill; it is installed pinned and unmodified.
- A separate command or run that generates documentation outside `agent-dev`.
- Superseding project conventions: an existing ADR/architecture-doc layout is followed, not migrated.

## Anti-goals (a failure even if it technically works)
- Documentation that restates the code, or an architecture doc that accumulates history ("in v2 we
  changed…") instead of describing what is.
- ADRs for routine choices, so the important ones drown.
- A second ADR or docs scheme next to one the project already has.
- Spec/plan files lingering as if they were documentation, so the next agent reads them as truth —
  the wiki problem again, inside the repo (unless the developer chose to keep them).
- A noticeably bigger `agent-dev` body: every rendered byte is read on every run. Detail belongs in
  the include and the skill, which are read only at the event that needs them.
- A run that blocks or fails because the skill is missing.

## Constraints (from `AGENTS.md`)
- `agent-src/` is the only source; generated files are never hand-edited.
- `agent-dev` stays lean and hooks in at **events**, never at superpowers' internal skill order; it
  names no superpowers internals.
- Shared procedures are rendered once to `.agents/includes/*.md` and read at runtime, never inlined.
- Zero runtime dependencies; LF endings; `package.json` `files` stays in sync (`includes/` is listed
  as a directory, so a new include file is covered; a new `lib/*.mjs` would need its own entry).
- Tool/skill pins come from `docker/tools/inventory.json` (`agentSkills`) and are derived into
  `agent-src/config/skills.json` with `node docker/tools/inventory.mjs sync`; never hand-edit the
  derived file.
- Every feature needs an upgrade path and E2E coverage.
- E2E checks cover `agent-dev`'s contract and observable outcomes only, never superpowers internals.

## Design (decided)

### 1. Install the skill like show-me
`documentation-and-adrs` becomes a second pinned third-party skill, exactly the show-me mechanism:
an `agentSkills` entry in `docker/tools/inventory.json` (repository `addyosmani/agent-skills`, path
`skills/documentation-and-adrs`, a pinned commit), synced into `agent-src/config/skills.json`;
`init` asks for it (default yes, the existing per-skill loop in `onboard.mjs`), `upgrade` installs or
updates it. Installed files are project-owned, never rendered or checked.

**Opt-out switches off the documentation behavior, not just the skill** (user's decision: a project
may keep its documentation elsewhere). `skills.documentation-and-adrs: false` in `ai-project.json`
is the one switch (adw's call: no second key): the skill is not installed, and the rendered include
(section 2) then contains only the comment rules — no architecture docs, ADRs, README/changelog
updates, no pointer to the skill. Because `generate` reads `ai-project.json`, the include is
rendered deterministically from the switch and `check` covers it. **With the opt-out, documentation
is mentioned nowhere** (user's decision): no "update no documentation" note either, since it could
contradict documentation rules the project keeps itself. So every documentation instruction — the
update before integrating and the summary's **Documentation** line — lives in the include's
documentation part; the body stays identical for all projects and only points at the include
neutrally ("before integrating, do what the include asks"). The comment rules and the spec/plan discard question stay on in both cases (adw's call:
they are about code and working files, not about where a project documents). The `init` question
and README say what declining means. Any place that is still show-me-specific (help texts,
README tables, `upgrade` messages) is generalized or extended to name both skills.

### 2. A documentation include: adw's own rules
A new rendered include, `.agents/includes/documentation.md` (source `agent-src/includes/documentation.md`,
wired like `cost.md`: an `includePath` in `ai-workflow.json`, a `{{documentation.include}}` token).
It is short and holds what the skill does not decide or what adw decides differently:

- **Where.** Match the existing convention first (the skill's rule, restated in one line). Only
  without one, the default layout:

  ```
  docs/architecture/
    architecture.md        ← entry point, current state only
    <topic>.md             ← only when a section outgrows architecture.md; linked from it
    decisions/
      0001-<title>.md      ← ADRs (template and lifecycle from the skill)
  ```

  ADRs go under `docs/architecture/decisions/`, not the skill's default `docs/decisions/`, so there is
  exactly one place for technical documentation (adw's call, confirmed by the user).
- **`architecture.md` default sections**, only those that say something for the project:
  Overview (what the system does, context, neighbouring systems) · Building blocks (modules/
  components, responsibilities, dependencies) · Key flows (main runtime flows) · Data (model,
  storage) · Interfaces (APIs, external integrations) · Operations (build, deploy, configuration) ·
  Cross-cutting (auth, error handling, logging, conventions) · Decisions (list of/links to the ADRs
  in force). Diagrams as Mermaid in the Markdown.
- **Current state only.** Rewrite what changed, delete what is no longer true, link ADRs for the why.
  No change log inside the architecture doc.
- **ADR threshold.** Only fundamental technical decisions whose reasoning matters in the future; the
  agreed spec is the usual source of such a decision. Status `Accepted` once the scope is agreed.
- **README / changelog.** Update when the change is visible to users or developers; follow the
  project's existing changelog format, if any.
- **Comments.** The skill's comment rules, condensed to a few lines (why not what; no commented-out
  code; no TODOs for what can be done now; document non-obvious gotchas where they bite). A
  project's own comment rules in `AGENTS.md` apply in addition; where they conflict, `AGENTS.md`
  wins.
- **Detail.** For the ADR template, README/changelog structure and the verification checklist, read
  `.agents/skills/documentation-and-adrs/SKILL.md`. If it is missing although the project opted in,
  say once that adw's `upgrade` command installs it, then continue with this include alone (never
  block). With the opt-out, the include holds only the comment rules (section 1).

### 3. `agent-dev` body changes (events, minimal bytes)
- **Code written** (by the agent or a subagent it dispatches) — follow the include's comment rules;
  when dispatching a subagent that writes code, tell it to read that section of the include.
  (Rationale: implementer subagents never see `agent-dev`, and the rule must reach them. Phrased as
  an event, not as a superpowers step.)
- **Implementation verified, before integrating** — do what the include asks for before integrating
  (opted in: update the documentation and commit it on the branch, so it is in the draft PR and
  reviewed with the code). This sits next to the existing end-to-end hook at the same event.
- **Work handed over for review** — the draft PR is open, or the branch was pushed without one (the
  file backend without a host CLI, or a failed PR create): ask the developer whether to discard the
  spec and plan: both, only the plan, or neither. If they discard, delete the file(s) in one commit
  on the branch and push, so the draft PR updates. This happens before the implementation summary
  and cost summary are posted on the ticket. Resuming an interrupted run is unaffected: resume only
  happens before handover. (adw's call: the handover, not only "PR opened", so the files never
  linger just because no PR could be opened.)
- **The PR description never names the spec or plan files** (user's decision). Today the
  implementation summary, including its `Spec: … · Plan: …` line, is the PR description; from now on
  the PR description is the summary without that line, plus the ticket reference. So the discard
  needs no PR edit and no new "edit PR description" command in the ticketing includes. The ticket's
  implementation summary keeps the line and marks discarded files as removed.
- **Implementation summary** gains one line, **Documentation** — which docs were updated
  (architecture, ADR n, README, changelog) or why none; the include's documentation part asks for it,
  so an opted-out project's summary has no such line. In the ticket comment, spec/plan paths that
  were discarded are still listed, marked as removed (they stay reachable in git history).
- The sentence calling spec and plan "the only durable working files" changes: they are working
  files; the durable documentation is the project's docs (per the include).

### 4. Upgrade path
`npx @strobl_dev/adw@<new> upgrade` does everything: `generate` renders the new include and the
changed body; the existing `skills.mjs` logic records the missing `skills.documentation-and-adrs`
key as `true` and installs the pinned skill. No `upgrade.mjs` entries are needed (nothing is removed
or renamed). README: the skills table, the tooling table, a short "using adw's documentation rules"
section next to the show-me one, and an "Upgrading to vX" note: `upgrade` does it.

**Scope: `agent-dev` runs only** (user's decision). adw's documentation and comment rules reach the
agent only through `agent-dev`, which reads the include. When a coding agent is used directly, the
installed skill can still be invoked (by the user, or by the model when its description matches),
with the skill's own defaults; adw adds nothing always-loaded (no generated rules file, no
`AGENTS.md` text). So the README does **not** suggest deleting comment rules from `AGENTS.md`: they
remain what applies outside `agent-dev`. It states that the shipped rules apply in `agent-dev` runs.

### 5. E2E coverage
- New contract checks in `e2e/lib/trial.mjs` (`CONTRACT_CHECKS`) and wherever reward evidence is
  computed:
  - `docs_architecture` — the PR head contains `docs/architecture/architecture.md` (the seed repos
    have none, so the first run must create it).
  - `spec_plan_discard` — the PR head matches the simulated user's discard answer.
- `e2e/tasks/_shared/persona.md`: the persona answers the discard question with a fixed choice
  (both).
- The Harbor tasks' environment and the `adw e2e` local layer must have the skill installed the same
  way show-me is today.
- The review judge's criteria gain a **new key `comments`** for the comment rule (adw's call: a new
  key rather than folding it into an existing one, so earlier runs' scores keep their meaning; a key
  without a baseline must not count as a regression in `compare.mjs`). The `scope` criterion
  explicitly counts documentation updates and the spec/plan deletion as in scope, so they are not
  judged as unrelated changes. Calibration variants/expectations are adjusted where the new key or
  the scope wording requires it.

## Left to the builder
- Exact wording of the include and the body hooks, within the byte budget above.
- Whether `docs_architecture` also checks content (non-empty sections) or only presence.
- How `adw e2e` local (consumer projects) reports the new checks; a consumer project may already have
  its own docs layout, so presence of the default path cannot be required there.
- Test coverage for the new include rendering (mirror the cost include tests).
