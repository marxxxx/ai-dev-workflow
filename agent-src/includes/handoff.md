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

## The two artifacts

| | What | Where | Lifetime |
| --- | --- | --- | --- |
| **Journal** | Mutable checklist, one row per acceptance criterion, plus running notes | A file outside the repository, at a stable per-ticket path passed in the prompt packet | Deleted when the ticket reaches `{{status.acceptance-test}}` |
| **`{{artifact.handoff}}`** | The durable, human-readable resume document | A ticket comment, posted via `{{ticketing.include}}` | Lives with the ticket |

**The `{{artifact.handoff}}` comment is authoritative.** The journal is a convenience that may be
missing — temp directories get cleaned, and a run may resume on a different machine. A developer must
be able to resume correctly from the comment alone; the journal only saves it from re-reading a long
comment thread. Never treat a missing journal as a blocker: rebuild it from the ticket and the latest
`{{artifact.handoff}}` comment and carry on.

## The journal file

```
<os-temp-dir>/ai-dev-workflow-handoff/{{project.slug}}-<ticket>.md
```

- `<os-temp-dir>` is the machine's temp directory (`$TMPDIR` / `/tmp` on Unix, `%TEMP%` on Windows).
  The journal lives outside the repo on purpose — consuming projects commit `.agents/`, so an in-repo
  journal would risk being committed and would pollute the pull request.
- The path is **stable per ticket**, not per run: every attempt at the same ticket appends to the same
  journal, which is what makes progress across attempts visible.

Journal shape — Markdown, so a human can read it directly:

```markdown
# Ticket <number> — <title>

Branch: <branch>   Upstream: <ref or none>

## Criteria

- [ ] 1. <acceptance criterion, quoted from the ticket>
- [ ] 2. <acceptance criterion, quoted from the ticket>

## Discovered context

<!-- files, symbols, conventions, utilities to reuse; appended as they are found -->

## Attempts

<!-- one entry per developer attempt: attempt number, criteria completed, outcome -->
```

## Who does what

**The orchestrator (`dev-cycle`) seeds the journal.** Before spawning `developer` for a ticket it
reads the ticket — which it already holds — and writes one **unchecked** row per acceptance criterion,
numbered, quoted from the ticket, plus the empty `Discovered context` and `Attempts` sections. The
developer therefore receives a checklist it did not have to author. If the journal already exists
(a continuation), the orchestrator leaves it alone.

**The developer ticks rows.** For each criterion, in ticket order:

1. Implement it.
2. Validate it — run the applicable tests and lint/type checks for what you changed.
3. Tick its row and append two or three lines underneath: files touched, tests run and their result,
   any decision worth not relitigating.
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
2. Update the journal: tick what is done, append this attempt to `Attempts`.
3. Post the `{{artifact.handoff}}` comment (see the required sections below) via
   `{{ticketing.include}}`.
4. **Leave the ticket in the `{{status.in-progress}}` state.** A handoff is not a completion —
   never move the ticket to `{{status.review}}`, and do not post `{{artifact.implementationNotes}}`
   (that comment means "this ticket is finished and ready for review").
5. Return to the parent stating plainly that you handed off, which criteria are done, which remain,
   and the commit you left the branch on.

### Required sections of the `{{artifact.handoff}}` comment

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

1. Read the latest `{{artifact.handoff}}` comment on the ticket. If several exist, the most recent
   one wins; earlier ones are history.
2. Read the journal file if it is present at the path the packet gave you.
3. Read the branch diff for the criteria already marked done.

Then trust the map. Do not re-derive what the handoff already recorded, and do not re-attempt what
its dead-ends section rules out — re-exploration is exactly the cost this protocol exists to avoid.
Verify rather than rediscover: if something in the map turns out to be wrong, correct it in your own
handoff or implementation notes so the error does not propagate.

Work the remaining criteria under the same rules. A continuation may itself hand off.

## Loop control (orchestrator)

- Handoff **continuations are counted separately** from implementation-review iterations and do not
  consume one — a handoff is not a review rejection, and the work was not defective.
- Allow at most **three continuations per ticket** unless the user chooses another limit.
- **Progress guard** — a continuation must show measurable progress: at least one newly ticked
  criterion, or a materially larger branch diff. If two consecutive continuations show neither, stop:
  the ticket is stuck, not large, and continuing will only repeat the failure.
- **On exhaustion** — stop automation for that ticket. Leave it in `{{status.in-progress}}` with its
  `{{artifact.handoff}}` comment intact, and report to the human that the ticket is too large to
  implement as scoped and should be split via `$product-architect`. Do not split it yourself, and do
  not silently keep cycling.

Repeated handoffs on one ticket are a **signal about the ticket, not about the developer**. Surface
it — a ticket that needed three continuations was scoped too coarsely, and that is information the
human needs for the next round of planning.

## Cleanup

Delete the journal file when the ticket reaches `{{status.acceptance-test}}`, alongside the cost
ledger cleanup in `{{cost.include}}`. The `{{artifact.handoff}}` comments stay on the ticket as the
durable record of how the work progressed.
