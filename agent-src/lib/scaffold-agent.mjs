// Optional onboarding step: hand off to an installed coding-agent CLI (claude/codex/opencode)
// to flesh out the baseline AGENTS.md and the e2e up/down scripts for the concrete project.
// A baseline is always written before this runs, so a missing/failing CLI is non-fatal — the
// user is left with a usable starting point either way. Zero deps: node builtins only.

import { spawnSync } from 'node:child_process';

/**
 * How to invoke each coding-agent CLI headlessly. The prompt travels over stdin (`promptVia`),
 * so nothing project-specific ends up on argv — that keeps quoting trivial and lets us run under
 * a shell on Windows (for `.cmd` shim resolution) safely. Flags are version-sensitive; adjust
 * here if a CLI changes its non-interactive interface.
 */
export const AGENT_ADAPTERS = {
  claude: { bin: 'claude', args: ['-p', '--permission-mode', 'acceptEdits'], promptVia: 'stdin' },
  codex: { bin: 'codex', args: ['exec', '--full-auto'], promptVia: 'stdin' },
  opencode: { bin: 'opencode', args: ['run'], promptVia: 'stdin' },
};

/**
 * Build the instruction prompt handed to the chosen agent. Derives the script paths from the
 * project's e2e config and embeds the fixed e2e contract the qa-engineer depends on.
 */
export function buildScaffoldPrompt(config) {
  const up = config?.e2e?.up || 'scripts/e2e-up';
  const down = config?.e2e?.down || 'scripts/e2e-down';
  const logsDir = config?.e2e?.logsDir || '.e2e/logs';
  const name = config?.project?.name || 'this project';
  return [
    `You are scaffolding AI-workflow onboarding files for ${name}. Inspect this repository to`,
    `determine its tech stack, how it builds/runs/tests, and the port(s) and base URL the app`,
    `serves locally. Then edit these files in place, keeping changes minimal and leaving clear`,
    `TODO comments wherever you cannot confidently infer something:`,
    ``,
    `1. AGENTS.md — replace the TODO placeholders with real content: tech stack, ports & URLs,`,
    `   install/build/run/test commands, project conventions, and the test-locator attribute the`,
    `   e2e tests should use (an existing convention in the codebase if there is one).`,
    ``,
    `2. ${up} — implement the e2e "up" contract:`,
    `   - start backing services (db/cache/broker), apply migrations/seed, then start the app;`,
    `   - BLOCK until the app is actually reachable (poll it) — do not return early;`,
    `   - print one \`BASE_URL=<url>\` line per reachable app to stdout (the first is the primary URL);`,
    `   - write logs under ${logsDir}; exit 0 when ready, non-zero on any failure or readiness timeout.`,
    ``,
    `3. ${down} — idempotently tear down everything "up" started. Safe to run even if "up" failed`,
    `   partway.`,
    ``,
    `Do not change application code or its tests. Produce a working starting point, not a perfect`,
    `harness — a TODO the human can finish is fine where the environment is ambiguous.`,
  ].join('\n');
}

/**
 * Run the chosen coding agent to enhance the scaffolded files. `agent` is 'claude' | 'codex' |
 * 'opencode'. Streams the agent's output to the user. Never throws: an unknown agent, a missing
 * CLI (ENOENT), or a non-zero exit is reported and swallowed, since the baseline is already
 * written. `spawn` is injectable for tests. Returns the child's numeric status (or null).
 */
export function runScaffoldAgent(agent, { projectRoot, config, spawn = spawnSync } = {}) {
  const adapter = AGENT_ADAPTERS[agent];
  if (!adapter) {
    console.log(`Unknown coding agent "${agent}" — skipping scaffolding handoff.`);
    return null;
  }
  const prompt = buildScaffoldPrompt(config);
  console.log(`\nRunning ${adapter.bin} to flesh out AGENTS.md and the e2e scripts…`);
  const res = spawn(adapter.bin, adapter.args, {
    cwd: projectRoot,
    input: prompt,
    stdio: ['pipe', 'inherit', 'inherit'],
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (res.error) {
    const why = res.error.code === 'ENOENT' ? `\`${adapter.bin}\` was not found on PATH` : res.error.message;
    console.log(`Could not run ${adapter.bin}: ${why}. The baseline files are in place — edit them by hand or re-run with the CLI installed.`);
    return null;
  }
  if (res.status !== 0) {
    console.log(`${adapter.bin} exited with status ${res.status}. Review the baseline AGENTS.md and e2e scripts and finish them by hand if needed.`);
  }
  return res.status;
}
