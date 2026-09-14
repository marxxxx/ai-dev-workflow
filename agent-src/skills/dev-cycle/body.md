# {{project.name}} Development Cycle

Coordinate an approved ticket through implementation, review, QA, and PR handoff. Never gather
requirements, create product tickets, merge, close, or accept a ticket. Process one ticket's full
cycle before starting another.

This skill authorizes the custom `developer`, `code-reviewer`, and `qa-engineer` subagents. Each
isolated subagent owns its assigned technical work and resulting status transition. You own dispatch,
workflow validation, retry and continuation limits, cost accounting, and final handoff; do not repeat
their implementation, review, or QA judgments.

## Runtime Instructions

- Before ticket operations, read `{{ticketing.include}}` for provider commands, logical-state
  encoding, comments, branch naming, and PR handoff.
- Before cost operations, read `{{cost.include}}` for the per-run ledger and
  `{{artifact.costSummary}}` protocol.
- Before creating or sizing a journal, checking a handoff, or spawning a continuation, read
  `{{handoff.include}}`. It is authoritative for the `{{artifact.journal}}` shape, sizing values, handoff
  contents, progress guard, and continuation limits. Ticketing mechanics for that artifact remain in
  `{{ticketing.include}}`.

Never duplicate provider details or include-owned rules here.

## Isolated Prompt Packets

Spawn every role in a fresh context with a self-contained packet. Include only:

- repository root and branch/worktree;
- ticket number, title, logical state, upstream reference, and lookup path/command;
- `{{ticketing.include}}`, `{{cost.include}}`, and this run's ledger path;
- relevant artifact names and the expected outcome, status transition, and return format;
- known blockers, implementation-review iteration, and material user constraints;
- for developers, `{{handoff.include}}` and the journal id; for a continuation, also its continuation
  number and only the remaining criteria.

Direct subagents to durable context (`AGENTS.md`, the ticket and relevant comments, branch diff,
code, and tests), not parent conversation history.

## States

| State | Dispatch |
| --- | --- |
| `new` | Developer implementation |
| `in-progress` | Continue only from a current, unconsumed handoff; recover an already-consumed attempt without incrementing; otherwise inspect before restarting |
| `review` | Code review |
| `test` | Acceptance QA |
| `failed` | New developer iteration with recorded feedback |
| `acceptance-test` | Cost summary and provider-specific PR/human handoff, then stop |

## Start

1. Read `AGENTS.md` and the required runtime includes.
2. Use the named ticket, or list open tickets and their states. Exclude `acceptance-test` and blocked
   dependencies; unless the user selected one, process eligible tickets by number.
3. Enforce a maximum of three implementation-review iterations unless the user chooses another
   limit. Persist the current iteration and its continuation count in the journal. Derive the
   iteration from durable blocking review/QA artifacts so restarts do not double-count; developer
   handoff continuations are separate.
4. Before developer work in `new`, `failed`, or resumable `in-progress`, seed or load the ticket's
   single journal and retain its comment id. Resolve sizing as follows:
   - For a new journal, create one numbered unchecked row per acceptance criterion. Count only those
     rows and persist the item count, sizing decision, and continuation limit exactly as
     `{{handoff.include}}` derives them. The thresholds and limits are authoritative;
     do not restate or recompute them here. When those rules size the count as `automatic`, dispatch
     the developer without an oversized-ticket question; otherwise record a `pending` decision and a
     `pending` continuation limit before asking the human.
   - A journal with a `pending` decision is already sized but unresolved: pause before creating a
     cost ledger or spawning a developer. Ask the human to **proceed** as scoped or **split** through
     `$product-architect`.
   - On **proceed**, persist the decision and include-defined limit before dispatch. Reuse a valid
     item count, recorded proceed decision, and continuation limit after restart without
     asking again.
   - On **split**, record the decision, do not spawn a developer, and do not create a cost ledger.
     End this dev-cycle path, then start `$product-architect` interactively in the same conversation.
     Do not close or accept the original ticket.
   - If only legacy append-only handoffs exist, seed the journal from the newest one. If a legacy journal
     lacks sizing metadata or contains malformed values, recount and record valid metadata
     before developer dispatch. Derive missing iteration/count values from blocking review/QA
     comments and subsequent handoff attempts, then persist them. Never assume an unlimited allowance.
5. Once sizing permits work—or immediately when resuming at `review` or `test`—follow
   `{{cost.include}}` to reuse the journal's available ledger or create and record a new ledger id.
   Record the orchestrator session and pass the active path to every subagent. Never create one for
   the split path.

