# `adw e2e`: replayable E2E runs on a consumer project's real ticket

## Context
The Harbor self-test (`e2e/`) measures `agent-dev` quality only on two synthetic tasks, and it needs
Harbor, Python and hand-written task files. Users want the same signal on **their own codebase and a
real ticket**, with almost no setup:

    npx @strobl_dev/adw e2e <base-commit> <ticket> <harness> [--repetitions n] [--model m] [--root dir]

We accept less precise scores (no calibration, a real human in place of a scripted persona the first
time, and 1 repetition by default). In return we get easy use. Decisions made:
- **Sandbox:** read the ticket once from the real backend (read-only), then run on the `file`
  ticketing backend in a throwaway clone. Nothing is written to the tracker or the real remote.
- **Storage:** `.adw/e2e/<ticket>/{ticket.md,answers.json,acceptance.md}` are committed.
  `.adw/e2e/<ticket>/runs/` is git-ignored.
- **Runtime:** the project's own ai-dev container (`compose.ai-dev.yml` from `init`), driven from
  Node via `acpx`. No Harbor or Python on this path. The in-repo Harbor self-test stays unchanged.

## Flow of one `adw e2e` run
1. **Preflight.** Docker is present, `compose.ai-dev.yml` exists, the harness login exists, and the
   base commit resolves.
2. **Ticket import** (first time only). Read via the real backend from the host: `gh issue view`,
   `tea`, ADO REST with `AZURE_DEVOPS_EXT_PAT`, or copy for `file`. Write
   `.adw/e2e/<n>/ticket.md` (title + body). `--ticket-file` is a manual fallback. Later runs never
   touch the tracker.
3. **Sandbox.** `git clone --no-hardlinks` of the project into
   `.adw/e2e/<n>/runs/<ts>/<harness>/<trial>/work`, checked out at `<base-commit>`. Set origin to
   a local bare repo next to it, so pushes stay local and no real credentials are present. Then:
   - Rewrite `ai-project.json` to `ticketing.backend: "file"` and write the ticket as
     `<ticketing.dir>/<n>_<slug>.md` with `status: new`.
   - Run **this package's** `generate` (the version under test), then make one "e2e setup" commit,
     so the PR diff contains only the agent's work.
4. **Agent session.** Run `docker compose -p <slug>-e2e-<trial>` with `PROJECT_ROOT=<work>`, so the
   project's own services, cert overlay and proxies apply. Use a separate `agent-home` volume, with
   the harness login staged in the way `e2e/lib/secrets.mjs` does it today. Node sends turns with
   `acpx <agent> prompt` via `compose exec`. The opening message is
   `Nutze den agent-dev Skill für Ticket <n>.` (the `/agent-dev <n>` fallback is reused from
   `instruction.md`).
5. **Answer loop (replay + human).** After each agent turn, an **answerer** (`claude -p`, Sonnet,
   no tools) gets the ticket, `answers.json` and the agent's message. It returns one of:
   - `{reply, usedIds}`: the message is covered by stored answers, so it is replayed.
   - `{askHuman, question}`: something new. The terminal shows the agent's message, the user types
     the answer, the pair is appended to `answers.json`, then sent.
   - `{done}`: the agent reports the branch pushed and the ticket in review, or it is stuck.

   `answers.json` starts with default process answers taken from `_shared/instruction.md`: ask
   questions instead of skipping them, test end to end, accept recommended options, don't create
   a new ticket. Spec approval is always `askHuman` on the first run; after that it is replayed
   ("approve if it covers the stored answers, otherwise name the deviation"). A run that never
   asks the human counts as **fully replayed**, which makes it comparable. Runs that needed new
   answers are flagged in the report.
6. **Acceptance criteria** (first time only). After the first finished run, draft ACs from
   `ticket.md` + `answers.json`, using the existing AC rules (observable behaviour only). Show
   them to the user to accept or edit (`$EDITOR`), then store them in `acceptance.md`. Later runs
   reuse that file.
7. **Judges.** Bundle the PR head (`e2e/lib/bundle.mjs`) and run `postVerify` (verifier + review)
   in the project's ai-dev image instead of `adw-e2e-<task>`. If `AGENTS.md` has no
   "End-to-end testing" section, skip the verifier (acceptance = `—`) with a hint, and still run
   the review.
8. **Metrics and compare.** Collect tokens and cost from the agent's session logs in the trial's
   agent-home (`metrics.mjs`, `ccusage.mjs`). Write `run.json` + `report.md`. The baseline is the
   newest earlier fully replayed run with the same base commit, ticket and harness (`--baseline`
   overrides). Use `compare.mjs` against it and print a short summary. The fingerprint holds the
   ADW version, the harness CLI version, the model, the image digest, and hashes of `answers.json`
   and `acceptance.md`.

