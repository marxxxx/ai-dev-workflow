# The `Approved Spec` comment carries a condensed view, not the full spec

## Why

People read the `Approved Spec` ticket comment to learn what was agreed for the implementation.
The specs superpowers writes are far too detailed for that: nobody reads them in full, so the
comment needs a summary. It must reflect the **finally approved** spec, not the version shown at
review time. Spec and plan files are temporary local artifacts for the implementation; they do not
belong on the ticket, so no ticket text names their paths.

## Goals

- At **Scope agreed**, `agent-dev` re-runs show-me on the final spec and posts a condensed comment:
  1. heading `## {{artifact.spec}}`,
  2. 3–5 sentences of prose: what gets built and what explicitly does not,
  3. the text views show-me produced (trees, pseudocode, diff, Mermaid), kept as they are when they
     clarify the requirement; none are forced. A trivial spec may need no view at all, and no
     Mermaid diagram is drawn just to have one. HTML views stay with the user and never go onto the
     ticket.
- Without show-me installed: the prose summary only.
- **No spec or plan path on the ticket**, anywhere: not in the `Approved Spec` comment, not in a new
  ticket's description (a few summarizing sentences only), not in the `Implementation Summary`
  (its `Spec: <path> · Plan: <path>` line keeps only `PR: <link>`).
- Applies to every backend: github, gitea, azure-devops (a Mermaid view stays even if its comments
  may not render it), and file (today path only; it gets the same comment).
- Without a written spec (agreements from the conversation) nothing changes: the agreements are
  posted as today.
- **Discard the plan before the PR.** Right before pushing and opening the draft PR, if a plan
  file exists for this work (also one an earlier, resumed run wrote), `agent-dev` asks whether to discard the plan documents, defaulting to yes.
  On yes, the plan file is not checked in and does not appear in the PR: if it was committed on the
  branch, it is removed from the index (`git rm --cached`) in a commit before the push; the local
  file stays, untracked, for a later resume. On no, nothing changes. The spec is not affected.

## Non-goals

- The plan: show-me still runs when the plan is handed over for review, but the plan never goes
  onto the ticket.
- Changing the review-time show-me hook.
- Where superpowers writes the spec and plan, and whether the spec ends up in the PR.
- Rewriting branch history: the plan's earlier commits stay; only the PR's net diff loses it.

## Resume without a path on the ticket

Today resume finds the approved spec through the path in the `Approved Spec` comment. Instead: an
`Approved Spec` comment marks the spec as approved, and the spec file is the one in the ticket's
branch or worktree that carries the ticket reference (brainstorming already notes it in the spec).
If the comment exists but no such file is found locally, resume continues with section 2, with the
ticket and its comments (including the condensed spec) as context.

## Approaches

- **A — re-run show-me after approval, plus prose (chosen).** Always current and quick to read;
  costs one extra show-me pass per ticket.
- B — reuse the review-time view, regenerate only on changes. Saves the pass, but leaves the agent
  to judge staleness, which is where an outdated view slips onto the ticket.
- C — prose summary only. Simplest, but loses the views that make the review fast.

## The how

- `agent-src/skills/agent-dev/body.md`: the **Scope agreed** hook posts the condensed comment and
  re-runs show-me on the final spec for it; new-ticket description without path; resume rule as
  above; summary template without spec/plan paths.
- `agent-src/includes/ticketing-{github,gitea,azure-devops,file}.md`: **Post the spec** writes
  heading, summary, any views (no path line, no `cat <spec path>`, no splitting rule — the comment
  is short); the create-ticket description drops the spec path.
- `body.md`, **Integration options offered** hook: the discard-plan question before the push.
  The closing line of section 2 ("the plan stays in the repo") changes to match.

## Upgrade path

Prose in a unit body and the includes only: `upgrade` (like `generate`) re-renders them. No new
files, keys or skills, so `upgrade.mjs` and the README "Updating" notes need nothing.

## E2E coverage

A new contract check `spec_comment_condensed` in `e2e/tasks/_shared/tests/checks.mjs` (and
`CONTRACT_CHECKS` in `e2e/lib/trial.mjs`): the `Approved Spec` comment is shorter than the spec
file, and no ticket comment names a spec or plan path. A second check `plan_discarded`: the PR diff
adds no plan file. The simulated user (`persona.md`) accepts the default when asked about discarding
the plan, if a line is needed for that. How the verifier finds the spec file and recognizes spec
and plan paths is the builder's call. Run with the `e2e-run` skill.
