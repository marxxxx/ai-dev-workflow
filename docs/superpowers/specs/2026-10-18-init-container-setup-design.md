# `init` sets up the dev container

## Problem

Running a consuming project in the agent container means reading `docker/README.md` first. Today you
copy `docker/docker-compose.yml` as `compose.ai-dev.yml`, pick an image tag, and export
`PROJECT_ROOT`, `HOST_UID` and `HOST_GID`. You choose a stable `-p` name yourself and type it into
every `docker compose` command. Behind a corporate proxy you also copy the certs overlay and add a
second `-f`. Then you have to find out which logins your coding agent and your ticketing backend
need. New users stall before they ever see the workflow.

## Goal

When someone answers the interview, `init` writes everything the project needs to run in the
container, plus a single command to start it. It ends by saying exactly what to do next, built from
the answers the user just gave. The user should be able to work without reading anything upfront.

Success:
- On a fresh project, `init` → "yes, node" → the printed steps run in order, with no other
  reading, and leave you with a logged-in agent in the container that can run `agent-dev`.
- The same works in PowerShell on Windows with `ai-dev.ps1`.
- A project that already has `ai-project.json` can get the container files by running `init` again,
  without touching its config.
- `npm test` stays green; `npm pack --dry-run` lists the new templates.

## Non-goals

- Docker-in-Docker overlay, published ports and database sidecars. The user adds those to the
  project-owned compose file.
- Building images. The files point at the published `marxx/ai-dev-workflow` images.
- Installing Docker or checking the host for it.
- Keeping the written files in sync with later package versions (see Ownership).

## Anti-goals

- Hiding flags in the scripts. `./ai-dev.sh claude` runs `claude` and nothing else. Anything like
  `--dangerously-skip-permissions` stays visible, both in the docs and in what the user types.
- Overwriting a file the project already has.
- Next steps that branch ("if you use GitHub…"). The printout and `AI-DEV.md` cover only the chosen
  backend.

## Ownership

The container files are **project-owned once written**, like `ai-project.json`. They carry no
`DO NOT EDIT` banner; `generate`, `check` and `upgrade` neither render nor inspect them. `init` writes
each file only when it is missing and otherwise reports it as left untouched.

## Interview

Two questions are appended to `runInterview`, after the PR target branch:

1. `Set up the dev container? (Y/n)`, key `container.enabled`, default `y`.
2. When yes: `Container stack (node/dotnet/generic)`, key `container.stack`. The default is
   detected from the project root: `package.json` → `node`; any `*.sln`, `*.slnx` or `*.csproj` at
   the root → `dotnet`; neither → `generic`. When both are present, `dotnet` wins *(my call: the .NET
   image is what makes the C# language server work; a .NET project with a JS frontend still builds
   there)*.

The scripted prompter (`--answers`) takes the same keys, but a **missing** `container.enabled`
means no container *(my call: existing automation, including the E2E seed in `e2e/run.mjs`, keeps
getting exactly the files it gets today, and E2E baselines stay comparable)*. With no TTY and no
answers file, the existing scaffold fallback runs and container setup is skipped *(my call)*.

These answers are **not** written to `ai-project.json` *(my call)*. They only drive the one-time file
writes, and keeping them out means `config.mjs`, tokens and `upgrade` do not change.

**Existing `ai-project.json`.** If the user declines the overwrite, `init` no longer exits. It asks the
container questions and writes the container files. The ticketing backend and project name it needs
come from the existing `ai-project.json`. Declining both writes nothing.

## Files written into the consuming project

`init` renders the templates from `agent-src/container/` (shipped in the npm package). It uses plain
string substitution of a few values (project slug, image, backend-specific README parts). This is
separate from the generated-unit pipeline and does not go through it.

