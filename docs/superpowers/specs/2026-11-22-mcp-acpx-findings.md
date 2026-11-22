# acpx 0.22.0 findings (MCP session server spike)

Scope: what `acpx` 0.22.0 does for named sessions, config, output and exit codes. Feeds the argv builders of `docker/mcp/acpx.mjs` (Task 5).

## How this was established

- Installed `npm i --prefix <scratch> acpx@0.22.0`; read `--help` of every subcommand, the shipped `skills/acpx/SKILL.md`, and grepped `dist/*.js` (exit codes, config paths).
- **Ran** acpx against a **fake ACP agent** (a ~30-line Node script speaking ACP JSON-RPC over stdio: `initialize`, `session/new`, `session/resume`, `session/list`, `session/prompt`, `session/cancel`; it answers with its own pid and the prompts it has seen, and supports `FAIL...` and `SLOW...` prompts). All commands below were run with `HOME` pointing at a scratch directory so `~/.acpx` was isolated.
- **Not run against a real harness.** No login is available here (no `CLAUDE_CODE_OAUTH_TOKEN`/`OPENAI_API_KEY`, no `claude-agent-acp`/`codex-acp` installed). So what a real adapter does on `session/resume` (does it restore the model's conversation memory?) is **from reading, not running**: acpx sends `session/resume` with the stored ACP session id; whether claude-agent-acp / codex-acp / `opencode acp` restore the context is adapter behaviour. `e2e/local/session.mjs` already relies on multi-turn sessions within one live owner, but not on a restart of the owner. This is the one thing to verify with a real login (see Concerns).

Notation: `A` = `acpx`; `G` = global flags `--agent "<adapter command>" --approve-all --format quiet --ttl 0 --timeout <sec> --cwd <dir>`. Global flags go **before** the subcommand (`prompt --cwd` is "unknown option", exit 2).

## 1. Session lifecycle

State lives in `~/.acpx/` (`os.homedir()`): `sessions/<acpxRecordId>.json` (+ `.stream.ndjson`), `queues/<hash>.lock`, IPC socket `/tmp/acpx-<home-hash>/<session-hash>.sock`. No env var or flag moves it except `HOME`.

| Operation | Command | Observed |
|---|---|---|
| create (or reuse) | `A G sessions ensure -s <name>` | prints the acpx record id (uuid) on stdout, exit 0. Spawns the adapter, `session/new`, saves the record. Idempotent: a second `ensure -s two` printed the same id. Also finds a record from an **ancestor** dir (walks up to the git root), so a subdir resolves the parent's session. |
| create fresh | `A G sessions new -s <name>` | new id; **soft-closes the previous record of the same name/cwd/agent** (shows `[closed]` in the list). |
| prompt, from a later separate process | `A G prompt -s <name> "<text>"` (or `-f -` with the text on stdin) | works from a new process every time. With `ttl 0` the first prompt spawns a detached `acpx __queue-owner` + adapter that stay alive; later `acpx prompt` processes talk to it over the socket (same adapter pid, `turns=1,2,3...`). |
| resume after the owner/adapter died | `kill <queue-owner pid>`, then `A G prompt -s <name> "x"` | **verified**: a new adapter process started and acpx sent `session/initialize` then `session/resume` with the **same stored ACP session id**, then `session/prompt`. The acpx session record survives; the ACP session is resumed by id (adapter must support `resume`/`loadSession`; if the adapter says the session is gone, acpx creates a fresh one per its docs, not tested). |
| list | `A G sessions list --local` | one line per record: `<id>[ [closed]]<TAB><name><TAB><cwd><TAB><lastUsedAt>` with `--format text`; with `--format quiet` only the id. Without `--local` it calls ACP `session/list` on the **agent** (my fake did not answer it: `error: RUNTIME ...`); do not use that for server state. |
| show | `A G sessions show <name>` | metadata (id, ACP `sessionId`, cwd, name, pid, closed, ...). |
| cancel | `A G cancel -s <name>` | exit 0, prints `cancel requested` (or `nothing to cancel` when idle, also exit 0). Sends ACP `session/cancel` to the running turn; the session stays usable afterwards (verified: next prompt works on the same adapter). |
| close | `A G sessions close <name>` | exit 0; soft close (record kept with `closed: true`), owner **and adapter process exit** (verified process count). A prompt on a closed name then fails: exit 4 `NO_SESSION`. `ensure -s <name>` afterwards makes a **new** record/id (old stays `[closed]`; prune with `sessions prune`). Closing an unknown name: exit 1 `No named session ...`. |

**Scope key: agent command + absolute cwd + name** (docs and tested). Same name in another cwd: exit 4 NO_SESSION. Same cwd+name but a different `--agent` string: exit 4 NO_SESSION. So the exact adapter command (including `env X=Y ...` prefixes such as model) is part of the identity: **build it identically for ensure, prompt, cancel and close**, or acpx will not find the session. A prompt without `-s` uses the cwd default session (not what we want).

## 2. Configuration location

- Sources: global `~/.acpx/config.json` and project `<cwd>/.acpxrc.json` (project wins). `acpx config show` prints the resolved config and both paths. **No flag or env var selects another config file.**
- **No config file is required.** Everything the repo's `acpxConfig` puts in `.acpxrc.json` has a flag: `--agent "<command>"` (raw ACP agent command, one string), `--approve-all`, `--format quiet`, `--ttl 0`, `--timeout <sec>`. Verified end to end in a fresh git repo with no `.acpxrc.json`: `ensure`, `prompt`, ancestor lookup, `--cwd` from another directory all worked, and `git status` stayed clean (acpx wrote nothing into the cwd; all state is in `~/.acpx`). So `/workspace` stays git-clean without a `.gitignore` entry or `.git/info/exclude`.
- `--agent` takes a single command string (the fake was started via `node <path>`, no shell). For `env`-prefixed adapter commands (see `acpCommand` in `e2e/local/session.mjs`) pass the joined string; quoting inside it is acpx's parsing, check Task 5 with a value containing spaces (a `CODEX_CONFIG` JSON value does contain them). Alternative if quoting is awkward: a **global** `~/.acpx/config.json` with structured `agents.<name>.argv` (array, `{command,args}` is migrated), selected with `acpx <name> ...` or `defaultAgent`; it is outside `/workspace` too.
- Cosmetic: with `--agent` the not-found hint says `acpx codex sessions new ...`; ignore.

## 3. `acpx prompt` output and exit codes

`--format quiet` prints **only the final assistant text on stdout** (no `[done]` line, no tool noise, no trailing blank line beyond a newline). Without `--format quiet` and with no config the default is `text`, which adds a header on stderr and `[done] end_turn` on stdout: always pass `--format quiet`. Errors in quiet mode go to **stderr** as one line `[acpx] error: <CODE> ...`; stdout is empty for a failed turn (unless the agent already streamed text, see timeout).

| Case | Exit | stdout | stderr |
|---|---|---|---|
| success | 0 | final message text | empty |
| agent error (JSON-RPC error on `session/prompt`) | 1 | empty | `[acpx] error: RUNTIME QUEUE_RUNTIME_PROMPT_FAILED boom from agent`; session remains usable (next prompt ok) |
| cancelled turn (`acpx cancel` from another process) | **0** | the partial text streamed so far (`partial`) | empty |
| `--timeout N` exceeded | 3 | partial text so far | `[acpx] error: TIMEOUT QUEUE_RUNTIME_PROMPT_FAILED Timed out after 2000ms` |
| no such (named) session / closed session | 4 | empty | `[acpx] error: NO_SESSION ...` |
| usage error (bad flag) | 2 | empty | `[acpx] error: USAGE ...` |
| permission denied | 5 (from source, not run) | | |
| Ctrl+C / SIGINT | 130 (from source, not run) | | |

Exit codes from `ipc-*.js`: SUCCESS 0, ERROR 1, USAGE 2, TIMEOUT 3, NO_SESSION 4, PERMISSION_DENIED 5, INTERRUPTED 130.

**A cancelled turn is not distinguishable from success in quiet mode** (exit 0, partial text). The server must track "I called cancel for this turn" itself, or run `--format json` and read `result.stopReason == "cancelled"` from the NDJSON (verified: `{"id":2,"result":{"stopReason":"cancelled"}}`; json mode puts the ACP traffic on stdout and the `[acpx] session ...` banner on stderr). Recommended: quiet + server-side cancel flag.

## 4. Two named sessions in one cwd

Yes. `ensure -s one` and `ensure -s two` in the same cwd gave two records, two adapter processes, independent history (`turns` counted per session), and `close one` left `two` usable. Terminate-then-start with the same name works: `close <name>` then `ensure -s <name>` gives a fresh record (new id), and a not-yet-closed `sessions new -s <name>` soft-closes the old one itself.

## Gate (Step 4)

Passed on the fake agent: acpx **can** resume a named session from separate processes (live owner reuse, and `session/resume` by stored id after the owner died), and it **can** return a clean final message (`--format quiet`, stdout only). Design holds, subject to the real-adapter check below.

## Consequences for Task 5 (argv)

Common prefix `P = ["acpx", "--agent", <adapter command string>, "--approve-all", "--format", "quiet", "--ttl", "0", "--timeout", <sec>, "--cwd", <cwd>]` (identical for every call):

- ensure: `[...P, "sessions", "ensure", "-s", name]` (stdout = record id)
- prompt: `[...P, "prompt", "-s", name, "-f", "-"]` with the text on **stdin** (also avoids argv length/leading-dash problems); stdout = final text; map exit 1/3/4/2 to errors.
- cancel: `[...P, "cancel", "-s", name]`; the pending prompt exits 0, so the server marks the turn cancelled itself.
- close: `[...P, "sessions", "close", name]`; exit 1 if the name is unknown (treat as already closed).
- list state: use `sessions list --local --format text` only for diagnostics; keep the authoritative name list in the server.
- Run acpx with `HOME` = the agent home (`/home/dev`) so `~/.acpx` persists in the agent-home volume.

## Concerns

1. **Real adapter resume not run** (no login here): after an owner death or container restart, acpx relies on `session/resume`; verify once with `claude-agent-acp` that the context survives (`ensure`, prompt "remember 42", kill the queue-owner, prompt "what number"). Within a live owner (the normal case) memory is plainly kept.
2. **`--ttl 0` keeps a detached queue owner + adapter alive per session until `sessions close`**, surviving the `acpx prompt` process and the MCP server's own crash. The server must close sessions on shutdown and on terminate. A finite ttl (default 300 s) would instead recycle the adapter via `session/resume`, relying on concern 1.
3. `--agent` quoting for `env`-prefixed commands with spaces is untested against real adapters; fall back to a global `~/.acpx/config.json` `argv` array if quoting bites.
4. Cancelled == exit 0 (above). Timeout returns partial text on stdout together with exit 3: treat exit != 0 as failure and ignore stdout.
