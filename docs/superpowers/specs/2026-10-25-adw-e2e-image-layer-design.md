# `adw e2e`: the ACP tooling in a local layer, not in the dev images

## Context
`adw e2e` drives the agent under test through `acpx` and the Claude Code / Codex ACP adapters
(`acpx` 0.11.2, `@zed-industries/claude-code-acp` 0.16.2, `@agentclientprotocol/codex-acp` 1.12.0).
The `adw-e2e-local` branch put them into the dev images (`docker/tools/inventory.json`
`npmPackages`). Measured in `node:24-bookworm-slim` with npm 11.19.1, they add about **480 MB**:
codex-acp 334 MB (it depends on its own `@openai/codex`), claude-code-acp 93 MB, acpx 14 MB,
shared dependencies about 40 MB. Only `adw e2e` uses them, and only for the agent session; the
answerer and judges run `claude -p`, `codex exec` or `opencode run`.

Decisions made:
- The dev images stay without the ACP tooling (as on `main`).
- `adw e2e` builds a thin layer **on the project's own dev image**, whatever
  `compose.ai-dev.yml` resolves to: a published image or a project's own extension of it. Nothing
  extra is published.
- The layer's pins come from `docker/tools/inventory.json`, like every other pin.

## Shipped files
In the npm package (and the `package.json` `files` allowlist):

- `e2e/local/image/Dockerfile`
- `e2e/local/image/package.json`, `e2e/local/image/package-lock.json` (derived, see below)

```dockerfile
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY package.json package-lock.json /opt/adw-e2e/
RUN npm ci --prefix /opt/adw-e2e --omit=dev --no-audit --no-fund \
 && ln -s /opt/adw-e2e/node_modules/.bin/acpx /opt/adw-e2e/node_modules/.bin/claude-code-acp \
          /opt/adw-e2e/node_modules/.bin/codex-acp /usr/local/bin/
```

The dev images set no `USER` (the entrypoint drops to `dev`), so the layer installs as root and
changes nothing else.

## Building the layer
A new module `e2e/local/image.mjs`, called once per `adw e2e` invocation after preflight and before
the first trial:

1. **Resolve the base image.** `docker compose -f compose.ai-dev.yml [-f compose.ai-dev.certs.yml]
   config --format json` with the same compose files and env as a trial (`composeEnv`). Take the
   `ai-dev-workflow` service's `image`. If the service has `build:`, run
   `docker compose … build ai-dev-workflow` first.
2. **Use it as compose would.** If the image is present locally, use it; pull it only when missing
   (compose's default `pull_policy: missing`). A run therefore uses exactly the image `./ai-dev.sh`
   would.
3. **Tag.** `adw-e2e:<first 12 hex of sha256(base image ID, Dockerfile, lockfile)>`. If that tag
   exists, skip the build. Otherwise `docker build --build-arg BASE_IMAGE=<base image ID>
   --label adw.e2e.root=<project root> -t <tag> e2e/local/image`, its output streamed under one
   heading line: `building the e2e layer on <image>`.
4. **Prune.** After a successful build, remove the other `adw-e2e` images with the same
   `adw.e2e.root` label, so each update of a moving tag such as `node-latest` does not leave
   480 MB behind. A failed removal (image in use) is ignored.
5. **Override.** Write `compose.adw-e2e.yml` into the run directory:

   ```yaml
   services:
     ai-dev-workflow:
       image: <tag>
       pull_policy: never
       build: !reset null
   ```

   `session.mjs` passes it as the last `-f`; the project's compose files are never touched.

A failed resolve, pull or build stops `adw e2e` before any trial, with the tail of the build output.
The session's hint "the project's ai-dev image must include acpx" goes away: `adw e2e` now provides
acpx itself.

The run record (`localFingerprint`) gains the layer tag and the base image ID, so a comparison shows
when the image changed.

## Pins and inventory
- `docker/tools/inventory.json` gets a group `e2eNpmPackages` with the three packages.
  `npmPackages` returns to `main`'s list.
- `docker/tools/inventory.mjs` derives `e2e/local/image/package.json` and its lockfile from that
  group, as it does `tools/package.json` and its lockfile: `sync` renders the `package.json` and
  regenerates a stale lockfile, `check` reports drift in both, `outdated` / `update` include the
  group. The `dependency-update-check` skill's description names the new group.
- **Lockfiles are generated with the base image's npm**: `docker run --rm
  <baseImage.reference> npm install --package-lock-only --ignore-scripts …` with the directory
  mounted and the host user's uid/gid, instead of the host's npm. An older host npm (11.6.2) drops
  the `libc` fields, so image builds also install the musl binaries. `check` fails when a lockfile
  entry whose name ends in `-musl` has no `libc`. `sync` and `update` now need Docker.
- The Harbor self-test keeps the versions Harbor pins (`ACP_VERSIONS` in `e2e/lib/fingerprint.mjs`,
  the `npm install -g` line in the task Dockerfiles). They are not derived from `e2eNpmPackages`:
  Harbor's pins and ours may differ.

## Dev-image cleanup
No published image contains the ACP tooling (CI publishes from `main` only), so this undoes the
branch's image changes:

- `docker/tools/package.json` and `package-lock.json` equal `main`'s again (modulo later pin
  updates on `main`).
- `docker/README.md` no longer lists `acpx` and the ACP adapters in the base image.
- `e2e/tasks/{demo-todo,demo-todo-dotnet}/environment/Dockerfile` get `main`'s preinstall back:
  `npm install -g acpx@0.11.2 @zed-industries/claude-code-acp@0.16.2 @agentclientprotocol/codex-acp@1.12.0`.
- README "E2E on your project": the prerequisite "an ai-dev image that includes `acpx`" becomes
  "the first run builds a thin e2e layer on your dev image (about 480 MB, cached until the image or
  the pins change)". `AGENTS.md` and `agent-src/README.md` follow where they mention it.

## Upgrade path
None needed: `adw e2e` is not released yet. Consumers get it with the first version that ships it;
their dev image and compose files stay as they are. No README "Updating" entry.

## Testing
- `e2e/local/image.test.mjs`, with a fake `exec` as in `session.test.mjs`: base image from `image:`
  and from `build:`; tag stable for equal inputs and different when the base image ID or the
  lockfile changes; build skipped when the tag exists; pruning by label; the override file's
  content; a build failure throws before any trial.
- `session.test.mjs`: the override is the last `-f`.
- `docker/tests/inventory.test.mjs`: rendering and drift of the e2e `package.json`/lockfile; the
  musl/`libc` check.

## E2E
The Harbor self-test does not run `adw e2e`, so a contract check in `e2e/lib/trial.mjs` would not
exercise this. Acceptance is a real run: dursthelfer at `d531913`, ticket #510, Claude Code with
`claude-opus-5-5` at medium effort (`CLAUDE_CODE_EFFORT_LEVEL=medium` via `e2e.env`). Done when that
run builds the layer, completes a trial and writes its report.