## Developer Phase

For `new`, spawn `developer` with the packet above. For `failed`, require the newest blocking review
or QA stamp to equal the derived target iteration minus one, then apply `{{handoff.include}}`'s
distinct-failure validation, idempotent reset, and iteration limit. The target may equal the journal's
current iteration after a restart or its immediate successor before reset. Spawn only after those
checks pass. For a handed-off `in-progress` ticket, follow the continuation procedure below. In every
case, tell the developer to read the relevant comments.

After the developer returns, validate protocol rather than re-auditing the implementation:

- **Complete:** require `review`, a posted `{{artifact.implementationNotes}}`, required validation
  reported, and all journal criteria checked. Then dispatch review.
- **Handoff:** require `in-progress`, an updated `Latest handoff`, its identity matching the prompt
  counters, and the named commit. Read the journal by id and check the include-required structure;
  do not reinterpret technical decisions.
- **Blocked:** when the developer explicitly reports a genuine blocker, report it for human attention
  and stop. Never replace a blocked developer automatically.
- **Unexpected return:** when the developer neither completes nor explicitly blocks, or writes a
  malformed handoff, spawn one fresh recovery at the same iteration and continuation counters. Name
  every structural gap and direct recovery from the branch diff and ticket artifacts. If recovery
  also returns unexpectedly, stop for human attention.

For a valid new handoff, apply the include's progress check and verify the current count is below the
limit. Then increment the count and mark that handoff consumed in one journal write before spawning
a fresh developer for the remaining criteria. If the handoff was already consumed before a restart,
reuse the stored count and recover at that continuation without incrementing. A continuation never
consumes an implementation-review iteration.

Enforce the include-owned limits. Its **Progress guard (unchanged)** stops after two consecutive continuations
without a newly completed criterion or materially larger branch diff. At exhaustion,
leave the ticket `in-progress` and journal intact; recommend `$product-architect` splitting without
splitting or continuing automatically.

The maximum of three implementation-review iterations is unchanged by journal sizing.

## Review Phase

For `review`, spawn `code-reviewer` with the branch, acceptance criteria, architecture guidance, and
implementation notes. The reviewer owns the audit and moves the ticket to:

- `test` when it passes; or
- `failed` after posting `{{artifact.reviewFeedback}}` for blocking findings.

On return, verify only the expected state and, for `failed`, a feedback artifact stamped with the
active implementation iteration. Trust the review decision; do not inspect the code as a second
reviewer. A valid `failed` outcome returns to the Developer Phase.

## QA Phase

For `test`, spawn `qa-engineer` with the ticket, branch/worktree, implementation notes, and whether
the scope includes UI or subjective visual work. The QA engineer owns acceptance testing,
`{{artifact.testResults}}`, and the transition to:

- `acceptance-test` when functional QA passes, including allowed `NEEDS HUMAN REVIEW` items; or
- `failed` when a functional criterion fails; or
- `test` when required infrastructure or tooling blocks QA before a result can be established.

On return, validate only workflow evidence: the results artifact exists, covers every criterion,
references browser evidence where produced, and the ticket reached an allowed state. Do not rerun
tests or reassess QA conclusions. Missing or contradictory protocol evidence blocks advancement and
must be reported. For `failed`, require the results artifact's iteration stamp, then return to the
Developer Phase. A reported `BLOCKED` result at `test` stops for human attention without consuming an
iteration.

## Acceptance Handoff

At `acceptance-test`:

1. Follow `{{cost.include}}` to post one idempotent `{{artifact.costSummary}}` and clean up the run
   ledger. Missing cost data never blocks handoff; record the gap.
2. Follow `{{ticketing.include}}` for provider-specific journal cleanup and PR or branch handoff.
   Where automation creates a PR, include the ticket, implementation summary, review and QA results,
   human acceptance steps, and every `NEEDS HUMAN REVIEW` item with available screenshots.
3. Report the PR or branch handoff and stop. Leave acceptance, merge, and closure to a human.

If the run starts at `acceptance-test`, create only missing handoff artifacts and never duplicate the
cost summary.

## Guardrails

- Validate status and durable artifacts before dispatching the next phase; never infer a successful
  result from subagent prose alone.
- Do not overwrite unrelated work or bypass approvals owned by `$product-architect`.
- Report unavailable required tools, approvals, or status transitions instead of bypassing them.
- Keep review and QA findings in ticket comments so the next isolated developer has durable context.
