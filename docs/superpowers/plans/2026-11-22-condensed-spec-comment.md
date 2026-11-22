# Condensed `Approved Spec` Comment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `agent-dev` posts a condensed, path-free `Approved Spec` comment built from a fresh show-me pass over the final spec, and asks before the draft PR whether to discard the plan file.

**Architecture:** The behavior change is prose in `agent-src/skills/agent-dev/body.md` and the four `agent-src/includes/ticketing-*.md`. The E2E contracts (Harbor `e2e/tasks/_shared/tests/checks.mjs`, local `e2e/local/contract.mjs`) each gain two pure checks computed from the ticket text and the PR diff.

**Tech Stack:** Node ≥24 builtins, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-22-condensed-spec-comment-design.md`

## Global Constraints

- Zero runtime dependencies; LF line endings.
- Never hand-edit generated files; change `agent-src/` only.
- No spec or plan path anywhere on the ticket (spec comment, new-ticket description, implementation summary).
- Mermaid is never forced: show-me views are kept when they clarify, none are drawn just to have one; HTML views never go onto the ticket.
- Without show-me: prose summary only.
- Discard-plan question: default yes; on yes `git rm --cached` + commit before the push, local file stays; the spec is not affected; no history rewrite.
- Tests only for logic; prose changes get no new tests (AGENTS.md TDD Workstyle). Existing prose assertions that pin the old wording are updated, not extended.
- No change to `package.json` `files` (no new or renamed `lib/*.mjs`).

## Review Focus

- A spec path written without a directory prefix (`` `2026-11-22-x-design.md` ``) or under a custom dir: the path regex only knows `specs/` and `plans/` dirs; acceptable, since superpowers writes there by default — reviewer confirms the regex wording matches the rendered includes.
- A run without a written spec (agreements only): no spec file in the diff, so `spec_comment_condensed` must not fail on length — covered by a test in Task 2.
- A plan committed and later `git rm --cached`: the net PR diff (`origin/main...HEAD`) no longer shows it, so `plan_discarded` passes — covered by a test in Task 2 (diff without the plan file).
- A spec split across several `Approved Spec` comments (resumed run posts the final version again): length is compared on all spec comments joined — reviewer checks the joined text is what is measured.
- The local ticket file lives in the repo: its own path (`.tickets/issues/3_x.md`) must not trip the plan regex — covered by a test in Task 3.

---

### Task 1: agent-dev prose and README

**Files:**
- Modify: `agent-src/skills/agent-dev/body.md` (sections 1.3, 2 hooks **Scope agreed** and **Integration options offered**, closing line of section 2, section 3 template)
- Modify: `agent-src/includes/ticketing-github.md`, `ticketing-gitea.md`, `ticketing-azure-devops.md`, `ticketing-file.md` (**Create** body placeholder, **Post the spec**)
- Modify: `agent-src/lib/pipeline.test.mjs:130` (file-backend `spec` regex pins the old path line)
- Modify: `README.md` (`## The agent-dev workflow` items 1–3, the show-me subsection)

**Interfaces:**
- Produces: the rendered comment shape `## Approved Spec` + prose + optional text views, no path — Tasks 2 and 3 check exactly this.

- [ ] **Step 1: body.md — resume (section 1.3).** Replace the "Spec file, no plan" trigger with: an `{{artifact.spec}}` comment exists and the ticket's branch or worktree holds a spec file carrying the ticket reference. "Spec file and plan" stays (the plan file is local, tracked or not). Add: if the comment exists but no such spec file is found locally, continue with section 2, with the ticket and its comments (including the condensed spec) as context.

- [ ] **Step 2: body.md — Scope agreed hook.** New-ticket description: "a short title and a few sentences summarizing the agreed scope (add the ticket number to the spec)" — no path. Given ticket: keep the phrase `post with the include's commands as` + `` `{{artifact.spec}}` comments `` (pinned by `pipeline.test.mjs:93`), and define the content for a written spec: re-run show-me (read `.agents/skills/show-me/SKILL.md`) on the final, approved spec; the comment is 3–5 sentences of what gets built and what explicitly does not, followed by the text views show-me produced that clarify the requirement (kept as they are, Mermaid included); none are forced, a trivial spec may need none; HTML views stay with the user. Without show-me: the prose only. Add: "Never name a spec or plan path on the ticket: they are local working files." Agreements-only and "nothing if the ticket already said everything" stay.

- [ ] **Step 3: body.md — Integration options offered hook.** Before "push the branch", insert: if the run wrote a plan file, ask whether to discard the plan documents (default: yes). On yes, keep it out of the PR: if it is tracked on the branch, `git rm --cached <plan file>` and commit; the local file stays for a resume. The spec is not affected.

- [ ] **Step 4: body.md — closing line of section 2 and section 3.** Closing line: "Only the agreed scope goes onto the ticket; the plan stays local or in the repo, never on the ticket." Keep the words `Approved Plan`/`attach` absent (pinned by `pipeline.test.mjs:94`). Summary template's last line becomes `PR: <link, added once the draft PR exists>`.

- [ ] **Step 5: includes.** In all four, the **Create** placeholder becomes `<a few sentences summarizing the agreed scope>` (file: `<the agreed scope, a few sentences>`). **Post the spec** becomes, per backend: "Post the condensed scope (section 2, **Scope agreed**) as a readable comment: the heading, then the summary and any views. No spec or plan path." with a command that writes a heredoc body, no `cat <spec path>`, no splitting paragraph:
  - github: `cat <<'BODY_EOF' | gh issue comment <number> --repo {{repo.slug}} --body-file -` / `## {{artifact.spec}}` / `<summary and views>` / `BODY_EOF`
  - gitea: `BODY=$(cat <<'BODY_EOF' … BODY_EOF\n)` then the existing `tea comments add … "$BODY"`
  - azure-devops: `text: "## {{artifact.spec}}\n\n<summary and views>"`
  - file: the existing append block with `<summary and views (or the agreements)>` in place of `` `<spec path>` (or the agreements) ``; drop the "already lives in the repository" sentence.

- [ ] **Step 6: update the pinned file-backend regex** in `agent-src/lib/pipeline.test.mjs:130` to `/## Approved Spec\n<summary and views \(or the agreements\)>\nBODY_EOF/`.

- [ ] **Step 7: README.** Item 1: resume goes "straight to planning if the ticket has an approved spec and its spec file is in the ticket's branch or worktree". Item 2: replace the posting sentence with: the **Approved Spec** comment is a condensed view of the final spec — a few sentences plus show-me's views — so people can read what was agreed without the full file; spec and plan paths never go onto the ticket. Remove "split into numbered comments…" and "the file backend gets just a spec's path". Replace "The plan, if any, stays in the repo." Item 3: before the draft PR it asks whether to discard the plan file (default yes), keeping it out of the PR. show-me subsection: "reads it at those two moments" → also once more for the ticket's Approved Spec comment.

- [ ] **Step 8: verify.** Run `npm test` → all pass. Run `grep -rn "spec path\|<path, if any>" agent-src/` → no matches.

- [ ] **Step 9: commit** `feat(agent-dev): condensed, path-free Approved Spec comment; offer to discard the plan before the PR`.

### Task 2: Harbor contract checks

**Files:**
- Modify: `e2e/tasks/_shared/tests/checks.mjs`
- Test: `e2e/tasks/_shared/tests/checks.test.mjs`
- Modify: `e2e/lib/trial.mjs:9-11` (`CONTRACT_CHECKS`)
- Modify: `e2e/tasks/_shared/persona.md`

**Interfaces:**
- Produces: `evaluateContract(...)` returns two more keys, `spec_comment_condensed` and `plan_discarded` (signature unchanged); `CONTRACT_CHECKS` lists both after `spec_comment_complete` / `no_screenshots_in_repo` respectively.

- [ ] **Step 1: failing tests** in `checks.test.mjs`:
  - key count `12` → `14`.
  - `'a condensed spec comment shorter than the spec file passes'`: `prDiff` adds `docs/superpowers/specs/x-design.md` with 600 `+` chars; spec comment 420 chars → `spec_comment_condensed === 1`.
  - deviation cases: spec comment of 420 chars against a spec file of 300 chars → `spec_comment_condensed 0`; a `## Implementation Summary` containing `` `docs/superpowers/plans/x.md` `` → `spec_comment_condensed 0`; `prDiff` with `diff --git a/docs/superpowers/plans/x.md b/docs/superpowers/plans/x.md` → `plan_discarded 0`.
  - `'no spec file in the PR still passes the length part'`: `good` (no spec in diff) → `spec_comment_condensed 1`.

- [ ] **Step 2: run** `node --test e2e/tasks/_shared/tests/checks.test.mjs` → FAIL (missing keys).

- [ ] **Step 3: implement** in `checks.mjs`:
  - `const DOC_PATH = /\b(?:specs|plans)\/[\w.-]+\.md\b/;`
  - `export function addedText(diff, fileRe)`: splits `diff` on `/^diff --git /m`, keeps chunks whose `a/<path>` matches `fileRe`, returns their `+` lines (not `+++`) without the `+`, joined by `\n`.
  - `spec_comment_condensed: ok(!bodies.some((b) => DOC_PATH.test(b)) && (specFile === '' || spec.length < specFile.length))` with `specFile = addedText(prDiff, /\bspecs\/[\w.-]+\.md$/)`.
  - `plan_discarded: ok(!/^diff --git a\/\S*\bplans\/\S+\.md /m.test(prDiff))`.

- [ ] **Step 4: run** the test file → PASS. Add both names to `CONTRACT_CHECKS` in `e2e/lib/trial.mjs`; run `node --test e2e/lib/*.test.mjs` → PASS.

- [ ] **Step 5: persona.** Append to `persona.md`: "When the agent asks whether to discard its planning documents, accept its default."

- [ ] **Step 6: commit** `test(e2e): check the Approved Spec comment is condensed and path-free, and the plan stays out of the PR`.

### Task 3: local `adw e2e` contract checks

**Files:**
- Modify: `e2e/local/contract.mjs`
- Test: `e2e/local/contract.test.mjs`

**Interfaces:**
- Produces: `evaluateLocalContract(...)` returns `spec_section_condensed` and `plan_discarded`; `LOCAL_CONTRACT_CHECKS` lists them after `spec_section` / `no_screenshots_in_repo`.

- [ ] **Step 1: failing tests.** `TICKET`'s spec section `` `docs/spec.md` `` → `Condensed scope.` (the "every check passes" test then covers the new keys). New test `'the spec section names no path and is shorter than the spec file; no plan in the diff'`: section with `` `docs/superpowers/specs/x.md` `` → `spec_section_condensed 0`; diff adding a spec file shorter than the section → `0`; diff adding `docs/superpowers/plans/x.md` → `plan_discarded 0`; diff touching `.tickets/issues/3_x.md` → `plan_discarded 1`.

- [ ] **Step 2: run** `node --test e2e/local/contract.test.mjs` → FAIL.

- [ ] **Step 3: implement** with the same `DOC_PATH`, `addedText` and plan regex as Task 2 (duplicated on purpose: `e2e/tasks/` is not shipped and its verifier cannot import `e2e/local`); the path test runs over all sections' text.

- [ ] **Step 4: run** `npm test` → PASS; `npm pack --dry-run` unchanged file list.

- [ ] **Step 5: commit** `test(adw-e2e): local contract checks for the condensed spec section and discarded plan`.

### Task 4: E2E run

- [ ] **Step 1:** Ask the user before starting (subscription runs, takes long). On yes, use the `e2e-run` skill for the harnesses they name; report `spec_comment_condensed` and `plan_discarded` per trial and the comparison with the previous run.
