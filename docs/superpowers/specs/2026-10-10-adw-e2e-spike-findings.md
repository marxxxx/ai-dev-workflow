# ADW E2E testing — Harbor spike findings

Date: 2026-10-10 · Branch: `spike/harbor-e2e` · Harbor 0.24.0 · Image `ai-dev-workflow-node:2026.10.10`
(Claude Code 2.1.293, Codex 0.161.0, OpenCode 1.18.35, superpowers `8ca22dba`).

Throwaway artifacts live in `spike/` (not to be merged): Harbor task `spike/demo-todo/`, custom
agents `spike/agents/*_subscription.py`, job outputs `spike/jobs/` (git-excluded).

## Question

Can [Harbor](https://github.com/laude-institute/harbor) run the full `agent-dev` workflow, using a
simulated user, against a fixed repo, branch and ticket for all three harnesses? Can it produce
comparable measurements of process adherence, acceptance, duration, tokens and errors? Or do we build
our own runner?

## Setup that ran

- **Environment:** a Harbor task with `environment/docker-compose.yaml`.
  - `main` is our image plus `tea` and a startup hook.
  - `gitea` is a throwaway Gitea 1.24. It creates the admin user and token itself.
  - The hook creates the repo, the status labels and ticket #1, pushes the demo repo, and registers
    the `e2e` tea login.
- **Demo repo:** `demo-todo`, a zero-dependency Node API. It has generated adw files
  (`ticketing.backend: gitea`) and an `AGENTS.md` with an end-to-end section.
- **Simulated user:** Claude Code (`claude-haiku-4-5`) with a PO persona (German). The task is
  `instruction.md`, which holds the hidden requirements. The user talks to the agent through Harbor's
  ACP bridge (`acpx prompt`).
- **Verifier** (`tests/verify.mjs`, zero-dep): 13 process checks against the Gitea API, the agent's
  own tests, and 5 hidden acceptance tests on the PR branch. It writes `reward.json`, one metric per
  check.
- **Auth:** subscription logins only (no API keys).
  - Claude: `claude setup-token`.
  - Codex: a copy of the ChatGPT/Business `auth.json`.
  - OpenCode: the OpenAI OAuth entry of its `auth.json`.

## Results

The final series (`run-series.sh`) used the same constrained simulated user and verifier for every
run. Earlier runs are listed for completeness.

| Run | Harness / model | Process | Acceptance | Agent time | Target tokens (session log) | Notes |
|---|---|---|---|---|---|---|
| claude-3 | Claude Code 2.1.293 / `claude-sonnet-5` | 13/13 | 4/5¹ | 6:00 | 3.53 M | `status:new` left behind (verifier missed it, since fixed) |
| claude-4 | 〃 | 12/13 | 4/4 | 9:22 | 4.97 M | no Approved Spec comment (bounded path, no spec file) |
| claude-5 | 〃 | 13/13 | 4/4 | 5:25 | 4.13 M | reward 1 |
| codex-2 | Codex 0.161.0 / `gpt-6-luna`, effort low | 13/13 | 5/5¹ | 4:00 | 1.56 M | reward 1 |
| codex-3 | 〃 | 13/13² | 3/4 | 7:51 | 3.21 M | PATCH `dueDate: null` → 400; spec comment literally `$(cat …)` |
| codex-4 | 〃 | 12/14 | 3/4 | 3:45 | 0.92 M | no Approved Spec comment; overdue filter wrong |
| opencode-3 | OpenCode 1.18.35 / `mistral/mistral-large-4` (API key) | 13/13 | 4/4 | 2:45 | 0.58 M | reward 1, but superpowers bootstrap never loaded |
| opencode-1/2 | OpenCode / `gpt-6-luna` | — | — | — | — | run 1: simulated user did the work itself; run 2: host OpenAI OAuth expired (401) |

¹ Old verifier: it included the since-skipped "no `dueDate` key" test.
² Before the `spec_comment_complete` check existed. It would have failed.

Overhead per run: simulated user about $0.04–0.05 (Haiku), environment setup about 15 s, Gitea
seeding about 10 s, verifier about 1 s.

**Variance with an identical configuration is large.**
- Tokens: Claude 3.5–5.0 M (×1.4), Codex 0.9–3.2 M (×3.5).
- Agent time: Claude 325–562 s, Codex 225–471 s.
- Reward: 1 of 3 per harness.

Single runs cannot support a "+25 % = regression" threshold. Comparisons need 3–5 repetitions per
configuration, medians, thresholds derived from the measured spread, and per-check pass *rates*
compared across configurations.

## Answers

**S1 — Our image and pins.** Yes, with adjustments.
- Harbor skips the install when the image already carries the requested version (`--ak version=`).
- Claude under ACP runs our `claude` wrapper, with the superpowers plugin, version 2.1.293.
- Adjustments needed:
  - **ACP packages.** Harbor `npm install -g`s the ACP pieces at runtime as the agent user. Our
    hardened image's `/usr/local` is root-owned. The pieces are `acpx` 0.11.2,
    `claude-code-acp` 0.16.2 and `codex-acp` 1.12.0. Fix: preinstall them in the image and pin them
    in `inventory.json`. They are new components with their own versions.
  - **Startup order.** `configure-agents.sh` requires `ai-project.json` before `startup.d` hooks run,
    so the project must be in `/workspace` at container start.
  - **Codex under ACP** gets a fresh `CODEX_HOME` with Harbor's `config.toml`. It **loaded
    superpowers from OpenAI's curated remote marketplace (`openai-curated-remote/superpowers/6.4.2`)
    instead of our pinned `/opt/superpowers`**. Today both are 6.4.2, but the source is not the pin,
    so the next upstream release drifts silently. Pinning must be enforced explicitly.
  - **OpenCode under ACP** never loaded the superpowers bootstrap. There is no `using-superpowers`
    content in its session DB, even though the wrapper sets `plugin: [/opt/superpowers]`. It only
    *claimed* to run brainstorming. The cause is not yet investigated.
  - **OpenCode:** our `launch-agent.mjs` *overwrites* `OPENCODE_CONFIG_CONTENT`. That is where Harbor
    puts the model, so the model must be passed via an `OPENCODE_CONFIG` file.

**S2 — Simulated user through the whole flow.** Yes for turn-based dialogue. It has three limits.
- **Questions inside a turn do not reach the user.** Codex's `request_user_input` returned
  `{"accepted":true}`, and Codex continued with its own default after 30 s. Claude asks in chat and
  ends its turn, so it was unaffected.
- **The simulated user breaks role.**
  - In claude-2 it rewrote `.acpxrc.json` and switched to `acpx claude` (bundled Claude 2.1.146).
  - In opencode-1 it ran `agent-dev` itself and never contacted the target.
  - Cause: the user agent is a Claude Code in the same `/workspace`, with our project skills and
    plugin.
  - Mitigations: a strict bridge prompt, `disallowed_tools=Skill,Edit,Write,…`, and
    `append_system_prompt`.
  - Better: run the user agent without project skills and plugins, or in a different cwd.
- **Auth inside the user's Bash.** Claude Code does not pass its OAuth token to Bash tool
  subprocesses. The target adapter started from the user's `acpx` therefore ran logged out (claude-2).
  Fix: a custom agent class reads the token from a file at adapter start.

**S3 — Gitea sidecar.** Yes. The task's `docker-compose.yaml` services start with `depends_on` and
healthchecks. A self-seeding Gitea plus a hook in `main` makes runs fully hermetic. `.acpxrc.json` is
written into the repo root, so it must go into `.git/info/exclude`, or agents may commit it.

**S4 — Metrics.** Harbor's own token numbers cannot be used for the target agent.
- `result.json` `agent_result` covers **only the simulated user**.
- The ACP bridge trajectory carries no target usage for Claude. For Codex, `acp_target_usage`
  reported 58 k tokens against 1.56 M actual, which is the last turn only.
- **Reliable source: the target's native session logs.** Both Claude and Codex sessions matched an
  isolated `ccusage@20` run to the token (0 % deviation). Run ccusage with `HOME` and the config dir
  pointed at the trial's session copy. Without isolation, host ccusage reads every host session.
- **The `agent-dev` Cost Summary posted inside the run was wrong** ($0.049: it counted only the user
  agent's session). Harbor relocates the target's config dir (`CLAUDE_CONFIG_DIR=/logs/agent/sessions`)
  and ccusage does not see it there. With subscriptions, USD is only an API-price equivalent, and
  ccusage priced `gpt-6-luna` implausibly low. Compare tokens, not USD.
- Wall times come from `result.json`: `environment_setup`, `agent_execution`, `verifier`.

**S5 — Consumer project (real backend, cloned template ticket).** Not run. It needs your go-ahead,
because it creates real tickets and PRs. The building blocks are the same; the differences are:
- the project is bind-mounted or cloned at its base branch;
- the backend credentials go into the container;
- setup clones the template ticket;
- teardown closes the PR, deletes the branch and marks the clone.

**S6 — Cost and duration.** A small ticket takes 4–10 min wall time per harness, including setup
and verify.
- Claude: 3.5–5.0 M tokens. Codex: 0.9–3.2 M tokens. OpenCode/Mistral: 0.6 M tokens. Over 95 % of
  this is cache reads.
- Simulated user: about 0.2 M tokens of Haiku per run.
- The final series of 5 runs took 35 min. A full comparison with 3 harnesses × 3–5 repetitions takes
  about 1–2 h and uses a noticeable share of the subscription quota, so it runs as a local,
  deliberately triggered job (for example before releasing a dependency bump), not per commit.

## Real findings about the workflow (independent of the tooling)

The spike already caught these. It is the kind of signal the E2E process is meant to produce:

1. **No spec file on the "bounded" path.** superpowers 6.x brainstorming has three paths. On the
   *bounded* path it presents the design in chat and writes **no spec file**.
   - `agent-dev`'s hook "Written spec approved → post Approved Spec" never fires.
   - Both agents improvised: they posted the in-chat design as "Approved Spec (no separate spec
     file)".
   - The e2e-or-manual question was skipped by Claude.
   - → `agent-dev` should hook "design approved" (any path), not "written spec approved".
2. **Gitea status transition.** Claude added `status:in-progress` without removing `status:new`,
   apparently because `tea issues <n>` does not show labels. The ticket ended up with `new` and
   `review`. → The Gitea include should read labels explicitly (`tea labels`/API) or always pass
   `--remove-labels` for the previous state.
3. **`tea` is missing from the image.** The gitea backend cannot work in our container today.
4. **OpenCode loads `agent-dev` several times.** It reads `.claude/skills` and `.agents/skills` as
   well, warns `duplicate skill name`, and uses the **Claude** variant rather than `.opencode/skills`.
5. **Cost Summary is fragile.** It counts whatever ccusage sees in default locations. It undercounts
   when config dirs are relocated, and overcounts on shared machines (already documented).
6. **Spec comment posted as a literal command.** Codex put `$(cat <spec>)` inside a *quoted*
   heredoc, so the ticket received the literal command instead of the spec. The Gitea include's
   pattern should be harder to misuse, for example `tea comments add … "$(cat file)"` with the body
   built in a file.
7. **Unrelated commit in the PR.** Codex committed `.gitignore` (`.worktrees/`) on `main` before
   creating the worktree, so the commit is in the PR.
8. **ACP changes behaviour.** Under ACP, Claude uses `mcp__acp__Read`/`Bash` (client-side tools), and
   the adapter appends a `<system-reminder>` to file reads that the agent treated as prompt
   injection. E2E-under-ACP is **not identical** to interactive use.

## Evaluation-design lessons

- **Do not couple checks to superpowers internals.** Superpowers' internal flow is theirs to change.
  That includes the brainstorming path classification, worktree choices, TDD order, review steps and
  skill names beyond the entry skill. Asserting on any of it would make the E2E suite break on every
  upstream release. Checks cover only:
  1. `agent-dev`'s own contract: ticket edges, naming, draft PR, guardrails.
  2. Observable results: hidden acceptance tests, the agent's tests, the diff.
  3. Outcome-based quality: an LLM judge compares the posted spec and the diff with the briefing.
     This is how interview quality is measured, not by conversation steps.

  Whether superpowers was active at all is recorded only as a soft, non-scored signal. This would
  have flagged OpenCode, which never loaded the superpowers bootstrap under ACP, yet scored 1.0
  because the outcome was right.

- Hidden acceptance tests must only test what the briefing actively communicates, or what follows
  unambiguously from the ticket. "No `dueDate` key when unset" was unaskable, and it cost Claude 1/5.
- Process checks must assert *exactly one* status label, and the right one.
- The verifier must archive evidence: ticket comments, PR diff, labels. Gitea is gone after teardown.
- A broken run (claude-2: target never logged in) scored 0 and was detectable, but only in hindsight.
  Add a bridge health check: the first `acpx prompt` must get a real reply, otherwise abort early.

## Recommendation

**Integrate Harbor, and build only our own layer.** Do not write our own runner.
- What Harbor already provides: sandboxing, compose sidecars, harness adapters, the simulated user,
  version pinning hooks and job layout. All of it worked after small, contained adjustments (three
  ~40-line agent subclasses plus image changes).
- What is ours to build: the adjustments above as maintained code; a metrics extractor from native
  session logs (isolated ccusage); stricter process checks with evidence archiving; a run fingerprint;
  `compare`; and the `docs/adw-e2e/{timestamp}/{harness}` report.

**Accept two risks consciously:**
- ACP is a fidelity gap compared with interactive use (tools, mid-turn questions).
- Harbor moves fast: 0.24, and ACP adapters are pinned inside Harbor. Pin Harbor in
  `inventory.json` and treat Harbor updates like any other component update. A Harbor bump is itself
  a candidate "breaking change" that the comparison has to catch.

Fallback if ACP fidelity proves unacceptable: replace only the dialogue driver. Keep Harbor's
environment, verifier and job layout, and drive each harness natively through `claude -p --resume`,
`codex exec resume` and `opencode serve` from our own user-simulator agent.

## Open before the target design

- S5 consumer run against a real backend: needs a project, a template ticket and approval for
  external side effects.
- Variance is now measured (see Results). The target design must choose repetitions and
  thresholds accordingly.
- OpenCode with the same model as Codex: not compared (the OpenAI OAuth expired; ran Mistral).
