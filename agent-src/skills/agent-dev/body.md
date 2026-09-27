# {{project.name}} Agent Dev

Take one change from request to pull request with the **superpowers** workflow, unmodified. This
skill only adds what superpowers does not know about: the optional ticket and its comments.
Read `{{ticketing.include}}` only when you touch the ticket or open a PR, and `{{cost.include}}` only
when you report cost.

## 1. Start

1. Record the start time: `date -u +%Y-%m-%dT%H:%M:%SZ`.
2. Read `AGENTS.md`.
3. If a ticket id was given: read the ticket and its comments, then move it to `in-progress`.
   - If it was already `in-progress`, an earlier attempt died without reporting its cost. Ask
     whether to post a partial `{{artifact.costSummary}}` for it first, and have the user confirm the
     window start (suggest when the ticket moved to `in-progress`, if the backend shows it).
4. No ticket: ask the user whether you should **create a ticket** for this work. If yes, create it
   once brainstorming has settled the scope (see below); from then on it is the run's ticket, exactly
   as if its id had been given. If no, the flow is the same, and the summaries are printed instead of
   posted.

## 2. Superpowers chain

Invoke each skill and follow it as written:

1. `superpowers:brainstorming` — run the full requirements interview with the user. A ticket is
   **context, not a spec**: tickets are often incomplete, so feed its content in as background and
   never skip or shorten the interview because a ticket exists. Note the ticket reference in the spec.
   If the change has user-visible behavior (UI, user flows), also ask the user whether you should
   test it end to end in the running app or they prefer to test it manually. If they want you to but
   `AGENTS.md` has no end-to-end section, say so right away. Record the answer in the spec, together
   with the checks it covers.
   If the user asked for a new ticket, create it now with the ticket include's commands (it starts
   in `in-progress`): a short title and a few sentences summarizing the spec, plus its path. Add the
   new ticket's number to the spec.
   Once the user has approved the spec, post it on the ticket as the `{{artifact.spec}}` comment
   (see **Ticket comments** below).
2. `superpowers:using-git-worktrees` — branch named per **Naming** below.
3. `superpowers:writing-plans`. Once the user approves the plan (their go-ahead to execute it), post
   it as the `{{artifact.plan}}` comment.
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
   review and test before publishing it. PR title per **Naming** below. Write the implementation
   summary (section 3) first; it is the PR description, plus the ticket reference.

### Ticket comments

With a ticket, the approved spec and plan are posted in full, each under a `## <title>` heading
followed by its repository path, so reviewers can read them on the ticket. If a comment exceeds the
backend's size limit (see the ticket include) or is rejected as too large, post it in numbered parts
(`<title> (1/2)`, …). Post each once, as approved. Later revisions stay in the files under
`docs/superpowers/`.

### Naming

Both names derive from the ticket: its number, and a **short title** (its title cut to a few words).

- Branch: `<number>_<short_title_slug>`: lowercase ASCII, words joined by `_` (for example
  `42_user_login_form`). Without a ticket: `<short_title_slug>`.
- PR title: `<number>: <short title>` (for example `42: User login form`). Without a ticket:
  `<short title>`.

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
- Post nothing to the ticket beyond the approved spec and plan, the implementation summary, and the
  cost comments.