| File | Content |
|---|---|
| `compose.ai-dev.yml` | Today's `docker/docker-compose.yml`, plus a top-level `name: <slug>-ai` and an image default of `${AGENT_IMAGE:-marxx/ai-dev-workflow:<tag>}`. `<tag>` is `node-latest`, `dotnet-latest` or `latest`. For `node`, the named volume masking `/workspace/node_modules` is active (`deps-node-modules`); the commented example for nested trees stays. |
| `compose.ai-dev.certs.yml` | Today's `docker/docker-compose.certs.yml`, with its header comment updated to say the scripts apply it automatically when `AGENT_CA_DIR` is set. |
| `ai-dev.sh` | POSIX launcher, LF, mode 0755 |
| `ai-dev.ps1` | PowerShell launcher |
| `AI-DEV.md` | Short how-to (below) |
| `.gitignore` | Append `.env.ai-dev` if no line matches it; create the file if missing |
| `.gitattributes` | Append `ai-dev.sh text eol=lf` if no line matches it; create the file if missing |

`<slug>` is the project name lowercased, with every run of characters outside `[a-z0-9_-]` replaced
by `-` and leading/trailing `-` trimmed (Compose project-name rules). The top-level `name:` gives a
stable Compose project, and with it a stable `agent-home` volume, without `-p`. A bare
`docker compose -f compose.ai-dev.yml …` still needs `PROJECT_ROOT` set, because the template keeps
its `${PROJECT_ROOT:?…}` guard, which the image's workspace validation and the smoke tests rely on.
The docs never tell users to run bare compose.

Image tags default to the moving `*-latest` tags *(my call: quickest start; teams can pin a dated tag
through `AGENT_IMAGE` in `.env.ai-dev`, or by editing the compose file they own)*.

### Launchers (`ai-dev.sh`, `ai-dev.ps1`)

Same behavior in both:

1. Resolve the project root as the directory the script is in, so it works from any cwd.
2. If `<root>/.env.ai-dev` exists, load it as `KEY=VALUE` lines (`#` comments and blank lines
   ignored), without overriding variables already set in the environment.
3. Set `PROJECT_ROOT` to that root. In `ai-dev.sh`, also set `HOST_UID`/`HOST_GID` from `id -u` /
   `id -g` unless they are already set. PowerShell leaves them unset, since Docker Desktop uses the
   default 1000:1000.
4. Compose files: `compose.ai-dev.yml`, plus `compose.ai-dev.certs.yml` when `AGENT_CA_DIR` is
   non-empty.
5. Run `docker compose -f … run --rm ai-dev-workflow <args>`. With no args the command is `bash`
   (the compose `command:` default). Arguments are passed through verbatim. Propagate the exit code.

`ai-dev.ps1` has to run under both Windows PowerShell 5.1 and PowerShell 7. `AI-DEV.md` shows
`.\ai-dev.ps1` and covers the execution-policy workaround in one line.

### `.env.ai-dev`

A per-machine, git-ignored file. `init` never creates it. `AI-DEV.md` documents the variables it can
hold: `AGENT_CA_DIR`, `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` (keep `localhost,127.0.0.1,::1`),
`AZURE_TENANT_ID`, `CONTEXT7_API_KEY` and `AGENT_IMAGE`. It is only read when the container starts,
so it can be added or changed at any time.

### `AI-DEV.md`

Short and task-ordered. Only the chosen backend's section is included. Sections:

1. **Start**: `./ai-dev.sh` / `.\ai-dev.ps1` opens a shell; `./ai-dev.sh <command>` runs a command.
   Logins persist in the project's `agent-home` volume. `docker volume rm <slug>-ai_agent-home`
   deletes them *(my call: works without `PROJECT_ROOT`, the same in both shells)*. If
   `./ai-dev.sh` reports permission denied (for example when the file was committed from Windows),
   run `chmod +x ai-dev.sh` or `sh ai-dev.sh`.
2. **Log in your coding agent**, one line each: `./ai-dev.sh claude` (log in interactively),
   `./ai-dev.sh codex login --device-auth`, `./ai-dev.sh opencode auth login`. Then the run commands:
   `claude --dangerously-skip-permissions`, `codex --yolo`, `opencode`.
3. **Ticketing and Git**, chosen backend only:
   - `github`: `./ai-dev.sh gh auth login`, then `./ai-dev.sh gh auth setup-git`.
   - `gitea`: `./ai-dev.sh tea login add` with the login name from `ai-project.json`
     (`ticketing.gitea.login`). Git push credentials for the Gitea remote go in a credential helper
     or SSH key inside the container home.
   - `azure-devops`: `./ai-dev.sh az login --use-device-code --allow-no-subscriptions` (append
     `--tenant <id>` or set `AZURE_TENANT_ID`). This login is separate from Git remote auth.
   - `file`: no ticketing login. Git remote auth as for the remote's host.
   - Every backend: verify with `./ai-dev.sh git ls-remote origin`.
