# {{project.name}} Architecture Decision Records

An ADR records one architecture decision and *why* it was taken: what the code cannot show. People
and agents read it later as the team's record. Specs and plans are working files that get
discarded: a decision that lives only in one is not recorded, and an ADR never links one.

## Where

Follow the project's convention. Find it through `AGENTS.md` and the existing ADR folder (its README,
template, numbering). Continue its numbering and file name pattern, use its template, and add the
ADR to its index in the same change. If the project has no convention, ask the user before you
introduce one, then use `docs/adr/NNNN-kebab-title.md` with the template below and a
`docs/adr/README.md` that holds the index.

## Shape

An ADR is read in a minute: 300–400 words, and the template's limits per section. Readers who
stop after **Decision** and **Why** must have what they need. What does not fit the limits does not
belong in the ADR:

- How it is built (classes, files, registration, configuration keys beyond the one that matters)
  belongs in the architecture docs and the code; link them under **Evidence**.
- A doc that disagrees with the code is a ticket, not part of the ADR.
- Context and drivers are one list, **Why**; a reason appears once.
- Separate items are bullets, one per line: every reason, option, consequence, open question and
  source. A bullet holds one item in one or two sentences. The header line holds only the status,
  the date and the tickets the decision belongs to; every other reference goes under **Evidence**.

## New decision

Write it from the agreed design (the options compared, the choice, the trade-offs) and check it
against the code as built: where they differ, the code wins. It stands on its own: restate what
matters. Status `Accepted`: it is merged with the change it describes, so the pull request review
accepts it.

## Superseding

When a decision changes, write a new ADR that names the one it replaces and why. In the old ADR
change only the status, to `Superseded by ADR-NNNN`, and never its decision or reasons. A decision
that no longer applies, with no successor, gets `Deprecated` and one sentence why. A decision that
builds on an earlier one without reversing it, such as a later extension, gets its own ADR that
names the earlier one under **Evidence**.

## Backfill: a decision taken in the past

What was decided is usually findable; why often is not. A reason you infer and write as fact
becomes the team's history, so every reason is traceable:

1. Gather evidence: docs, `git log` and `git log -S`, pull requests, tickets. If a ticket or doc
   points to an earlier record of the decision (a wiki page, an older ADR), tell the user before
   you write a new one.
2. Every reason and every claim about what happened ends with a short reference to its source,
   e.g. `(PR 2683)` or `(#251)`, or with `(inferred — confirm)`. Your own assessment of a trade-off
   counts as inferred. List only the options a source shows were considered.
3. The header's date is the decision date when a source gives it, otherwise
   `in force by <date> (<source>)`. Add `recorded retroactively <today>`.
4. **Open** lists what reviewers should answer, one question per bullet and at most three: when
   it was decided, if no source gives the date, and each inferred reason. Answers from the review go
   into the ADR with the person who gave them as the source, e.g. `(Jane Doe, review 2026-11-24)`.
5. Status `Accepted`: the decision is in force.
6. If the project keeps a list of decisions still to backfill, remove this one from it.

## Template

```markdown
# ADR-NNNN: <the decision, as a short statement>

<Accepted | Superseded by ADR-NNNN | Deprecated> · <YYYY-MM-DD> · <the tickets the decision belongs to>

## Decision
<1–3 sentences: what was decided, concretely enough to check code against.>

## Why
- <3–5 bullets: the problem and what mattered most.>

## Options
- <One line per option: chosen, or rejected and why.>

## Consequences
- <3–5 bullets: what this means for future work, good and bad.>

## Open
- <Backfill only, while anything is unanswered: one question per bullet, at most three.>

## Evidence
- <One bullet per doc, link, related ADR or convention.>
- <Tickets and pull requests: one bullet per kind, e.g. "PRs 2302, 2658, 3449".>
```
