# {{project.name}} Agent Dev

Take one change from request to pull request with the **superpowers** workflow, unmodified. This
skill only adds what superpowers does not know about: the optional ticket, and two closing comments.
Read `{{ticketing.include}}` only when you touch the ticket or open a PR, and `{{cost.include}}` only
when you report cost.

## 1. Start

1. Record the start time: `date -u +%Y-%m-%dT%H:%M:%SZ`.
2. Read `AGENTS.md`.
3. If a ticket id was given: read the ticket and its comments, then move it to `in-progress`.
   - If it was already `in-progress`, an earlier attempt died without reporting its cost. Ask
     whether to post a partial `{{artifact.costSummary}}` for it first, and have the user confirm the
     window start (suggest when the ticket moved to `in-progress`, if the backend shows it).
4. No ticket: the flow is the same; the summaries are printed instead of posted.

## 2. Superpowers chain

Invoke each skill and follow it as written:

1. `superpowers:brainstorming` — run the full requirements interview with the user. A ticket is
   **context, not a spec**: tickets are often incomplete, so feed its content in as background and
   never skip or shorten the interview because a ticket exists. Note the ticket reference in the spec.
   If the change has user-visible behavior (UI, user flows), also ask the user whether you should
   test it end to end in the running app or they prefer to test it manually. If they want you to but
   `AGENTS.md` has no end-to-end section, say so right away. Record the answer in the spec, together
   with the checks it covers.
2. `superpowers:using-git-worktrees` — branch name per `{{git.branchPattern}}`; the ticket include
   defines the number to use and the slug rule when there is no ticket.
3. `superpowers:writing-plans`.
4. `superpowers:subagent-driven-development` (or `superpowers:executing-plans` where subagents are
   unavailable). It carries TDD, code review, and verification.
5. **End-to-end check** (only if the spec says the agent tests end to end) — start the app as the
   `AGENTS.md` end-to-end section describes, exercise the changed flows in a browser (Playwright),
   capture evidence (screenshots outside the repo, or observations), and shut the app down. If
   there is no such section, no browser tooling, or startup fails, do not block: report it in the
   summary instead.
6. `superpowers:finishing-a-development-branch` — base branch `{{git.prTarget}}`. Run its
   verification, but do **not** offer its integration menu: the choice is already made. Push the
   branch and open a **draft pull request** with the ticket include's commands, so a human can
   review and test before publishing it. Write the implementation summary (section 3) first; it is
   the PR description, plus the ticket reference.

The spec and plan under `docs/superpowers/` are the only durable working files. Do not mirror them
onto the ticket.

## 3. Close-out

The `{{artifact.implementationSummary}}` — at most about 250 words:

```markdown
## {{artifact.implementationSummary}}
**Approach** — what was built and how.
**Consequences** — behavior, API, data, or config changes.
**Possible side effects** — what else this could affect.
**Watch when testing** — concrete things to check. State the end-to-end status: tested by the
agent (what, with evidence), left to manual testing at the user's request, or not tested (why).
Spec: <path> · Plan: <path> · PR: <link, added once the draft PR exists>
```

Once the draft PR is open, produce the `{{artifact.costSummary}}` per `{{cost.include}}`. With a
ticket, post both as comments and move the ticket to `review`. Without one, print both.

## 4. Failure or interruption

If the work is blocked, abandoned, or stopped by the user before the draft PR exists, ask the user
whether they want a cost summary of the process so far. If yes, produce a **partial**
`{{artifact.costSummary}}` per `{{cost.include}}`; post it on the ticket (or print it) and leave the
ticket at `in-progress`. Failed attempts then still count toward the ticket's cost.

## Guardrails

- Never close the ticket; acceptance is human.
- Never merge and never publish the draft PR; both belong to the human reviewer.
- Post nothing to the ticket beyond the implementation summary and cost comments.