4. **Behind a corporate proxy?** Put the certificate dir and proxy variables in `.env.ai-dev`. The
   scripts add the certs overlay automatically.
5. **Customize**: the compose file is yours. Add services, ports and `node_modules` volumes. Keep
   the `/workspace` bind, `agent-home`, the capability set and the UID/GID settings. Link to
   `docker/README.md` on GitHub for the details.

## Next-steps printout

`init` ends with a numbered list built from the answers. This replaces today's single "Next:" line.
For the container path, with `github` as an example:

```
Next steps:
  1. npx @strobl_dev/adw@X.Y.Z generate        (renders .claude/.codex/.opencode/.agents)
  2. ./ai-dev.sh claude                        (log in once; or: codex login --device-auth / opencode auth login)
  3. ./ai-dev.sh gh auth login && ./ai-dev.sh gh auth setup-git
  4. Create AGENTS.md: ./ai-dev.sh claude, then /init
  5. Commit ai-project.json, the generated dirs and the container files.
  6. Start working: ./ai-dev.sh claude --dangerously-skip-permissions, then ask for agent-dev.
  Details: AI-DEV.md  (PowerShell: .\ai-dev.ps1 instead of ./ai-dev.sh)
```

The generate command shown is the one the user actually ran: `npx @strobl_dev/adw@<package version>`
from `package.json` *(my call: other ways of invoking it can't be detected reliably, and the
versioned `npx` form matches the README)*. The backend line follows the `AI-DEV.md` table, and
`file` drops it. Without the container, the steps stay as today (generate, AGENTS.md, commit). The
`DEPENDENCIES` block is printed only when the container was declined, because the image already
contains every tool it lists *(my call)*.

## Single source for the templates

The templates move to `agent-src/container/` and ship through `package.json` `files`
(`"agent-src/container"`, per AGENTS.md rule 2). `docker/docker-compose.yml` and
`docker/docker-compose.certs.yml` are deleted *(my call: two copies would drift)*. Follow-ups:

- `docker/tests/runtime-smoke.mjs` uses `agent-src/container/` instead. It renders the compose
  template with the same function `init` uses, or substitutes the placeholders itself.
- `docker/README.md`: the "copy the template" and certs-overlay steps become "run `init` and answer
  yes", with a manual fallback that renders the files with `init --answers`. The deep reference
  sections (auth, mounts, dependency isolation, TLS) stay.
- `README.md` → *Run in a container*: lead with `init`; drop the manual `export … docker compose -p`
  block for consuming projects. The self-dev `compose.ai-dev.yml` at the repo root is unaffected.

## Tests

Logic is tested; prose and templates are not (AGENTS.md TDD rule).

- Stack detection (`package.json`, `.sln`/`.slnx`/`.csproj`, both, neither).
- Slug derivation.
- `cmdInit` with scripted answers: files written per stack and backend; executable bit on
  `ai-dev.sh`; `.gitattributes` line appended once; a missing `container.enabled` writes no
  container files; correct image tag; `node_modules` volume only for `node`; backend-only `AI-DEV.md`
  section; existing files left untouched and reported; `.gitignore` appended once (idempotent) or
  created; `container.enabled: n` writes nothing extra.
- Declining the `ai-project.json` overwrite still offers and writes the container files.
- Rendered templates contain no unresolved placeholders.
- `npm pack --dry-run` includes `agent-src/container/` (manual check).

The launch scripts are checked by hand on Linux and Windows. Running Docker is not part of `npm test`.

## Left to the builder

- Placeholder syntax for the templates. It must not collide with the generator's `{{token}}`
  fail-closed check, which never sees these files anyway.
- Exact wording of the interview prompts and `AI-DEV.md`, within the structure above.
- Whether the container writes live in `onboard.mjs` or a new `lib/container.mjs` (if new, add it to
  `files`).
