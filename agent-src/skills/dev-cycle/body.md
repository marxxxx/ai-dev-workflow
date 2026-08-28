# {{project.name}} Development Cycle

Coordinate work for tickets in the {{project.name}} repository.
The workflow finishes at human acceptance; never automatically close a ticket.

This skill is explicit authorization to use the project's implementation, review, and QA subagents
for the workflow requested by the user. Spawn project custom agents named `developer`,
`code-reviewer`, and `qa-engineer` where indicated. It consumes approved tickets created
through `$product-architect`; it does not gather requirements or create product tickets.
Keep one ticket's implementation, review, QA, and PR sequence complete before
processing another.

## Ticketing System

Before any ticket operation, read `{{ticketing.include}}`. It is the single source of truth for
listing, reading, creating, commenting, status transitions, branch naming, and pull-request or merge
handoff. Do not hardcode repository names, provider-specific commands, status encoding, labels,
comment mechanisms, or PR commands in this skill — if the ticketing backend changes, only that file
changes. The states below (`new`, `in-progress`, `review`, `test`, `failed`, `acceptance-test`) are
logical; use the exact representation the include defines.

## Cost Accounting

Before any cost operation, read `{{cost.include}}`. It is the single source of truth for recording
each participant's `ccusage` session into a per-run ledger and for posting the token/cost breakdown as
the `{{artifact.costSummary}}` comment when the ticket reaches `acceptance-test`. Do not hardcode
`ccusage` commands, ledger paths, or session-detection logic in this skill.

## Developer Handoff

Before seeding or sizing a journal, auditing a handoff, or spawning a continuation, read
`{{handoff.include}}`. It is the single source of truth for the per-ticket `{{artifact.journal}}`
comment — the living record a developer edits in place as it works, and rewrites its handoff into when
a ticket does not fit one context window — and for how continuations are counted. Do not hardcode the
journal's structure, the handoff's required sections, sizing metadata, or continuation limits in this
skill, and do not hardcode how a comment is created, read, or updated — that belongs to
`{{ticketing.include}}`.

Before dispatch, obtain the ticket's journal comment id: discover it with one listing call, or create
the comment and keep the returned id. Pass that id in the prompt packet so the developer never has to
re-read the ticket to find it.

The division of labour matters: **you seed the journal, the developer only ticks it.** The developer
must never plan, size, or decompose a ticket — that belongs to `$product-architect`, and a ticket
that repeatedly fails to fit is a signal to send back there rather than a load to absorb.

 ## Subagent Context Policy

  When spawning `developer`, `code-reviewer`, or `qa-engineer`, do not fork or share the full
  conversation/session history. Use a fresh subagent context with a self-contained prompt packet.

  Each prompt packet must include only the context required for that role:

  - repository root and current branch/worktree path;
  - issue number, title, current logical state, and issue file/path or ticket lookup command;
  - the upstream ticket reference if the ticket records one — it determines the branch's
    first segment (`feat/<upstream-number>_<slug>`);
  - required ticketing include path: `{{ticketing.include}}`;
  - the cost include path `{{cost.include}}` and this run's cost-ledger path, so the subagent records
    its `ccusage` session (see `{{cost.include}}`);
  - for `developer`: the handoff include path `{{handoff.include}}` and this ticket's
    `{{artifact.journal}}` comment id, so the developer can tick criteria and hand off if the ticket
    does not fit its context window (see `{{handoff.include}}`);
  - for a `developer` continuation: that this attempt **is** a continuation, the continuation number,
    and the criteria that remain — scope the attempt explicitly to those rather than restating the
    whole ticket;
  - relevant prior artifact names: `{{artifact.implementationNotes}}`,
    `{{artifact.reviewFeedback}}`, `{{artifact.testResults}}`, `{{artifact.journal}}`;
  - exact expected status transition and return format;
  - known blockers, iteration count, and user constraints that materially affect this issue.

  Do not paste unrelated parent conversation history. If a subagent needs more context, instruct it to
  read durable sources: `AGENTS.md`, `{{ticketing.include}}`, the issue body/comments, git diff, and
  the relevant code/tests.

## Workflow States

| State | Meaning | Next action |
| --- | --- | --- |
| `new` | Ready to build | Spawn `developer` |
| `in-progress` | Implementation running or interrupted | A filled `Latest handoff` section in the `{{artifact.journal}}` comment means resume: spawn a fresh `developer` continuation scoped to the remaining criteria. An empty one means the attempt was interrupted without handing off: inspect the branch and ticket, and restart `developer` only when needed |
| `review` | Awaiting code review | Spawn `code-reviewer` |
| `test` | Ready for acceptance QA | Spawn `qa-engineer` |
| `failed` | Review or QA failure | Spawn `developer` with recorded feedback |
| `acceptance-test` | PR/human acceptance pending | Create missing PR if needed, then stop automation for that ticket |

## Start

1. Read `AGENTS.md`.
2. Determine whether the request names a ticket; otherwise list the open
   tickets and their states using the commands in `{{ticketing.include}}`.
