# Developer Handoff: Tickets Larger Than One Context Window

This generated include defines how a developer stops at a clean boundary and transfers unfinished
work to a fresh developer. Edit `agent-src/includes/handoff.md`, then regenerate.

The developer never plans, sizes, or decomposes a ticket. `$product-architect` owns scope; the
developer works existing acceptance criteria and decides only whether the current criterion can be
finished safely.

## Journal Artifact

`{{artifact.journal}}` is the ticket's single mutable checklist, discovery log, attempt history, and
latest resume document. Create it once and update it in place. `{{ticketing.include}}` defines how to
create, discover, read, and update it for the selected backend.

For comment-based backends, identify it by the first-line heading `## {{artifact.journal}}`. Discover
the newest matching comment id once, carry that id in every developer packet, and update by id
without re-listing. Losing the id is not a blocker: rediscover it once. Because updates replace the
whole body, always write the complete journal.

For file ticketing, the issue points to one stable machine-local journal file instead. Follow that
backend's recovery and cleanup procedure.

## Journal Shape

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
- Last consumed handoff: <none or iITERATION/cCONTINUATION>

### Criteria

- [ ] 1. <acceptance criterion, quoted from the ticket>
- [ ] 2. <acceptance criterion, quoted from the ticket>

### Discovered context

<!-- files, symbols, conventions, utilities, and failed approaches -->

### Attempts

<!-- implementation iteration, continuation count, completed criteria, outcome, and commit -->

### Latest handoff

<!-- Attempt: i<implementation iteration>/c<continuation count>, then the seven required sections -->
```

## Sizing Metadata

The orchestrator owns all sizing fields:

- **Item count:** numbered rows under `### Criteria`, checked or unchecked. Do not count notes,
  attempts, or other lists.
- **Sizing decision:** `automatic` for fifteen or fewer items; `pending` while an oversized ticket
  awaits the human; `proceed` when approved as scoped; or `split` when returned to
  `$product-architect`.
- **Continuation limit:** the number of *additional* developer attempts allowed after the first in
  one implementation-review iteration. It is `pending` while the decision is `pending` or `split`;
  otherwise derive it from the item count:

  | Item count | Continuation limit |
  | --- | --- |
  | 1-6 | 1 |
  | 7-9 | 2 |
  | 10-15 | 3 |
  | above the automatic threshold (`proceed` only) | `ceil(item count / 5)` |

The limit is derived once, when the orchestrator seeds the journal. Missing, non-positive, or
inconsistent legacy metadata never implies unlimited attempts: recount the criteria, repeat the
sizing decision once, and persist valid values before developer dispatch.

Initialize the implementation-review iteration to one and its continuation count to zero. The limit
applies per implementation-review iteration and remains fixed for the ticket. `dev-cycle` updates
these counters transactionally as described under loop control.

## Responsibilities

The orchestrator creates the journal before the first developer. It copies every acceptance
criterion into a numbered unchecked row; writes sizing metadata; initializes the other sections;
retains the comment id; and reuses an existing valid journal after restart. Never create a second
journal. If duplicates exist, merge useful history into the newest and use only it.

For each criterion in ticket order, the developer:

1. implements and validates it;
2. ticks its row and records files, validation results, and durable decisions;
3. appends useful discoveries;
4. writes the complete journal by id; and
5. commits the criterion on the feature branch, regardless of whether the parent separately asked
   for commits.

The developer preserves all `Sizing` and `Orchestration` fields; only `dev-cycle` changes them.

## Stop And Handoff

Never start the next criterion unless enough context remains to finish it and write a complete
handoff. Around half the context budget, prefer stopping at the next criterion boundary; around
three quarters, stop at the current boundary. Reserve space for the handoff.

To hand off:

1. Commit all progress, including known-broken work, and describe failures explicitly.
2. In one journal update, tick completed criteria, append the attempt, and replace
   `### Latest handoff` with `Attempt: i<iteration>/c<continuation>` followed by all required
   sections below. Use the counters from the prompt packet.
3. Leave the ticket `{{status.in-progress}}`. Do not move it to `{{status.review}}` or post
   `{{artifact.implementationNotes}}`.
4. Return the completed and remaining criteria and final commit to the parent.

### Required `Latest handoff` Sections

Use all seven in this order:

1. **Criteria status:** every criterion marked done or remaining.
2. **Where the work stands:** branch, last commit, and committed, uncommitted, or broken work.
3. **Map:** concrete files and symbols for remaining work, relevant conventions, and reusable
   utilities. Name paths and symbols, not broad areas.
4. **Decisions made and why.**
5. **Dead ends:** failed approaches and reasons.
6. **Exact next step:** one concrete first action, not a plan.
7. **Validation status:** tests that pass, fail, exist, or remain unwritten.

## Continuations

Before exploring, a continuation reads the journal once by id and inspects the existing branch diff.
Its prompt counters must match the journal's active iteration and continuation count. Trust recorded
context and dead ends; verify rather than rediscover. Correct inaccurate journal information before
it propagates. Continue the remaining criteria under the same rules; a continuation may hand off.

If a legacy ticket has only append-only `Developer Handoff` comments, seed the journal from the
newest comment, preserve its criteria and seven sections, then persist valid sizing metadata. Keep
old comments as history but never update them.

## Loop Control

- Continuations are separate from implementation-review iterations and never consume one.
- The persisted continuation count is scoped to the current implementation-review iteration. The
  limit is derived once, when the orchestrator seeds the journal; read both rather than recalculating.
- A handoff is new only when its `Attempt` identity matches the active counters and differs from
  `Last consumed handoff`. Before spawning, verify progress and that the current count is below the
  limit. In one journal write, increment the count and mark the handoff consumed; then spawn with the
  new count. After a restart, an already-consumed handoff reuses the stored count without another
  increment.
- Blocking `{{artifact.reviewFeedback}}` and `{{artifact.testResults}}` comments must start with their
  `Implementation iteration: <number>`. On `failed`, consider distinct stamped failures only. They
  must include the failure that caused the state, form a contiguous sequence starting at the first
  iteration, and contain no conflicting review/QA failures for one iteration. The target is one above
  the highest valid failed iteration and must equal either the journal's iteration (already consumed)
  or the next iteration; otherwise stop for human attention. Only for the next iteration, set it,
  reset the continuation count, clear `Latest handoff`, and reset `Last consumed handoff` in one
  write. Duplicate comments with the same artifact type and iteration do not increment it again.
- **Progress guard:** each continuation must newly complete a criterion or materially increase the
  branch diff. After two consecutive attempts do neither, stop: the ticket is stuck, not merely
  large.
- **Exhaustion:** at the limit, leave the ticket `{{status.in-progress}}` and journal intact. Tell the
  human the ticket should be split through `$product-architect`; do not split or continue silently.
