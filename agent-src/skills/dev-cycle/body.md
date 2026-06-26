# {{project.name}} Development Cycle

Coordinate work for {{ticketing.itemNoun}}s in the {{project.name}} repository.
The workflow finishes at human acceptance; never automatically close a {{ticketing.itemNoun}}.

This skill is explicit authorization to use the project's implementation, review, and QA subagents
for the workflow requested by the user. Spawn project custom agents named `developer`,
`code-reviewer`, and `qa-engineer` where indicated. It consumes approved {{ticketing.itemNoun}}s created
through `$product-architect`; it does not gather requirements or create product {{ticketing.itemNoun}}s.
Keep one {{ticketing.itemNoun}}'s implementation, review, QA, and PR sequence complete before
processing another.

## Ticketing System

Before any ticket operation, read `{{ticketing.include}}`. It is the single source of truth for
listing, reading, creating, commenting, status transitions, branch naming, and pull-request or merge
handoff. Do not hardcode repository names, provider-specific commands, status encoding, labels,
comment mechanisms, or PR commands in this skill — if the ticketing backend changes, only that file
changes. The states below (`new`, `in-progress`, `review`, `test`, `failed`, `acceptance-test`) are
logical; use the exact representation the include defines.

 ## Subagent Context Policy

  When spawning `developer`, `code-reviewer`, or `qa-engineer`, do not fork or share the full
  conversation/session history. Use a fresh subagent context with a self-contained prompt packet.

  Each prompt packet must include only the context required for that role:

  - repository root and current branch/worktree path;
  - issue number, title, current logical state, and issue file/path or ticket lookup command;
  - required ticketing include path: `{{ticketing.include}}`;
  - relevant prior artifact names: `{{artifact.implementationNotes}}`,
    `{{artifact.reviewFeedback}}`, `{{artifact.testResults}}`;
  - exact expected status transition and return format;
  - known blockers, iteration count, and user constraints that materially affect this issue.

  Do not paste unrelated parent conversation history. If a subagent needs more context, instruct it to
  read durable sources: `AGENTS.md`, `{{ticketing.include}}`, the issue body/comments, git diff, and
  the relevant code/tests.

## Workflow States

| State | Meaning | Next action |
| --- | --- | --- |
| `new` | Ready to build | Spawn `developer` |
| `in-progress` | Implementation running or interrupted | Inspect state; continue `developer` only when needed |
| `review` | Awaiting code review | Spawn `code-reviewer` |
| `test` | Ready for acceptance QA | Spawn `qa-engineer` |
| `failed` | Review or QA failure | Spawn `developer` with recorded feedback |
| `acceptance-test` | PR/human acceptance pending | Create missing PR if needed, then stop automation for that {{ticketing.itemNoun}} |

## Start

1. Read `AGENTS.md`.
2. Determine whether the request names a {{ticketing.itemNoun}}; otherwise list the open
   {{ticketing.itemNoun}}s and their states using the commands in `{{ticketing.include}}`.
3. Select only {{ticketing.itemNoun}}s not already in the `acceptance-test` state and whose documented
   dependencies are complete. Process independent {{ticketing.itemNoun}}s in number order unless the
   user chose one.
4. Track a maximum of three implementation-review iterations per {{ticketing.itemNoun}} unless the user
   explicitly chooses another limit.

## Implement Or Fix

For the `new` or `failed` state, spawn the custom `developer` subagent with the {{ticketing.itemNoun}}
number, title, current state, branch/worktree context, and instruction to read all comments.

The developer owns:

- moving the {{ticketing.itemNoun}} to the `in-progress` state before edits;
- working on `{{git.branchPattern}}`;
- implementing and validating the {{ticketing.itemNoun}};
- posting `{{artifact.implementationNotes}}`;
- moving the {{ticketing.itemNoun}} to the `review` state only after completion.

After it returns, inspect its reported changes and re-read the {{ticketing.itemNoun}} state/comments.
Do not accept a claimed handoff if the state, branch, or validation evidence is missing.

## Review

For the `review` state, spawn the custom `code-reviewer` subagent with the {{ticketing.itemNoun}}
number, title, branch/worktree context, and instruction to read the acceptance criteria and
implementation notes. The reviewer compares branch changes to the acceptance criteria and
implementation guidance, prioritizing correctness, regressions, security, and missing tests.

The code-reviewer owns:

- adding a `{{artifact.reviewFeedback}}` comment with actionable findings when critical or important
  findings exist, then moving the {{ticketing.itemNoun}} from `review` to `failed` so it returns to
  `developer`;
- moving the {{ticketing.itemNoun}} from `review` to `test` when review passes or has only minor
  non-blocking observations.

After it returns, verify the posted comment (if any) and the status transition before continuing.
Count each return to development as an iteration. At the iteration limit, report the
{{ticketing.itemNoun}} as blocked for human attention and do not continue cycling.

## QA

For the `test` state, spawn the custom `qa-engineer` subagent with the {{ticketing.itemNoun}} number,
branch/worktree context, and whether the {{ticketing.itemNoun}} includes visual/UI work.

For visual/UI work, require:

- functional criteria tested objectively;
- before/after screenshots when a baseline comparison can be performed without disrupting local
  changes;
- subjective criteria reported as `NEEDS HUMAN REVIEW`, never automatically passed.
- no PASS based solely on unit tests, direct component method calls, utility calls, mocked events, API calls, or DOM state injection;
- `NEEDS HUMAN REVIEW` only for subjective visual claims, not for untested functional behavior.

After QA returns, audit the `{{artifact.testResults}}` comment before accepting the handoff:

  - every acceptance criterion must appear in the result matrix;
  - every UI criterion must name the route/control/action used;
  - evidence artifact paths must be present for browser-tested UI criteria;
  - any criterion marked untested, blocked, or verified only by internal calls means QA did not pass;
  - if the QA evidence is incomplete or invalid, do not advance to PR handoff. Move the
    {{ticketing.itemNoun}} to `failed` with a corrective comment, or return it to QA when the only issue
    is missing evidence and no functional failure was observed.

For handoff move the {{ticketing.itemNoun}} to `acceptance-test`. If failed, return to implementation.

## Pull Request And Handoff

Once a {{ticketing.itemNoun}} reaches `acceptance-test`, create a PR from its feature branch to
`{{git.prTarget}}` if one does not already exist (see `{{ticketing.include}}`). The PR body must include:

- the related {{ticketing.itemNoun}} number and implementation summary;
- code review and QA results;
- explicit human acceptance steps;
- every `NEEDS HUMAN REVIEW` criterion and its available screenshot references.

Report the PR URL and leave the {{ticketing.itemNoun}} open at `acceptance-test`. A human reviews,
merges, and closes it.

## Guardrails

- Do not bypass required requirements or visual approval work owned by `$product-architect`.
- Do not let an agent overwrite or revert unrelated changes in a shared worktree.
- Do not proceed past a missing approval, missing tool, unavailable browser verification, or
  unverified status transition; report the blocker.
- Capture review and test feedback in {{ticketing.itemNoun}} comments so a later agent has durable context.
