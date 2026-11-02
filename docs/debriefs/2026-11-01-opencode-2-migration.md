# Debrief: OpenCode 2 migration (2026-11-01)

Branch `feat/opencode-2` (uncommitted), plan `plan-the-migration-to-jaunty-wombat.md`.

## Decisions
| # | Cluster | Item | Decision | Source |
|---|---------|------|----------|--------|
| 1 | Verification | E2E before merge | Harbor `e2e-run` on opencode (both tasks), one local `adw e2e` on opencode, one claude-code and one codex spot-check trial (body.md wording changed for every harness) | user |
| 2 | Verification | `fallbackCommand` `$agent-dev` on v2 | Force the fallback once during the local `adw e2e` run; fix it if v2 does not understand it | user |
| 3 | Verification | runtime-smoke EACCES on temp-dir cleanup | Run against the old image `ai-dev-workflow:2026.10.30` first; pre-existing → separate PR, otherwise debug here | user |
| 4 | Verification | Derived node/dotnet images | Rebuild and run their verify scripts before merging | user |
| 5 | Logins | OpenCode 1 support | None. Remove OpenCode 1 from all code and docs (auth.json conversion, v1 migration notes, v1 metrics fallback, 1.x baseline note). Start fresh on OpenCode 2 with new credentials | user |
| 6 | Logins | Harbor login source | An `opencode auth export` file, set up manually before the run, imported as is | user |
| 7 | Logins | `adw e2e` login source | `adw e2e` tells the user which commands to run (login / export) and what it needs, then uses the result | user |
| 8 | Logins | Credential scrub of copied `opencode.db` | Keep as is (delete rows from `credential`, `account`, `control_account`, VACUUM; warn on failure) | user |
| 9 | Metrics | `superpowersActive` on OpenCode | Means "the trial loaded a superpowers skill", not "skill catalog registered" | user |
| 10 | Metrics | Code Mode MCP counting | Keep parsing `tools.<server>.<tool>(` in `execute` calls | user |
| 11 | Image | Lockfile old-npm `libc` check | Remove the check and the OpenCode exemption; `sync` always uses the base image's npm | user |
| 12 | Image | Prune `@opencode/cli-linux-*` after install | Keep (4.6 → 3.85 GB) | user |
| 13 | Release | Version | Minor, 0.30.0; bumped in the release step, not in this PR | user |
| 14 | Release | OpenCode agent format in `agent-src/README.md` | Verify OpenCode 2's agent format and update docs (and renderer if it differs) | user |
| 15 | Release | Commit / PR | After the rework and the e2e runs | user |
| 16 | FYI | `launch-agent.mjs` config shape | Switch to the native v2 shape (`mcp.servers`, `plugins`) with updated tests | user |
| 17 | FYI | Spike image `adw-oc2-spike:latest` | Delete after the e2e runs | user |

## Follow-up work
- [ ] Remove OpenCode 1 support: `openCodeCredentials` auth.json converter, `makeOpenCodeV1Trial` and the v1 metrics fallback, README "Upgrading to v0.30.0" note, auth.json mentions in `docker/README.md` / `docs/adw-e2e/README.md`, 1.x baseline note in `.claude/skills/e2e-run/SKILL.md` — P1; `e2e/lib/{secrets,metrics}.mjs`, fixtures, tests, docs — #5
- [ ] Harbor: take the login from an `opencode auth export` file (config key + docs for the manual setup) — P1; `e2e/agents/opencode_subscription.py`, `e2e/lib/secrets.mjs`, `docs/adw-e2e/README.md` — depends on #5
- [ ] `adw e2e`: detect a missing OpenCode login and print the commands to run and the information needed — P1; `e2e/local/{cli,setup,session}.mjs` — depends on #5
- [ ] `superpowersActive` on OpenCode = a superpowers skill was loaded; decide whether Claude Code/Codex should use the same definition — P2; `e2e/lib/metrics.mjs` + tests — #9
- [ ] Remove `muslWithoutLibc` and its exemption/tests — P2; `docker/tools/inventory.mjs`, `docker/tests/inventory.test.mjs` — #11
- [ ] `launch-agent.mjs`: emit the v2 config shape; adapt `verify-agent-config.sh` if needed — P2; `docker/launch-agent.mjs`, tests — #16
- [ ] Verify OpenCode 2 agent format; update `agent-src/README.md` (and renderer) — P2 — #14
- [ ] runtime-smoke EACCES: compare with old image — P2; `docker/tests/runtime-smoke.mjs` — #3
- [ ] Rebuild image + derived node/dotnet images, run verify scripts — P1 — depends on all code changes above
- [ ] E2E: Harbor opencode (both tasks), local `adw e2e` opencode with forced fallback, claude-code + codex spot-check — P1 — depends on rebuild — #1, #2
- [ ] Commit, open PR with e2e results — after the e2e runs — #15
- [ ] Delete `adw-oc2-spike:latest` — after the e2e runs — #17

## Deferred
- Version bump to 0.30.0 — in the release step after merge.
