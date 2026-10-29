# `adw e2e` first-run setup: from preflight errors to a guided start

## Context
`adw e2e <base-commit> <ticket> [harness]` (spec `2026-10-19-adw-e2e-local-design.md`) is a single
command once a project is set up. On a fresh customer project it is not: the preflight finds every
missing piece and then stops, and the customer has to read the README, fix things by hand and start
again. Several gaps are silent, which is worse: without an `## End-to-end testing` section in
`AGENTS.md` the verifier is skipped and acceptance stays `—`, which the customer only notices in the report.

The goal: a customer runs `npx @strobl_dev/adw e2e <commit> <ticket> <harness>` once. The CLI asks
only what it cannot detect, writes the config files, and starts the run. A second run on the same
project asks nothing.

This spec comes from the review of PR #71. It covers three items from that review: preflight
failures become setup steps, a first-run `e2e` interview, and an offered `AGENTS.md` E2E section.
Two small findings are included because they block the same flow: the env-source mismatch and the
`--root` default. German being hardcoded is included because the interview needs to set the language.

## Goals
- Every preflight problem that a question or a local file write can fix gets an interactive fix. The
  run starts in the same process once the fixes succeed.
- A project with no `e2e` key in `ai-project.json` gets a short interview the first time. Its
  answers are written to `ai-project.json` `e2e`, and from then on the harness argument is optional.
- The customer is told the verifier needs an `AGENTS.md` E2E section and is offered help writing it.
  Nothing is written to `AGENTS.md` without being shown first and confirmed.
- A second `adw e2e` on a set-up project asks nothing new and behaves exactly as it does today.

## Non-goals
- Installing anything on the host (`gh`, `az`, `claude`, Docker). The CLI explains what is missing,
  as `init` does.
- A separate `adw e2e setup` command or setup without a run. `--reconfigure` (below) covers changing
  the answers.
- Moving the acceptance confirmation to the start of the run, `--refresh-ticket`/`--reset`,
  `--no-human`, and branch-based base commits (review items 4–6). These are separate specs.
- Languages other than English and German. Adding one later means adding one table entry.

## Anti-goals (a failure even if it works)
- A secret ends up in a committed file, in argv, or in a log or transcript.
- `AGENTS.md`, `ai-project.json` or `.env.ai-dev` is changed without the customer seeing the change
  and saying yes. A value the customer set by hand is overwritten.
- A non-interactive call (CI, piped stdin) hangs on a question. Without a TTY the behaviour is
  today's: preflight problems are fatal.
- The setup writes to the ticket tracker or the real remote.
- The setup restates superpowers or `agent-dev` process. It configures the harness around them, nothing more.

## Flow
`runE2e` gets a setup phase in front of today's run. Each step runs only when its check fails, and
then re-checks. A step the customer declines leaves the problem in place. Preflight then reports it
as today and the run stops, unless the step is marked optional.

0. **Find the project.** `--root` defaults to `git rev-parse --show-toplevel` of the current directory
   (today: the current directory itself). An explicit `--root` is taken as given.
1. **`ai-project.json` missing:** offer to run the `init` interview inline (`cmdInit` with the same
   prompter). It already offers the container files and the pinned skills. If declined: stop with
   today's message.
2. **`compose.ai-dev.yml` missing** (`ai-project.json` exists): ask the container questions of `init`
   (`askContainer`: stack, Docker overlay, certificates) and write the files with `writeContainerFiles`.
   This step only writes missing files and never overwrites. Point to `AI-DEV.md` for the in-container logins.
3. **Ticket import** (only when `.adw/e2e/<n>/ticket.md` is missing). The CLI tries these in order and
   stops at the first one that works:
   1. today's host CLI (`gh` / `tea` / `az` / file backend);
   2. if the host CLI is missing or not logged in: the same read-only command in a one-off container of the
      project's **own** compose project (`docker compose -f compose.ai-dev.yml run --rm --no-deps`),
      which uses the ticketing login that `AI-DEV.md` sets up in the project's `agent-home` volume. The
      command only reads; nothing is written to that volume;
   3. `$EDITOR` on a `# <title>\n\n<body>` template in `.adw/e2e/<n>/ticket.md`. An empty title asks
      again, and an aborted edit stops the run.

   `--ticket-file` still skips all three.
4. **The `e2e` interview**, when `ai-project.json` has no `e2e` key or `--reconfigure` is passed
   (current values become the defaults). See below.
5. **Logins** for every harness that any role uses. See below.
6. **`e2e.env` names without a value:** ask for each value. A name in `e2e.secretEnv` is read
   without echo. Then offer to save the values to `.env.ai-dev`. Declined: the values are used for
   this run only.
7. **`AGENTS.md` without an `## End-to-end testing` section.** This step is optional: declining keeps
   today's behaviour (the verifier is skipped and the hint is printed). See below.
