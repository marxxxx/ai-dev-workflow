# Developer Handoff: Surviving A Ticket Larger Than One Context Window

This file is the single source of truth for how a `developer` that cannot finish a ticket in one
session stops cleanly and hands the remaining work to a fresh developer. It is generated from
`agent-src/includes/handoff.md`. Do not edit it here — edit the source and regenerate.

The problem it solves: a ticket that was scoped too coarsely does not fit one context window. Without
a protocol the developer keeps pushing until it degrades or dies mid-edit, and its replacement
re-discovers the same codebase from scratch — burning a second window on work the first one already
did.

**The developer never plans, sizes, or decomposes a ticket.** That is `$product-architect`'s job.
The developer only does bookkeeping against acceptance criteria that already exist, and makes one
local judgment: *can I finish the criterion in front of me?*

## One artifact: the `{{artifact.journal}}` comment

| What | Where | Lifetime |
| --- | --- | --- |
| Mutable checklist, running notes, attempt log, and the latest resume document | **A single ticket comment**, created once per ticket and **edited in place** via `{{ticketing.include}}` | Lives with the ticket |

All progress state lives on the ticket. There is no side file and no run state to lose: the ticket is
the whole record, visible to the human supervising the run, and a run that resumes on a different
machine resumes from exactly the same state.

**Addressing the comment.** The journal comment is identified by its first line, the heading
`## {{artifact.journal}}`. Its **comment id** is discovered **once per ticket** — one list-comments
call, filtered for that heading, newest match wins — and then travels in the prompt packet to the
`developer` and to every continuation. After that, every update is an in-place write **by id**: no
re-listing, no re-reading the ticket. See `{{ticketing.include}}` for the backend's exact create,
discover, read-by-id, and update-by-id commands; some backends have no read-by-id and read from the
one listing call instead.

Because the id is derivable from the ticket at any time with a single listing call, losing it is
never a blocker — rediscover it and carry on.

**Read-modify-write discipline.** An update replaces the comment's whole body, so always write the
full journal, not a fragment. The writer normally still holds the body it last wrote and does not
need to read first; a fresh session reads the journal once before its first write.

**File-based ticketing is the one exception.** Where the backend has no real comment objects, the
journal stays a local Markdown file and the ticket carries a `## {{artifact.journal}}` section
recording its path. `{{ticketing.include}}` defines that arrangement; everything below applies
unchanged to its contents.

## The journal comment

```markdown
## {{artifact.journal}}

Ticket <number> — <title>
Branch: <branch>   Upstream: <ref or none>

### Sizing

- Item count: <positive integer>
- Sizing decision: <automatic | pending | proceed | split>
- Continuation limit: <positive integer | pending>
- Implementation-review iteration: <positive integer>
- Continuation count: <non-negative integer>

### Orchestration

- Cost ledger ids: <none | comma-separated ledger basenames | cleaned>
- Last consumed handoff: <none | i<iteration>/c<continuation>>

### Criteria

- [ ] 1. <acceptance criterion, quoted from the ticket>
- [ ] 2. <acceptance criterion, quoted from the ticket>

### Discovered context

<!-- files, symbols, conventions, utilities to reuse; appended as they are found -->

### Attempts

<!-- one line per developer attempt: i<iteration>/c<continuation>, criteria completed, outcome, commit -->

### Latest handoff

<!-- `Attempt: i<iteration>/c<continuation>`, then the seven required sections below; rewritten in
     full by each handing-off developer -->
```

Markdown, so a human reading the ticket can follow the run without any extra tooling.

### Sizing metadata

The `### Sizing` and `### Orchestration` values are owned by the orchestrator (`dev-cycle`), not the
developer; a developer preserves them unchanged whenever it writes the journal. They make the
large-ticket decision and the loop counters durable across restarts:

- **Item count** is the number of numbered acceptance-criterion rows in `### Criteria` only. Count
  both checked and unchecked rows; do not count notes, attempts, or other Markdown lists.
- **Sizing decision** is `automatic` for fifteen or fewer items, `pending` while an oversized journal
  awaits the human, `proceed` after the human approves development as scoped, or `split` after the
  human sends it back to `$product-architect`.
- **Continuation limit** is the number of *additional* developer attempts allowed after the first
  one within a single implementation-review iteration — with a limit of 1, each iteration may run two
  developers in total. It scales with the item count on
  the estimate that one attempt covers about five criteria, with the initial attempt as the buffer:

  | Item count | Continuation limit |
  | --- | --- |
  | 1-6 | 1 |
  | 7-9 | 2 |
  | 10-15 | 3 |
  | above the `automatic` threshold (`proceed` only) | `ceil(item count / 5)` — 4 for 16-20, 5 for 21-25 |

  It remains `pending` only while the decision is `pending` or `split`.
