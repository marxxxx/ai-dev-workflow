# ai-dev-workflow

A lean AI development workflow for **Claude Code**, **Codex**, and **OpenCode**: one `agent-dev`
skill that takes a change from an (optional) ticket to a pull request by running the unmodified
[superpowers](https://github.com/obra/superpowers) workflow, generated per project from one small
config file.

The generator is a zero-dependency Node script. It's distributed **directly from this Git repo** (no
npm registry) and the consuming project does **not** need to be a Node project. It works in any repo
(C#/.NET, Go, Rust, …) — the only requirement is Node on the machine that runs the generator (your
dev box and CI). Pin to a Git tag (e.g. `#v0.23.0`) so devs and CI stay in sync.

## What lands in your repo

| File / dir | Owner | Committed? |
|---|---|---|
| `ai-project.json` | **you** — project identity + ticketing backend choice | yes |
| `AGENTS.md` | **you** — create with your coding agent's native `/init`; `agent-dev` reads it first (add an [End-to-end testing](#end-to-end-testing) section for agent-run e2e checks) | yes |
| `agent-custom/` | **you** (optional) — per-project tweaks to the skill body (see [Customizing the skill](#customizing-the-skill)) | yes |
| `docs/superpowers/{specs,plans}/` | written by superpowers during each run; the approved spec is also posted to the ticket | yes |
| `.claude/`, `.codex/`, `.opencode/`, `.agents/` | generated output | yes (review diffs on update) |
| `.mcp.json` | merged (azure-devops backend only) — the shared `ado` server entry; other servers preserved | yes |
| `.codex/config.toml` | merged (azure-devops backend only) — the Codex project-local `ado` MCP server entry; other Codex settings preserved | yes |

Everything else (the skill source, ticketing/cost includes, the generator) lives in the package and
updates with it. See [`agent-src/README.md`](agent-src/README.md) for how the sources are authored.

## Quick start (any project, incl. C# — no `package.json` needed)

`npx` can run the bin straight from GitHub — nothing is installed into the repo:

```bash
# 1. run the guided onboarding — writes ai-project.json, prints the recommended tooling
npx github:marxxxx/ai-dev-workflow#v0.23.0 init

# 2. (the interview sets project identity, repository, and ticketing.backend.
#    For azure-devops it also captures org/project + process template and pre-fills
#    the state mapping; generate then merges the `ado` server into .mcp.json
#    and .codex/config.toml.
#    Install the tooling it lists — see Tooling below — then create AGENTS.md
#    with your coding agent's native /init.)

# 3. generate the platform files
npx github:marxxxx/ai-dev-workflow#v0.23.0 generate

# 4. commit ai-project.json and the generated dirs
```

Pin the tag (`#v0.23.0`) so devs and CI stay in sync — a C# repo has no lockfile to do it for you.

## Tooling

`init` prints this list. **You install them** — for whichever of Claude Code / Codex / OpenCode you
run. This workflow deliberately does not carry install instructions: they differ per harness and go
stale. Follow each project's own docs.

| Tool | | What `agent-dev` uses it for |
|---|---|---|
| [superpowers](https://github.com/obra/superpowers) | **required** | The whole workflow: brainstorming → worktree → plan → implementation (TDD, review, verification) → finishing the branch |
| [serena](https://github.com/oraios/serena) | recommended | MCP server: semantic, symbol-level code navigation and editing |
| [playwright](https://github.com/microsoft/playwright-mcp) | recommended | MCP server: drives a real browser for the optional [end-to-end check](#end-to-end-testing) |
| [context7](https://github.com/upstash/context7) | recommended | MCP server: up-to-date library and framework documentation |
| [ccusage](https://ccusage.com) | recommended | CLI behind the [cost summary](#cost-summary); without it the summary names the gap |

For the `azure-devops` backend, `generate` merges the `ado` MCP server (pinned to
`@azure-devops/mcp@2`, whose tool names the Azure DevOps ticketing include is written against) into
`.mcp.json` and `.codex/config.toml` — nothing to install by hand.

The `gitea` backend requires [`tea`](https://gitea.com/gitea/tea), Gitea's official CLI, installed
and logged in — see [Gitea backend setup](docs/gitea-backend-setup.md).

## Commands

| Command | Effect |
|---|---|
| `generate` (default) | Render all platform files to the project root |
| `check` | Render in memory and diff against disk; exit 1 on drift (CI / pre-commit gate) |
| `init` | Interactive onboarding: prompts for project identity, repository, ticketing backend (for azure-devops, the org/project and process template, pre-filling the state mapping; for gitea, the `tea` login profile), then writes `ai-project.json` — the only file it creates. It prints the [tooling](#tooling) for you to install, and points you to create `AGENTS.md` with your coding agent's native `/init`. Falls back to a template scaffold when stdin is not a TTY. Never overwrites without confirmation. |

All commands accept `--root <dir>` to target a project root other than the current directory.

## Customizing the skill

`ai-project.json` and per-unit `tokens` cover most tuning. To change the instructions of the shipped
skill, add a committed **`agent-custom/`** directory that mirrors the source layout
(`agent-custom/skills/<name>/`). Two knobs:

| File | Effect |
|---|---|
| `agent-custom/skills/agent-dev/append.md` | **Appended** to the package body. The safe default — upstream improvements keep flowing on update. |
| `agent-custom/skills/agent-dev/body.md` | **Full override** — replaces the package body. You then own that body (it no longer tracks upstream). |

Both files support the same `{{tokens}}` as package bodies (`{{project.name}}`, `{{repo.slug}}`, …);
an unresolved token fails the generator with a clear error. Example:

```md
<!-- agent-custom/skills/agent-dev/append.md -->
## House rules
Always run `npm run lint` before finishing the branch.
```

Then `generate` and commit. `agent-custom/` files are **inputs** to generation, so `check` still
passes and still catches hand-edits to the generated files.

## The `agent-dev` workflow

Run `/agent-dev [ticket-id]` (Codex: `$agent-dev`). The skill adds only what superpowers doesn't know
about — the ticket and its comments — and otherwise follows the superpowers skills as written:

1. **Start** — record the start time, read `AGENTS.md`; with a ticket, read it and move it to
   `in-progress`. Without one, it asks whether to **create a ticket**; if you say yes, it creates one
   once brainstorming has settled the scope and uses it for the rest of the run. A ticket already
   `in-progress` **resumes** where the earlier run stopped: straight to planning if a spec was
   approved, to the next unfinished plan task if a plan exists (offering a partial cost summary for
   the interrupted session).
2. **Brainstorming** — the full requirements interview with you. A ticket (often an upstream ticket
   with too little detail to implement from) is only background context; it never replaces the
   interview. For changes with user-visible behavior it also asks whether the agent should test
   end to end or you prefer to test manually. The spec lands in `docs/superpowers/specs/`; once you
   approve it, it is posted to the ticket as an **Approved Spec** comment (split into numbered
   comments if it exceeds the backend's limit; the file backend gets just the path). The plan stays
   in the repo.
3. **The rest of the superpowers workflow** — whatever superpowers chains from brainstorming
   (today: worktree, plan, implementation with TDD and review, finishing the branch). `agent-dev`
   does not restate that chain; it only hooks in at events (spec approved, branch created,
   integration offered), so superpowers releases need no changes here.
   If you chose agent testing, an [end-to-end check](#end-to-end-testing) runs before integrating.
   Instead of superpowers' merge/PR/keep menu, the run always ends with a **draft PR**
   (Gitea: a `WIP:` title), so a human reviews and tests before publishing it.
4. **Close-out** — with a ticket, post an **Implementation Summary** comment (approach,
   consequences, possible side effects, what to watch when testing) and a **Cost Summary** comment,
   then move the ticket to `review`. Without a ticket, both are printed instead.

Names derive from the ticket's number and a short version of its title: branch
`<number>_<short_title_slug>` (e.g. `42_user_login_form`), PR title `<number>: <short title>` (e.g.
`42: User login form`). Without a ticket, both drop the number.

Ticket states are just `new → in-progress → review`; acceptance and closing stay with the human.
Nothing beyond the spec and those two comments is written to the ticket.

### End-to-end testing

Superpowers itself never starts your app: its verification is satisfied by passing tests. So
`agent-dev` adds one decision and one step. During brainstorming, for a change with user-visible
behavior (UI, user flows), it asks whether **you want the agent to test it end to end** or **you
prefer to test it manually**, and records the answer in the spec. If you chose the agent, it starts
the app, exercises the changed flows in a browser via Playwright, captures evidence, and shuts the
app down before opening the draft PR. The **Implementation Summary** always states the outcome:
tested by the agent (with what was checked), left to manual testing at your request, or not tested
and why. A missing setup, missing browser tooling, or a failed startup never blocks the PR; it is
reported there instead.

The workflow ships no start/stop scripts, because starting the app differs per stack and per OS.
Describe it in prose in an **End-to-end testing** section of your `AGENTS.md`, and the agent turns
that into commands for the OS it runs on. Cover:

- the backing services to start (database, cache, broker) and any migrate/seed steps;
- how to start the app and how to tell it's reachable;
- the base URL and ports;
- the **test-locator attribute** to select elements by (for example `data-testid`).

Without that section, the agent tells you during brainstorming if you ask it to test end to end.

### Cost summary

One total per run — tokens and estimated USD — from a single `ccusage@20 session --json` report,
which covers every harness in one JSON shape. It counts the sessions active in the run's **time
window**, which includes Codex/OpenCode subagent sessions with no bookkeeping during the run. The
report has no project field, so on a shared host other sessions active in that window are counted
too; the comment lists every counted session. In the container runtime the home volume is per
project, so the count is project-scoped there. ccusage's JSON is not a stable API, which is why the
major version is pinned; models ccusage cannot price are named instead of shown as $0. If a run
fails, is abandoned, or is interrupted, `agent-dev` offers a **partial** cost summary so failed
attempts still count; a ticket can therefore carry several cost comments, which together are its
cost. Cost reporting never blocks the close-out. The procedure lives in the generated
`.agents/includes/cost.md`.

## In a Node project

Add it as a dev dependency pointing at the Git tag, and wire up scripts:

```jsonc
"devDependencies": {
  "@strobl/ai-dev-workflow": "github:marxxxx/ai-dev-workflow#v0.23.0"
},
"scripts": {
  "agents:generate": "ai-dev-workflow generate",
  "agents:check":    "ai-dev-workflow check"
}
```

## Updating

```bash
npx github:marxxxx/ai-dev-workflow#<new-tag> generate   # or bump the pinned tag, then `generate`
```

Review the diff in `.claude/`/`.codex/`/etc. and commit. `ai-project.json` is never touched. Run
`check` in CI to catch a stale or mismatched version. Every generated file carries a
`DO NOT EDIT — generated from agent-src/…` banner.

**Upgrading to v0.23.0.** The custom multi-agent workflow is replaced by the single `agent-dev`
skill. `dev-cycle`, `product-architect`, the `developer` / `code-reviewer` / `qa-engineer` agents,
the developer journal/handoff, and the e2e include are gone; ticket states shrink to
`new → in-progress → review`. **superpowers is now required.** `generate` does not delete files it no
longer produces, so remove these yourself:

```
.claude/agents/{developer,code-reviewer,qa-engineer}.md
.codex/agents/{developer,code-reviewer,qa-engineer}.toml
.opencode/agents/{developer,code-reviewer,qa-engineer}.md
.claude/skills/{dev-cycle,product-architect}/
.agents/skills/{dev-cycle,product-architect}/
.opencode/skills/{dev-cycle,product-architect}/
.agents/includes/{handoff,e2e-runtime}.md
```

`agent-custom/` files for the removed units are ignored; move anything you still need to
`agent-custom/skills/agent-dev/append.md`. `git.branchPattern` is no longer read — branch and PR
names now derive from the ticket — so delete it from `ai-project.json`. Old `stateMapping` keys
(`test`, `failed`, `acceptance-test`) in `ai-project.json` are harmless and can be deleted. Tickets
left in retired states (`test`, `failed`, `acceptance-test`) need a manual move.

**Upgrading to v0.20.0.** The generator now requires **Node >= 24** (previously `>=18`). Upgrade Node
on dev boxes and CI runners before bumping the pinned tag — older runtimes are unsupported and only get
an engine warning, not a clear error.

## Run in a container

The workflow ships a **container runtime** with Claude Code, Codex, OpenCode, Serena,
Playwright/Chromium, Context7, Azure DevOps MCP, Azure CLI (with the `azure-devops` extension),
Superpowers and ccusage.
Prepare the consuming project with the generator on the host, build the tool image separately,
then mount that project at `/workspace`. A project-scoped Docker volume stores the container's
own home and one-time interactive logins. The image does not install or run the generator.

```bash
export PROJECT_ROOT="$(pwd)" AGENT_IMAGE=ai-dev-workflow
export HOST_UID="$(id -u)" HOST_GID="$(id -g)"
docker compose -p my-project-ai -f docker/docker-compose.yml run --rm ai-dev-workflow codex --yolo
```

Two derived images add app-facing runtimes (`ai-dev-workflow-node`, `ai-dev-workflow-dotnet`). The
container assets live under `docker/` and are **hand-maintained, not generated**. See
[`docker/README.md`](docker/README.md) for the run model, mounts, auth/persistence, UID/GID mapping,
and how a consuming project extends the base.

To work on **this repository itself** in a container — tool stack only, without the generated
`agent-dev` skill — use the repo-root `compose.ai-dev.yml` (it sets
`AGENT_TOOLSTACK_ONLY=1`):

```bash
export PROJECT_ROOT="$(pwd)" HOST_UID="$(id -u)" HOST_GID="$(id -g)"
docker compose -f compose.ai-dev.yml run --rm ai-dev-workflow bash
```

See [`docker/README.md`](docker/README.md) → *Working on this repo in a container*.

Behind a TLS-inspecting corporate proxy, mount the company root certificates with the
`docker/docker-compose.certs.yml` overlay and pass the proxy variables; the published images
install them at startup, so no per-company image build is needed. See
[`docker/README.md`](docker/README.md) → *Corporate TLS inspection*.

## License

Apache-2.0