8. **Docker not running, base commit not resolving:** fatal as today. No fix offered.

Then the full preflight runs again. If it is clean, the run starts and the output is today's.

**Interactivity.** The setup asks questions only when stdin and stdout are TTYs and `--no-input` is not
passed. `--answers <file.json>` uses `createScriptedPrompter` with the same dotted keys as the
questions, as `init --answers` does. Absent answers mean "no" to every write. The scripted prompter is
how tests and the E2E check drive the flow.

## Env sources (review finding 2)
Preflight, the login check and step 6 read the same env as the containers get: `composeEnv` (process env
over `.env.ai-dev`). Today the preflight reads the process env only, so a value kept in `.env.ai-dev`
counts as missing although it would reach the container. `stageCredentials` takes this merged env, so
the values to scrub include those from `.env.ai-dev`.

**My call:** `.env.ai-dev` is the one place where the setup stores values. It is already git-ignored by
`writeContainerFiles`, already read by `ai-dev.sh` and `composeEnv`, and already the file where `init`
keeps local settings. Values are added with `setEnvVar`, which never replaces a key that is already set.
Compose passes a variable into the normal dev container only when `compose.ai-dev.yml` lists it, so a
token stored here does not leak into `./ai-dev.sh` sessions.

## Logins (step 5)
Today: the Claude token from env, the Codex `auth.json` from the host home or `OPENAI_API_KEY`, the
OpenCode `auth.json` from the host home (optional). The setup adds one source and one guided step:

- **Second source: the project's `agent-home` volume** (Codex and OpenCode only). After
  `./ai-dev.sh codex login` the login lives in the project's volume, not on the host. If the host has
  no login, the CLI offers to use the volume's `auth.json`. The volume is
  `<compose project name>_agent-home`, where the name comes from `docker compose config`. The file is
  read once per run, read-only, and staged into each trial exactly like a host file today: by stdin,
  mode 600, removed from the collected logs, its secret leaves scrubbed. Nothing is ever written back
  to the volume. Priority: env, then host file, then volume.
- **Claude Code: guided `setup-token`.** The volume's Claude login is **not** reused (my call). It is
  an OAuth login whose refresh could rotate the token in a trial copy and log the customer's dev
  container out. The long-lived token from `claude setup-token` is made for this. The CLI offers to run
  `claude setup-token` in a one-off container of the project's dev image (attached to the terminal; the
  host needs no `claude`). It then asks the customer to paste the printed token (read without echo)
  and offers to save it as `CLAUDE_CODE_OAUTH_TOKEN` in `.env.ai-dev`. Bedrock and Vertex: the
  CLI prints which variables to put into `e2e.env` and goes on to step 6 for them.
- **Known risk, accepted as today:** a reused Codex `auth.json` may refresh in the trial container. A
  rotated refresh token could invalidate the source copy, and then the customer has to log in again.
  The CLI says so once when it offers the volume login.

## The `e2e` interview (step 4)
Questions, in this order, each with a detected default. Only answers that differ from
`e2e/local/defaults.json` are written, merged into `ai-project.json` (2-space JSON, other keys untouched,
shown as a diff and confirmed before writing):

