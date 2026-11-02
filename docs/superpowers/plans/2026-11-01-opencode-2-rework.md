# OpenCode 2 Migration Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the uncommitted OpenCode 2 migration on `feat/opencode-2` into an OpenCode-2-only change. Remove every OpenCode 1 path. Base e2e logins on `opencode auth export` files. Then verify everything short of the paid e2e runs.

**Architecture:** OpenCode 2 is the only supported OpenCode.
- **Logins.** An OpenCode login is always a JSON array in `opencode auth export` format. It is imported with `opencode auth import`, with no conversion. Harbor and `adw e2e` share one default host file, `~/.config/adw/opencode-credentials.json`. `adw e2e` explains how to create that file.
- **Metrics.** Metrics read only the v2 tables. `superpowersActive` on OpenCode means a successful `skill` call to a superpowers entry skill.
- **Launcher.** It emits the native v2 config shape.

**Tech Stack:** Node 24 builtins (`node:test`, `node:sqlite`), Python 3.12 (Harbor agent only), Docker.

**Spec:** `docs/debriefs/2026-11-01-opencode-2-migration.md` (decisions #1–#17). The original plan is `/home/ai/.claude/plans/plan-the-migration-to-jaunty-wombat.md`.

## Global Constraints

- **No OpenCode 1 compatibility.** No `auth.json` conversion, no v1 table fallback, no migration notes (decision #5).
- **Zero runtime dependencies. LF line endings.** Never hand-edit derived files; use `node docker/tools/inventory.mjs sync`.
- **`package.json` `files`:** must change in the same task when a shipped `lib/*.mjs` or `e2e/lib` module is added or removed. Verify with `npm pack --dry-run`.
- **No commits during this plan.** Commit and PR come after the e2e runs (decision #15). Each task ends with its tests green instead.
- **Stop before e2e.** Task 8 ends by asking the user to confirm the paid e2e runs (decisions #1, #2).
- **Version:** `package.json` stays at 0.29.1. The bump to 0.30.0 happens at release (decision #13).
- **TDD:** applies to logic only, not to prose or docs.

## Review Focus

1. **Old-format login file:** an OpenCode 1 `auth.json` (a JSON object) given as the credentials file fails with a message that names `opencode auth export`. It must not be silently imported as garbage. → Task 2.
2. **Multiple providers in one export file:** Harbor imports only the entries whose `integrationID` matches the model's provider. With no match, it raises. → Task 2 (Python logic is unchanged; covered by the existing check).
3. **Export taken from the agent-home volume:** must not include TTY/CR noise or a wrapper banner. The text must parse as a JSON array before it is written. → Task 3.
4. **A failed `skill` call:** for example `superpowers:brainstorming` → "Unable to load skill". It must NOT count as `superpowersActive`. → Task 4.
5. **OpenCode used with no login file:** the `adw e2e` run continues, since providers may come from `e2e.env`. It prints the exact commands to create the file, and does not fail. → Task 3.

---

### Task 1: Remove the old-npm lockfile check (decision #11)

**Files:**
- Modify: `docker/tools/inventory.mjs:112-127,141-143,169,195-196`
- Test: `docker/tests/inventory.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `muslWithoutLibc` and `NO_UPSTREAM_LIBC` no longer exist.
  - `lockfileStale(packages, lock)` compares root dependencies only.

- [ ] **Step 1:** Delete the tests that cover `muslWithoutLibc`, including "a -musl package that publishes no libc is not drift" and any lockfile-drift or sync test that asserts libc behaviour. Remove `muslWithoutLibc` from the test imports.
- [ ] **Step 2:** In `inventory.mjs`:
  - Delete `NO_UPSTREAM_LIBC`, `muslWithoutLibc` and its comment block.
  - Drop the musl clause from `lockfileStale` and from `lockfileDrift`.
  - Change the `rmSync` condition in `syncDerivedFiles` to `if (freshLockfile)`.
  - Reword the comment above `lockfileCommand` to: "The base image's npm, not the host's: lockfiles always come from the pinned npm."
- [ ] **Step 3:** Run `node --test docker/tests/*.test.mjs` and `node docker/tools/inventory.mjs check`. Expected: all pass, no drift.

### Task 2: Harbor and shared e2e libs read `opencode auth export` files (decisions #5, #6)

**Files:**
- Modify: `e2e/lib/secrets.mjs` (`stageSecrets`, delete `openCodeCredentials`/`oauthMethod` and their comment). Possibly also `removeOpenCodeAuthCopies` (see Step 1).
- Modify: `e2e/config.json:56`, `e2e/run.mjs:83`, `e2e/agents/opencode_subscription.py`, `docs/adw-e2e/README.md:17-21`
- Test: `e2e/lib/secrets.test.mjs`

**Interfaces:**
- Produces:
  - **Config key:** `auth.opencodeCredentials` in `e2e/config.json`, default `"~/.config/adw/opencode-credentials.json"`. It replaces `auth.opencodeAuthJson`.
  - **Env var:** `stageSecrets(config).env.OPENCODE_CREDENTIALS_PATH` replaces `OPENCODE_AUTH_JSON_PATH`. It points to a mode-0600 byte copy of the file.
  - `export function openCodeExport(text: string, source: string) -> Array` throws `Error` when the content is not a JSON array. The message contains `source` and `opencode auth export`. Task 3 uses it too.
  - `OPENCODE_CREDENTIALS` (container path `/home/dev/.adw-e2e/opencode-credentials.json`) stays.

- [ ] **Step 1: Check Harbor's OpenCode base agent.** Read `harbor/agents/installed/opencode.py` in the uv tool install of harbor 0.24.0 (`uv tool dir`) and see whether it reads `OPENCODE_AUTH_JSON_PATH` itself.
  - If it uploads that file as `auth.json`, renaming our variable means it no longer does. Then delete `removeOpenCodeAuthCopies`, its test and its call in `e2e/run.mjs`.
  - If its install or ACP step *requires* the variable, keep `removeOpenCodeAuthCopies` and do not set the old variable. Note the finding in the task report.
- [ ] **Step 2: Write the failing tests** in `secrets.test.mjs`:
  - `stageSecrets copies an opencode auth export file as is`. The config has `opencodeCredentials: path.join(dir, 'oc.json')` containing `[{"id":"cred_1","integrationID":"openrouter","label":"API key","active":true,"value":{"type":"key","key":"sk-or-9"}}]`. Assert:
    - `readFileSync(s.env.OPENCODE_CREDENTIALS_PATH, 'utf8')` equals the input bytes;
    - mode `0o600`;
    - `s.values` includes `'sk-or-9'` and does not include `'cred_1'`, `'openrouter'` or `'API key'`.
  - `stageSecrets rejects an OpenCode 1 auth.json`. The file content is `{"openrouter":{"type":"api","key":"k"}}`. Assert it throws `/opencode auth export/`.
  - Delete both `openCodeCredentials` tests. Rename `opencodeAuthJson` to `opencodeCredentials` in every config literal in the file.
- [ ] **Step 3:** Run `node --test e2e/lib/secrets.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 4: Implement.**
  - In `stageSecrets`, the OpenCode entry becomes `['OPENCODE_CREDENTIALS_PATH', config.auth.opencodeCredentials, 'opencode-credentials.json']`.
  - Validate that entry with `openCodeExport` and copy it unchanged.
  - Delete `openCodeCredentials` and `oauthMethod`.
  - Fix the comment above `removeOpenCodeDbCredentials`: "OpenCode 2 keeps credentials in its database…", with no auth.json wording.
  - Update `e2e/config.json` and the `has` map in `e2e/run.mjs:83`.
- [ ] **Step 5: Update `e2e/agents/opencode_subscription.py`.**
  - Read `os.environ["OPENCODE_CREDENTIALS_PATH"]`, and use that name in the error message.
  - Docstring line 3–5: "Imports only the model provider's entries from OPENCODE_CREDENTIALS_PATH (an `opencode auth export` file) into the target's XDG data dir."
- [ ] **Step 6: Update `docs/adw-e2e/README.md` OpenCode bullet:**
  > OpenCode: `opencode auth login` for the configured provider, then `(umask 077; opencode auth export > ~/.config/adw/opencode-credentials.json)`. That file is `auth.opencodeCredentials` in `e2e/config.json`. Each trial imports the provider's entries with `opencode auth import`.
- [ ] **Step 7:** Run `node --test e2e/lib/*.test.mjs` and `python3 -m py_compile e2e/agents/opencode_subscription.py`. Expected: PASS.

### Task 3: `adw e2e` takes the export file, from the host or the agent-home volume, and explains how to get it (decision #7)

**Files:**
- Modify: `e2e/local/session.mjs`. This covers `stageCredentials` (the OpenCode branch), `authContent`, `authMounts`, the `startSession` import loop and the `openCodeCredentials` import.
- Modify: `e2e/local/setup.mjs`. This covers `VOLUME_LOGIN` and the volume branch of `stepLogins`.
- Modify: `e2e/local/cli.mjs` (preflight notice), `README.md:361-364`
- Test: `e2e/local/session.test.mjs`, `e2e/local/setup.test.mjs`, `e2e/local/cli.test.mjs`

**Interfaces:**
- Consumes: `openCodeExport(text, source)` and `OPENCODE_CREDENTIALS` from Task 2.
- Produces:
  - `const OPENCODE_LOGIN = '.config/adw/opencode-credentials.json'`, exported from `session.mjs`, relative to the home directory.
  - `export const OPENCODE_LOGIN_HELP: string` in `session.mjs`. Exact text:
    > `No OpenCode login file (~/.config/adw/opencode-credentials.json); providers then come from e2e.env only. To use an OpenCode login: ./ai-dev.sh opencode auth login, then rerun adw e2e and let it copy the login from the dev container, or with OpenCode 2 on the host: (umask 077; mkdir -p ~/.config/adw && opencode auth export > ~/.config/adw/opencode-credentials.json)`
  - `authMounts(creds, harnesses)` returns plain `${from}:${to}` mounts for every harness. The private tmp copy is gone.

- [ ] **Step 1: Write the failing tests.**
  - `session.test.mjs`:
    - Replace "opencode: the login is staged as import entries…" with `opencode: the export file is staged and imported, then removed`. The host file is `<home>/.config/adw/opencode-credentials.json` with an export array. Assert that `authFiles` gives `{harness:'opencode', from, to: OPENCODE_CREDENTIALS}`. Assert that the fake `exec` receives the file bytes unchanged on `writeIn` stdin, followed by the `opencode auth import --standalone` exec.
    - Replace the `authMounts … converted into a private copy` test: `authMounts(creds, ['opencode'])` deep-equals `[`${from}:${OPENCODE_CREDENTIALS}`]`.
    - Add `stageCredentials rejects an OpenCode 1 auth.json as the login file`, expecting a throw matching `/opencode auth export/`.
  - `setup.test.mjs`: the volume branch for opencode runs a compose `run` whose argv ends with `sh -c 'cd /tmp && /opt/agent-tools/node_modules/.bin/opencode --standalone auth export'`, with no TTY (`-T`/no `-t`). With stdout `[{"id":"c","integrationID":"x","label":"API key","active":true,"value":{"type":"key","key":"k"}}]`, it writes `<fallbackHome>/.config/adw/opencode-credentials.json`. With stdout `oops` (not an array), it logs `! no usable OpenCode login in the agent-home volume` and writes nothing.
  - `cli.test.mjs`: when a role uses opencode and `creds.authFiles` has no opencode entry, the run logs `OPENCODE_LOGIN_HELP` once and does not add a preflight problem.
- [ ] **Step 2:** Run `node --test e2e/local/session.test.mjs e2e/local/setup.test.mjs e2e/local/cli.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement in `session.mjs`.**
  - The OpenCode branch becomes `authFile(harness, OPENCODE_LOGIN, OPENCODE_CREDENTIALS)`. `authFile` validates OpenCode files with `openCodeExport`.
  - Delete `authContent`, `convertedLogins` and the tmp-dir logic. `writeIn(f.to, readFileSync(f.from))`.
- [ ] **Step 4: Implement in `setup.mjs`.**
  - `VOLUME_LOGIN.opencode = OPENCODE_LOGIN`.
  - For opencode, the volume branch calls `ownComposeRun` with `entrypoint: 'sh'` and `argv: ['-c', 'cd /tmp && /opt/agent-tools/node_modules/.bin/opencode --standalone auth export']`.
  - Validate stdout with `openCodeExport`. On failure, log `! no usable OpenCode login in the agent-home volume`.
  - Change the prompt text to say "export the OpenCode login of this project's dev container".
  - **First check by hand** in the built image that `opencode --standalone auth export` prints only JSON on stdout. If it doesn't, adjust the argv and the test together.
- [ ] **Step 5: Implement in `cli.mjs`.** After `stageCredentials` in `preflight`, call `d.log(OPENCODE_LOGIN_HELP)` when a role uses opencode and no opencode auth file was staged.
- [ ] **Step 6: Update the `README.md` OpenCode logins bullet (:361-364):**
  > OpenCode: `~/.config/adw/opencode-credentials.json`, an `opencode auth export` file, or provider variables in `e2e.env`. The containers import it with `opencode auth import`. If the file is missing, the setup offers to export the login of the project's volume (after `./ai-dev.sh opencode auth login`) and prints the host command.
- [ ] **Step 7:** Run `npm test` and `node --test e2e/local/package.test.mjs`. Expected: PASS. Then `npm pack --dry-run`: the `e2e/lib` modules are unchanged.

### Task 4: Metrics: v2 only; `superpowersActive` = a superpowers skill was loaded (decisions #5, #9, #10)

**Files:**
- Modify: `e2e/lib/metrics.mjs` (`openCodeRows`, `softSignals`), `e2e/lib/fixtures/make.mjs` (`makeOpenCodeTrial`, delete `makeOpenCodeV1Trial`)
- Test: `e2e/lib/metrics.test.mjs`

**Interfaces:**
- Produces:
  - `openCodeRows(trialDir) -> {messages, catalog}`. The `v2` and `parts` fields go.
  - `makeOpenCodeTrial(dir, {read, skills = []})`. Each `skills` entry is `{id: string, status: 'completed'|'error'}` and becomes a `{type:'tool', name:'skill', state:{status, input:{id}}}` content item.
  - `SUPERPOWERS_ENTRY_SKILLS = ['brainstorming', 'writing-plans']` (the entry skills `agent-dev` names), exported from `metrics.mjs`.

- [ ] **Step 1: Write the failing tests.**
  - Replace the catalog-based OpenCode `softSignals` test with `opencode superpowersActive needs a successful superpowers skill call`. For each fixture, assert `softSignals('opencode', dir).superpowersActive`:
    - `[]` → false;
    - `[{id:'superpowers:brainstorming', status:'error'}]` → false;
    - `[{id:'agent-dev', status:'completed'}]` → false;
    - `[{id:'brainstorming', status:'completed'}]` → true;
    - `[{id:'writing-plans', status:'completed'}]` → true.
  - Delete the v1 fallback test and the `makeOpenCodeV1Trial` import.
- [ ] **Step 2:** Run `node --test e2e/lib/metrics.test.mjs`. Expected: the new test FAILS.
- [ ] **Step 3: Implement.**
  - Drop the v1 branch, the `instruction_blob` read and the `catalog` field from `openCodeRows` if nothing else uses them.
  - For opencode, `softSignals` returns `{superpowersActive: openCodeTools(trialDir).some((t) => t.name === 'skill' && t.status === 'completed' && SUPERPOWERS_ENTRY_SKILLS.includes(t.input?.id))}`. Claude Code and Codex keep the `using-superpowers` blob check.
  - Delete `makeOpenCodeV1Trial`. `makeOpenCodeTrial` no longer writes `instruction_blob`.
  - Leave the Code Mode MCP counting untouched (decision #10).
- [ ] **Step 3b:** Check that the status string of a successful v2 tool call is really `completed`. Look at the earlier spike's rows: `grep -o '"status":"[a-z]*"'` in the session transcript `/home/ai/.claude/projects/-home-ai-src-ai-dev-workflow/9060e45b-8d9f-4fa3-80d4-f970cf739d9b.jsonl`. If it differs, use the real value in both the fixture and the code.
- [ ] **Step 4:** Run `node --test e2e/lib/*.test.mjs`. Expected: PASS.

### Task 5: Launcher emits the native OpenCode 2 config (decision #16)

**Files:**
- Modify: `docker/launch-agent.mjs` (`openCodeServer` :129-141, the `OPENCODE_CONFIG_CONTENT` build near :327-336), `docker/verify-agent-config.sh` (the OpenCode check), `docker/README.md:150-152,208-219`
- Test: `docker/launch-agent.test.mjs` (:114-117, :319-323 and any `config.mcp.<name>` / `plugin` assertions)

**Interfaces:**
- Produces: `OPENCODE_CONFIG_CONTENT` with `mcp.servers.<name>` (v2 server fields) and `plugins: ['/opt/superpowers']`. There is no top-level `mcp.<name>` and no `plugin`.

- [ ] **Step 1: Pin the v2 schema.**
  - Read https://opencode.ai/v2/docs/config (MCP servers and plugins sections) for the exact field names of a local server: type, command array or command+args, environment, enabled/disabled, timeout.
  - In the image, confirm the result with `OPENCODE_CONFIG_CONTENT='<candidate>' opencode debug config` (run from a dir with an `ai-project.json`, e.g. the e2e demo task).
- [ ] **Step 2: Write the failing tests.** Update the launch-agent tests to expect:
  - `config.mcp.servers.serena.<env field>` (the `environment` key per Step 1);
  - `config.plugins` deep-equal `['/opt/superpowers']`;
  - `config.mcp.serena === undefined`.
- [ ] **Step 3:** Run `node --test docker/launch-agent.test.mjs`. Expected: FAIL.
- [ ] **Step 4:** Implement `openCodeServer` and the config build to the v2 shape from Step 1.
- [ ] **Step 5:** `verify-agent-config.sh` already reads `layer.mcp?.servers` and `layer.plugins`. Remove anything that tolerated the v1 shape. Update the `docker/README.md` wording: no "auth.json is read once" line; logins live in `opencode.db` (`opencode auth login`).
- [ ] **Step 6:** Run `node --test docker/tests/*.test.mjs docker/*.test.mjs`. Expected: PASS.

### Task 6: OpenCode 2 agent format (decision #14)

**Files:**
- Modify: `agent-src/README.md:131-151`. Possibly also `agent-src/lib/renderers.mjs:70-78` (`renderOpenCodeAgent`) and its test.

- [ ] **Step 1:** Read the OpenCode 2 docs on agents (https://opencode.ai/v2/docs/agents and migrate-v1). Record:
  - the agent file location (still `.opencode/agents/<name>.md`?);
  - the frontmatter keys that replace `model`, `temperature`, `mode`.
- [ ] **Step 2a: If unchanged:** update `agent-src/README.md:135` to "**opencode** (OpenCode 2): `model`, `temperature`, `mode`." No code change.
- [ ] **Step 2b: If changed:** write a failing renderer test in `agent-src/lib/renderers.test.mjs` that asserts the new path and frontmatter keys for a fixture agent unit. Implement it in `renderOpenCodeAgent`, then update the README table and the manifest schema line. If a key is renamed, `upgrade.mjs` does not need to change, because no agents ship today; say so in the task report.
- [ ] **Step 3:** Run `npm test`. Expected: PASS.

### Task 7: Remove the remaining OpenCode 1 mentions (decision #5)

**Files:**
- Modify: `README.md:231-235` (delete the "Upgrading to v0.30.0" paragraph), `.claude/skills/e2e-run/SKILL.md:46-47` (drop the "or one that ran OpenCode 1 (`opencode-ai`; …)" clause), `.claude/skills/dependency-update-check/SKILL.md` (keep the rename line: it is generic)
- Check: `grep -rn -i 'opencode 1\|opencode-ai\|auth\.json' --exclude-dir=node_modules --exclude-dir=adw-e2e --exclude-dir=superpowers --exclude-dir=debriefs .`. Fix every remaining OpenCode-related hit. Codex's `~/.codex/auth.json` hits stay.

- [ ] **Step 1:** Apply the edits above (prose, no tests).
- [ ] **Step 2:** Run the grep. Expected: no OpenCode-related hits.

### Task 8: Verification up to the e2e gate (decisions #3, #4)

- [ ] **Step 1:** Run `npm test`, `node --test docker/tests/*.test.mjs`, `node docker/tools/inventory.mjs check` and `npm pack --dry-run`. Expected: all green. The pack output lists the `e2e/lib/{llm,metrics,secrets}.mjs` modules.
- [ ] **Step 2:** Build the images with `node docker/build.mjs` (base, `-node`, `-dotnet`). In each image, run `verify-tools.sh` and `verify-agent-config.sh` with `PROJECT_ROOT`/`HOST_UID`/`HOST_GID` set as before. Expected: "ok" for every image.
- [ ] **Step 3: Isolate the runtime-smoke failure.**
  - Run `AGENT_IMAGE=ai-dev-workflow:2026.10.30 timeout 900 node docker/tests/runtime-smoke.mjs`.
  - Then run it against the new base image.
  - If both hit EACCES on the temp dir: note it as pre-existing, for a separate PR.
  - If only the new image does: debug it with superpowers:systematic-debugging and fix it in this branch.
- [ ] **Step 4:** Smoke test the login path once by hand in the new image:
  - Create an export file from the OpenRouter key: an `auth import` array, as `(umask 077; …)`.
  - Run `opencode auth import --standalone` into a fresh `XDG_DATA_HOME`, then `opencode run --standalone -m openrouter/~google/gemini-flash-latest 'Reply OK'`.
  - Expected: `OK`.
- [ ] **Step 5: STOP.** Report the results. Then ask the user to confirm the paid runs:
  - Harbor `e2e-run` on opencode (both tasks);
  - one local `adw e2e` on opencode with the fallback forced once;
  - one claude-code and one codex spot-check trial.

  After confirmation, and outside this plan's tasks: run them, commit and open the PR with the results, then `docker rmi adw-oc2-spike:latest` (decisions #1, #2, #15, #17).