3. Select only tickets not already in the `acceptance-test` state and whose documented
   dependencies are complete. Process independent tickets in number order unless the
   user chose one.
4. Track a maximum of three implementation-review iterations per ticket unless the user
   explicitly chooses another limit.
5. Track handoff continuations **separately**. A handoff is not a review rejection and the work was
   not defective, so a continuation never consumes an implementation-review iteration. The journal's
   persisted continuation limit controls the maximum (see `{{handoff.include}}`).
6. Before creating a cost ledger or spawning a developer for a ticket in `new`, `failed`, or
   resumable `in-progress`, seed or load its `{{artifact.journal}}` comment (creating it, or
   discovering its id with one listing call) and resolve its sizing metadata:
   - For a new journal, write one unchecked, numbered row per acceptance criterion, count those rows
     only, persist the item count, and derive the continuation limit from it per the table in
     `{{handoff.include}}` — 1 continuation for 1-6 items, 2 for 7-9, 3 for 10-15. Fifteen or fewer
     items record an `automatic` decision and that limit; dispatch the developer without an
     oversized-ticket question. A new journal with more than fifteen items records a `pending`
     decision and a `pending` continuation limit before asking the human.
   - A journal with more than fifteen items and a `pending` decision is already sized but unresolved:
     pause before creating a cost ledger or spawning a developer. Ask the human whether to **proceed**
     with development as scoped or **split** the ticket with `$product-architect`. On restart, reuse
     its item count and ask this unresolved question; do not treat valid `pending` metadata as legacy
     or malformed.
   - On **proceed**, record the decision and the continuation limit `ceil(item count / 5)` before
     dispatch — one attempt per five criteria, with the initial attempt as the buffer. The approved
     examples are: 16 to 20 items use 4 continuations; 21 to 25 items use 5. A continuation is an
     additional developer attempt after the first, so a limit of 4 permits five developers in total.
   - On **split**, record the decision, do not spawn a developer, and do not create a cost ledger.
     End this dev-cycle path, then start `$product-architect` interactively in the same conversation.
     Do not close or accept the original ticket; ticket acceptance and closure remain the human
     workflow.
   - On restart, reuse a valid item count, recorded proceed decision, and continuation limit without
     asking again. A ticket carrying only legacy append-only `Developer Handoff` comments and no
     journal comment is seeded from the most recent one per `{{handoff.include}}`, then sized as a
     new journal. When a legacy journal lacks sizing metadata, or any sizing value is malformed,
     recount its criteria, perform this sizing check once, and record valid `automatic` or `pending`
     metadata before developer dispatch. A missing or malformed value must fail safely rather than
     grant an unlimited limit.
7. After the sizing step permits developer work — or immediately for a ticket that will only enter
   review or QA — start its cost ledger before spawning any subagent: follow `{{cost.include}}` to
   create this run's ledger (a unique per-run path) and record your own orchestrator session. Pass
   the ledger path in every subagent prompt packet. Never create a ledger for the split path.

## Implement Or Fix

For the `new` or `failed` state, spawn the custom `developer` subagent with the ticket
number, title, current state, branch/worktree context, and instruction to read all comments.

The developer owns:

- moving the ticket to the `in-progress` state before edits;
- working on `{{git.branchPattern}}` — when the ticket records an upstream ticket, its
  number is the branch's first segment instead of the implementation ticket number (see
  `{{ticketing.include}}`);
- implementing and validating the ticket;
- posting `{{artifact.implementationNotes}}`;
- moving the ticket to the `review` state only after completion;
- stopping at an acceptance-criterion boundary and rewriting the `Latest handoff` section of the
  `{{artifact.journal}}` comment instead, when the remaining work does not fit its context window
  (see `{{handoff.include}}`).

After it returns, inspect its reported changes and re-read the ticket state/comments. Do not accept a
claimed completion if the state, branch, or validation evidence is missing. Its run ended in exactly
one of three outcomes — decide which from the ticket, not from the returned prose:

- **Complete** — ticket at `review` with `{{artifact.implementationNotes}}` posted. Continue to
  review.