- **Implementation-review iteration** is the active pass through development, review, and QA. It
  starts at 1 and advances only when a review or QA failure returns the ticket to development (see
  [Loop control](#loop-control-orchestrator)).
- **Continuation count** is the number of continuations already spawned in the active iteration. It
  starts at 0 and resets to 0 when the iteration advances.

The `### Orchestration` values make the rest of a run restart-safe:

- **Cost ledger ids** lists the basename of every cost ledger any run of this ticket has created, so
  an interrupted run's ledger is still priced at handoff (see `{{cost.include}}`). `cleaned` means the
  ledgers were aggregated and deleted.
- **Last consumed handoff** is the `Attempt` identity of the most recent handoff a continuation was
  spawned for, so a restart never spawns a second continuation for the same handoff.

The orchestrator writes all sizing values immediately after it seeds a journal. A legacy journal that
lacks sizing metadata, or one with missing, non-positive, or inconsistent values, is never allowed
to dispatch a developer on an assumed unlimited allowance. Recount its criterion rows, run the
sizing decision procedure once, and persist valid replacement metadata before dispatching.

## Who does what

**The orchestrator (`dev-cycle`) seeds the journal comment.** Before spawning `developer` for a ticket
it reads the ticket — which it already holds — and creates the comment with one **unchecked** row per
acceptance criterion, numbered, quoted from the ticket, plus the sizing metadata (iteration 1,
continuation count 0), `Cost ledger ids: none`, `Last consumed handoff: none`, and empty
`Discovered context`, `Attempts`, and `Latest handoff` sections. It keeps the returned comment id and
passes it in the prompt packet. The developer therefore receives a checklist it did not have to
author. If a journal comment already exists (a continuation), the orchestrator reuses it and its valid
sizing metadata rather than creating a second one or asking the human again.

**Never create a second journal comment on a ticket.** One ticket, one journal comment, edited in
place. If two ever exist, the newest is authoritative — fold anything worth keeping from the older one
into it and stop writing to the old one.

**The developer ticks rows.** For each criterion, in ticket order:

1. Implement it.
2. Validate it — run the applicable tests and lint/type checks for what you changed.
3. Tick its row and append two or three lines underneath: files touched, tests run and their result,
   any decision worth not relitigating. Write the updated journal back to the comment by id.
4. Append anything newly learned to `Discovered context` — a file that turned out to matter, a
   convention, an existing utility that should be reused, an approach that failed.
5. **Commit the work on the feature branch.** The branch diff is a fresh developer's main recovery
   channel, so a criterion that is finished but uncommitted is a criterion that will be redone. This
   commit is required regardless of whether the parent asked for commits.

## The stop rule

**Never begin work on the next criterion if you cannot also finish it and write the handoff.**

That is a judgment about the single unit of work in front of you, not an estimate of the whole
ticket. Two hints break ties:

- Around **half** your context window consumed: prefer stopping at the next criterion boundary rather
  than starting another one.
- Around **three quarters** consumed: stop at the current boundary immediately and hand off. Do not
  start anything else, and do not attempt "just one more small fix" — the handoff itself needs room.

Reserve enough budget to write a complete handoff. A truncated handoff is worse than an early one:
the next developer re-explores anyway, and the attempt is wasted.

## Handing off

1. Commit the work in progress on the feature branch. If some of it does not build or does not pass,
   commit it anyway and say so in the handoff — losing it is worse than recording it as broken.
2. Update the journal comment in one write: tick what is done, add this attempt to `Attempts`, and
   **replace** `### Latest handoff` with an `Attempt: i<iteration>/c<continuation>` line — the
   counters from your prompt packet — followed by the seven sections below. The previous handoff is
   superseded — its history survives as the `Attempts` line, which is why that line must name the
   attempt's outcome and commit.
3. **Leave the ticket in the `{{status.in-progress}}` state.** A handoff is not a completion —
   never move the ticket to `{{status.review}}`, and do not post `{{artifact.implementationNotes}}`
   (that comment means "this ticket is finished and ready for review").
4. Return to the parent stating plainly that you handed off, which criteria are done, which remain,
   and the commit you left the branch on.

### Required sections of `### Latest handoff`

All seven, in this order. The orchestrator audits for them, and a handoff missing the map or the next
step forces the next developer to re-explore — which is the whole cost this protocol exists to avoid.

1. **Criteria status** — every acceptance criterion, quoted from the ticket, marked done or remaining.
2. **Where the work stands** — branch name, last commit SHA, and what is committed versus
   uncommitted or known-broken.
3. **Map** — the files and symbols that matter for the remaining work, the conventions this area
   follows, and the existing utilities to reuse. *This is the section that saves the next window:
   it replaces exploration, so be specific — name paths and symbols, not areas.*
4. **Decisions made and why** — so the next developer does not relitigate settled choices.
5. **Dead ends** — approaches already tried that do not work, and why. Equally valuable: it stops the
   next developer from spending its window rediscovering a wall.
6. **Exact next step** — the single concrete action to take first, not a plan.
7. **Validation status** — which tests exist, which pass, which fail, and which are not written yet.

## Resuming from a handoff

When the prompt packet says this is a continuation, **before exploring anything**:

1. Read the journal comment — one read, by the id the packet gave you. It carries the criteria
   checklist, the discovered context, the attempt log, and the latest handoff's seven sections. The
   packet's iteration and continuation number must match the journal's `Implementation-review
   iteration` and `Continuation count`; if they do not, stop and report the mismatch to the parent
   rather than writing a handoff under the wrong identity.
2. Read the branch diff for the criteria already marked done.

Then trust the map. Do not re-derive what the journal already recorded, and do not re-attempt what
its dead-ends section rules out — re-exploration is exactly the cost this protocol exists to avoid.
Verify rather than rediscover: if something in the map turns out to be wrong, correct it in the
journal so the error does not propagate.

Work the remaining criteria under the same rules. A continuation may itself hand off.

## Legacy tickets

A ticket worked before this protocol may have no journal comment but one or more append-only
`Developer Handoff` comments. Seed the journal comment from the most recent one — its seven sections
become `### Latest handoff`, its criteria status becomes the `### Criteria` rows — then run the sizing
procedure once and persist valid metadata. Leave the old comments in place as history; never write
to them again.

A journal that predates the loop counters is migrated the same way: derive the iteration from the
failure artifacts (see [Loop control](#loop-control-orchestrator); an unstamped legacy failure counts
once per artifact), set the continuation count from the handoffs recorded since the last failure, and
persist both along with `### Orchestration` before dispatching.

## Loop control (orchestrator)

- Handoff **continuations are counted separately** from implementation-review iterations and do not
  consume one — a handoff is not a review rejection, and the work was not defective.
- The journal's persisted **Continuation limit** controls the maximum number of continuations. It is
  derived once, when the orchestrator seeds the journal, from the item count under
  [Sizing metadata](#sizing-metadata) — read the persisted value rather than recomputing it here.
  This changes neither the progress guard nor the implementation-review iteration limit. The
  persisted **Continuation count** is scoped to the active implementation-review iteration.
- **Consuming a handoff** — a handoff is new only when its `Attempt` identity matches the journal's
  active iteration and continuation count and differs from `Last consumed handoff`. Before spawning a
  continuation for a new handoff, apply the progress guard and verify the count is below the limit;
  then, **in one journal write**, increment the count and set `Last consumed handoff` to that identity,
  and only then spawn the continuation with the new count. After a restart, a handoff that is already
  consumed means its continuation was spawned but never finished: reuse the stored count and spawn a
  recovery at that same continuation number, without incrementing again.
- **Advancing the iteration** — every blocking `{{artifact.reviewFeedback}}` and every
  `{{artifact.testResults}}` comment begins with `Implementation iteration: <number>`, so the failure
  history survives a restart. On `{{status.failed}}`, consider the distinct stamped failures only:
  they must include the failure that caused the current state, form a contiguous sequence starting at
  iteration 1, and hold no conflicting review and QA failures for the same iteration. The target
  iteration is one above the highest valid failed iteration, and must equal either the journal's
  iteration (the advance was already written before a restart) or its immediate successor; anything
  else stops for human attention. Only for the successor, in one journal write, set the new
  iteration, reset the continuation count to 0, clear `Latest handoff`, and reset `Last consumed
  handoff` to `none`. Duplicate comments of one artifact type for the same iteration never advance it
  twice.
- **Progress guard** — a continuation must show measurable progress: at least one newly ticked
  criterion, or a materially larger branch diff. If two consecutive continuations show neither, stop:
  the ticket is stuck, not large, and continuing will only repeat the failure.
- **On exhaustion** — stop automation for that ticket. Leave it in `{{status.in-progress}}` with its
  `{{artifact.journal}}` comment intact, and report to the human that the ticket is too large to
  implement as scoped and should be split via `$product-architect`. Do not split it yourself, and do
  not silently keep cycling.

Repeated handoffs on one ticket are a **signal about the ticket, not about the developer**. Surface
it — a ticket that reaches its persisted continuation limit was scoped too coarsely, and that is
information the human needs for the next round of planning.

## Cleanup

When the ticket reaches `{{status.acceptance-test}}`, every ledger listed in `Cost ledger ids` is
deleted per `{{cost.include}}` and the field is set to `cleaned` before any backend-specific journal
cleanup.