| Question | Key | Default |
|---|---|---|
| Harness for the agent under test | `e2e.agent.harness` | the positional argument, else the only harness with a login, else ask |
| Model for the agent (blank: the CLI's default) | `e2e.agent.model` | `--model`, else blank |
| Model for the verifier and the review judge (blank: the agent's; the report will warn about self-judging) | `e2e.verifier.model`, `e2e.review.model` | blank |
| Command that runs your tests in the dev container (blank: none) | `e2e.testCommand` | detected: `npm test` when `package.json` has `scripts.test`, `dotnet test` with a `*.sln`/`*.csproj` at the root, `make test` when the `Makefile` has a `test:` target, else blank |
| Provider variables to pass into the containers (names, comma-separated) | `e2e.env` | blank; asked only when a role uses opencode or Claude Code via Bedrock/Vertex |
| Which of them are secrets | `e2e.secretEnv` | all of them |
| Language of the ticket and your answers | `e2e.language` | detected from `ticket.md` |

Judges on another harness are not asked about. That stays a hand edit, as the README shows. Most
customers have one login, and the question would mostly lead to a missing-login error.

Once `e2e.agent.harness` is written, the positional harness is optional. When given, it still
overrides the config, as today.

## Language
`e2e.language` (`"en"` | `"de"`, default `null`). With `null` the language is detected once per run
from `ticket.md`. **My call:** German when German stop words (`der die das und nicht ist mit für`)
outnumber English ones (`the and is with for not`), else English. This is deterministic, because
`ticket.md` is fixed. The resolved language is in the fingerprint.

The language picks one text table (new module `e2e/local/language.mjs`). It holds the opening prompt
(today `Nutze den agent-dev Skill für Ticket <n>.`), the five `DEFAULT_ANSWERS`, `CONTINUE_TEXT`, and the
answerer's "short, German" rule. The `UNKNOWN_SKILL` pattern matches both languages. An existing
`answers.json` is never rewritten: its stored defaults stay in the language they were written in.

## `AGENTS.md` E2E section (step 7)
The verifier reads the `## End-to-end testing` section of `AGENTS.md` in the checkout (`verifier.mjs`):
how to start the app, how to tell it is ready, its base URL, and how to stop it. The CLI offers two ways
to get it:

- **[d]raft:** a one-off call on the answerer's harness and model with the `read` tool profile, on a
  read-only copy of the project root. It drafts the section from the repo (scripts, compose files,
  README) in the four parts above, in `e2e.language`. It is the same kind of call as the acceptance draft.
- **[a]sk:** four questions (start command, readiness check, base URL, stop command), rendered into the same four parts.

Either way, the result is confirmed with the `confirmAcceptance` loop (accept / edit in `$EDITOR` / skip).
It is then appended to the project root's working-tree `AGENTS.md`. If there is no `AGENTS.md`, the CLI
offers to create one that contains only this section and says that `/init` in their coding agent writes
the rest. The CLI does not commit; it tells the customer to commit the file.

**The base commit problem, my call (please check):** a run uses `AGENTS.md` **at the base commit**. A
section the customer has just written to the working tree is not in an older base commit. When the
sandbox's `AGENTS.md` has no E2E section and the root's working tree has one, `createSandbox` copies the
root's section into the sandbox's `AGENTS.md` as part of the "e2e setup" commit. That commit already
puts this adw version's generated files over the base code, so the PR diff stays the agent's work only.
The run log says so, and the section's hash goes into the fingerprint. Consequence: the agent under
test sees the section too and will test end to end, as it would on the customer's current main. A run
that has to reproduce the base commit's `AGENTS.md` exactly would need a flag; this spec does not add one.

## Constraints
- Zero dependencies. Prompts reuse `createReadlinePrompter` / `createScriptedPrompter` from
  `agent-src/lib/onboard.mjs`, and container files reuse `agent-src/lib/container.mjs`. Input without echo uses
  node `readline` only.
- New runtime modules (`e2e/local/setup.mjs`, `e2e/local/language.mjs`) go into the `package.json`
  `files` allowlist in the same commit. `e2e/local/package.test.mjs` already fails if the import
  closure of `cli.mjs` is not shipped.
- Every value read without echo is pushed to the secrets list that gets scrubbed and redacted before any
  container starts.
- Setup reads and writes go through injectable deps (`d.exec`, the prompter, the fs root), as in `runE2e`
  today, so every step is unit-testable without Docker.

## Upgrade path
`npx @strobl_dev/adw@<new> upgrade` needs no change: nothing is renamed or removed, and `upgrade` already
keeps the `e2e` key. An existing project with an `e2e` key is not interviewed. Its next `adw e2e` behaves as
today, except that the language is now detected from the ticket. `--reconfigure` re-runs the interview.
README "Updating" note: adding `language` to `defaults.json` changes the config hash, so **the first run
after the update starts a new baseline**. The same note goes into the `adw e2e` section's prerequisites,
which shrink to "Docker, and a git repo with `ai-project.json`, or let `adw e2e` set it up".

## E2E coverage
The Harbor self-test does not exercise `adw e2e`. Its migration onto the local runner is a separate plan
(see the 2026-10-19 spec), so this feature is covered in two layers:
- **Unit:** `e2e/local/setup.test.mjs` drives each step with the scripted prompter and a fake `exec`. It covers:
  - each detection and fallback order;
  - that nothing is written when an answer is absent;
  - that `setEnvVar` never replaces a key;
  - that secrets never appear in argv or in written logs;
  - non-TTY: no questions, the same fatal preflight as today;
  - that an existing `e2e` key skips the interview.
- **Real run (manual, recorded in the PR):** on a fresh clone of the `demo-todo` seed, with no
  `ai-project.json` `e2e` key, no `compose.ai-dev.yml`, no E2E section and only the project volume's
  Codex login, run `adw e2e <seed-commit> 1 codex` once with a TTY. Expected: one interview, files
  written, run completes with acceptance not `—`. A second call asks nothing. When the Harbor
  migration lands, its seeds start from this bare state, and the setup flow runs with
  `--answers` in every self-test run.

## Left to the builder
- Wording of all questions and messages, the exact diff presentation, how the steps' code is laid out in
  `setup.mjs`.
- How the volume's `auth.json` is read (a one-off `docker run` of the dev image with the volume mounted
  read-only is the obvious way).
- The stop-word lists and their threshold, as long as the detection stays deterministic.
- Whether the AGENTS.md draft reuses `draftAcceptance`'s shape or gets its own small function.