## Contract checks for the file backend
Add a file-backend variant next to `evaluateContract` (`e2e/tasks/_shared/tests/checks.mjs`, which
is Gitea-based). The checks, all computed from the sandbox:
- ticket file `status: review`
- `## Approved Spec`, `## Implementation Summary` (mentions e2e) and `## Cost Summary` sections,
  with no other sections
- a branch named `^<n>_[a-z0-9_]+$` pushed to the local bare origin
- app stopped
- no screenshots in the diff

Parameterize the ticket number in both variants. Gitea keeps `1`.

## Code changes (main files)
- `agent-src/generate.mjs`: dispatch `e2e`, and add the args to the usage text.
- New `e2e/local/` modules (shipped): `cli.mjs` (orchestration), `ticket-import.mjs` (one reader
  per backend), `sandbox.mjs` (clone, origin, ai-project rewrite, generate, setup commit),
  `session.mjs` (compose + acpx turns), `answerer.mjs` (prompt + JSON validation + readline
  escalation), `acceptance.mjs` (draft + confirm), `store.mjs` (`.adw/e2e` layout, baseline
  lookup).
- Reused as is, and so shipped: `e2e/lib/{claude,verifier,review,postverify,bundle,metrics,ccusage,compare,report,fsutil,secrets}.mjs`
  plus the contract-check module. Each shipped `.mjs` is listed individually in `package.json`
  `files` (Rule 2). Check with `npm pack --dry-run`. Make `postverify.mjs` take an `image`
  argument instead of the hard `taskImage(task)` (only `run.mjs` passes the task image).
- **Product image:** add `acpx` and the ACP adapters (`@zed-industries/claude-code-acp`,
  `@agentclientprotocol/codex-acp`) to `docker/tools/inventory.json`, then
  `node docker/tools/inventory.mjs update`. The e2e task Dockerfiles then drop their own install.
- `agent-src/container/compose.ai-dev.yml` / `AI-DEV.md`: a note that `adw e2e` uses this compose
  file. `.gitignore` hint for `.adw/e2e/*/runs/`. `init` may append it.
- Config defaults (answerer, verifier and review models, timeouts, rubric) in the package. An
  optional `e2e` block in `ai-project.json` can override them; `config.mjs` must not turn it into
  tokens.
- Docs: a README section and `docs/adw-e2e/README.md` ("Local runs on your project"), plus the
  design spec in `docs/superpowers/specs/2026-10-19-adw-e2e-local-design.md`.

## Build order
1. Spec doc. Then refactor so the shared judges and metrics are image-parameterized, plus the
   file-backend contract checks. Unit tests for both.
2. Sandbox + ticket import + store layout (unit tests on temp git repos; readers tested with
   faked CLI output).
3. Session + answerer loop. Unit-test the answerer validation and replay/escalate decisions with
   a stubbed `callClaude`.
4. Acceptance drafting, judges, report and compare wiring, `files` allowlist, product image change.
5. Docs + release.

## Verification
- `npm test` (new unit tests for every new module, plus the existing ones).
- `npm pack --dry-run` lists every shipped module. `node agent-src/generate.mjs e2e --help`
  works from a packed tarball (`npm i ./strobl_dev-adw-*.tgz` in a scratch dir).
- Real run on the `demo-todo` seed repo as a consumer project (file backend, ticket via
  `--ticket-file`). The first run asks the human and writes `answers.json`/`acceptance.md`. A
  second run is fully replayed with no human prompt and prints a compare against the first.
- Regression: `node e2e/run.mjs run --task demo-todo --harness claude-code --repetitions 1`
  still passes.

## Refinements (from planning)
- **Judges run through the project's compose file** (`docker compose run --rm`), not `docker run`,
  so the verifier sees the same dependent services (DB, cache) as the agent did. `runVerifier`,
  `runReview` and `postVerify` get an injectable argument builder. `docker run` stays the default,
  so the Harbor self-test keeps working as before.
- **The file-backend contract** lives in `e2e/local/contract.mjs`. The Gitea `evaluateContract`
  is not touched, because its ticket stays `1` (YAGNI).
- **App port:** read from the base URL in the `AGENTS.md` "End-to-end testing" section, else
  from `ai-project.json` `e2e.appPort`, else no port. Without a port, `app_stopped` and
  `e2e_performed` are `null`.
- **Own tests:** run only when `ai-project.json` sets `e2e.testCommand`. Otherwise `ownTests` is
  `null`, and the local reward needs contract = 1 and acceptance = 1.
- **Credentials:** a Claude token is always needed (answerer + judges), taken from
  `CLAUDE_CODE_OAUTH_TOKEN` or `~/.config/adw/e2e.env`. Codex and OpenCode auth files come from
  their default paths. They are copied into the trial container only and scrubbed from collected
  logs.