- **Handoff** — ticket still at `in-progress`, with the `{{artifact.journal}}` comment's `Latest
  handoff` section rewritten for this attempt. Read the journal by its id — one read, no ticket
  re-listing — and audit it before spawning a continuation:
    - all seven required sections from `{{handoff.include}}` are present;
    - the criteria status covers every acceptance criterion, each marked done or remaining;
    - the map names concrete files and symbols, not areas — a vague map means the next developer
      re-explores, which is the entire cost this protocol exists to avoid;
    - the work is committed on the feature branch, and the named commit exists;
    - if a section is missing or empty, do not silently accept it: reconstruct what you can from the
      branch diff and the ticket, and state the gap in the continuation's prompt packet.
  Then increment the continuation count and spawn a **fresh** developer scoped to the remaining
  criteria. A continuation does not consume an implementation-review iteration.
- **Blocked** — ticket still at `in-progress` with a reported blocker and no new handoff written into
  the journal. Report
  it for human attention; do not spawn a continuation to work around it.

Two limits apply to continuations:

- **Progress guard (unchanged)** — each continuation must show measurable progress: at least one newly completed
  criterion, or a materially larger branch diff. If two consecutive continuations show neither, stop.
  The ticket is stuck, not large, and another attempt will repeat the failure.
- **Exhaustion** — at the continuation limit, stop automation for that ticket. Leave it at
  `in-progress` with its `{{artifact.journal}}` comment intact and report that the ticket is too
  large to implement as scoped and should be split via `$product-architect`. Do not split it
  yourself, and do not keep cycling.

## Review

For the `review` state, spawn the custom `code-reviewer` subagent with the ticket
number, title, branch/worktree context, and instruction to read the acceptance criteria and
implementation notes. The reviewer compares branch changes to the acceptance criteria and
implementation guidance, prioritizing correctness, regressions, security, and missing tests.

The code-reviewer owns:

- adding a `{{artifact.reviewFeedback}}` comment with actionable findings when critical or important
  findings exist, then moving the ticket from `review` to `failed` so it returns to
  `developer`;
- moving the ticket from `review` to `test` when review passes or has only minor
  non-blocking observations.

After it returns, verify the posted comment (if any) and the status transition before continuing.
Count each return to development as an iteration. At the iteration limit, report the
ticket as blocked for human attention and do not continue cycling. The maximum of three
implementation-review iterations is unchanged by journal sizing.

## QA

For the `test` state, spawn the custom `qa-engineer` subagent with the ticket number,
branch/worktree context, and whether the ticket includes visual/UI work.

For visual/UI work, require:

- functional criteria tested objectively;
- before/after screenshots when a baseline comparison can be performed without disrupting local
  changes;
- subjective criteria reported as `NEEDS HUMAN REVIEW`, never automatically passed.
- no PASS based solely on unit tests, direct component method calls, utility calls, mocked events, API calls, or DOM state injection;
- `NEEDS HUMAN REVIEW` only for subjective visual claims, not for untested functional behavior —
  except when no e2e runtime is configured (see `{{app.include}}`), where functional UI/interactive
  criteria that need a running app may be deferred as `NEEDS HUMAN REVIEW` with a note.

After QA returns, audit the `{{artifact.testResults}}` comment before accepting the handoff:

  - every acceptance criterion must appear in the result matrix;
  - every UI criterion must name the route/control/action used;
  - evidence artifact paths must be present for browser-tested UI criteria;
  - any criterion marked untested, blocked, or verified only by internal calls means QA did not pass;
  - exception: when e2e was skipped per `{{app.include}}` (the runtime is unconfigured, or `up`
    intentionally started no app), UI/interactive criteria deferred as `NEEDS HUMAN REVIEW` (with a
    note and a passing automated suite) are an acceptable handoff, not a QA failure — advance to PR
    and carry the human-review items forward;
  - if the QA evidence is incomplete or invalid, do not advance to PR handoff. Move the
    ticket to `failed` with a corrective comment, or return it to QA when the only issue
    is missing evidence and no functional failure was observed.

For handoff move the ticket to `acceptance-test`. If failed, return to implementation.

On the move to `acceptance-test`, follow `{{cost.include}}` to aggregate this run's ledger sessions
(and the `{{artifact.costOrigin}}` marker product-architect left on the ticket) and post the
`{{artifact.costSummary}}` comment, then clean up the ledger. Cost reporting never blocks the
handoff — if `ccusage` or a session is unavailable, post the summary noting the gap.

The `{{artifact.journal}}` comment stays on the ticket as the durable record of how the work
progressed — there is nothing to clean up, except under file-based ticketing, whose local journal file
is deleted at this point (see `{{handoff.include}}` and `{{ticketing.include}}`).

## Pull Request And Handoff

Once a ticket reaches `acceptance-test`, create a PR from its feature branch to
`{{git.prTarget}}` if one does not already exist (see `{{ticketing.include}}`). The PR body must include:

- the related ticket number and implementation summary;
- code review and QA results;
- explicit human acceptance steps;
- every `NEEDS HUMAN REVIEW` criterion and its available screenshot references.

Report the PR URL and leave the ticket open at `acceptance-test`. A human reviews,
merges, and closes it.

If a ticket was already at `acceptance-test` when this run started (for example only a missing PR had
to be created), ensure the `{{artifact.costSummary}}` comment exists: post it per `{{cost.include}}`
if absent, and never post a duplicate if one is already present.

## Guardrails

- Do not bypass required requirements or visual approval work owned by `$product-architect`.
- Do not let an agent overwrite or revert unrelated changes in a shared worktree.
- Do not proceed past a missing approval, missing tool, unavailable browser verification, or
  unverified status transition; report the blocker.
- Capture review and test feedback in ticket comments so a later agent has durable context.
- Do not push a developer to finish a ticket that does not fit its context window. A clean handoff
  and a fresh continuation beat a degraded session; repeated handoffs on one ticket are a scoping
  signal to report, not a load to absorb.
