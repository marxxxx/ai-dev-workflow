// Agentic E2E verifier: one claude -p run in a fresh task container exercises the PR head and
// judges it against the task's acceptance criteria only.
import { spawnSync } from 'node:child_process';
import { buildClaudeDockerArgs, callClaude, isInterrupt } from './claude.mjs';

export const VERIFIER_ALLOWED_TOOLS = 'Bash,Read,Grep,Glob,mcp__playwright';
export const VERIFIER_DENIED_TOOLS = 'Edit,Write,NotebookEdit,Task,WebFetch,WebSearch';
const PLAYWRIGHT_MCP = JSON.stringify({ mcpServers: { playwright: { command: 'playwright-mcp', args: ['--headless', '--browser', 'chromium', '--isolated'] } } });

export function buildVerifierPrompt({ criteria }) {
  return `You are an acceptance tester. A coding agent changed the application in your current directory (/workspace, a git checkout of its pull request; the base branch is origin/main). Decide for each acceptance criterion below whether the running application meets it.

How to work:
- Read the "End-to-end testing" section of AGENTS.md. It says how to start the app, how to check that it is ready, its base URL and how to stop it. Start the app exactly as described there.
- Create all test data yourself through the running app (its HTTP API or its pages).
- You may read the code and run \`git diff origin/main...HEAD\` only to learn how to exercise a feature: endpoints, parameters, field names, controls. Judge strictly by what the running app does, measured against the criteria, never by what the code, its comments or its tests claim.
- Check HTTP behaviour with curl. Check pages with the Playwright browser tools (browser_navigate, browser_snapshot, browser_click, ...); load or reload a page after creating its data.
- "Today" is the current date in UTC: run \`date -u +%F\`.
- A criterion passes only if you observed the behaviour yourself. If you cannot find a way to exercise it, it fails.
- Never change repository files, never commit, and never save screenshots inside the repository.
- Stop the app before you answer.
- Write each criterion's evidence first, then set "pass" from that evidence alone; never revise a verdict inside the evidence text.

Acceptance criteria:
${criteria.map((c) => `- ${c.id}: ${c.text}`).join('\n')}

Answer with JSON only, exactly this shape, with one entry per criterion id:
{"criteria": [{"id": "${criteria[0].id}", "evidence": "<the requests or page steps you ran and what you observed>", "pass": true}]}
`;
}

export function validateVerifierAnswer(answer, ids) {
  if (!Array.isArray(answer?.criteria)) throw new Error('verifier answer has no criteria array');
  const out = {};
  for (const c of answer.criteria) {
    if (!ids.includes(c?.id)) throw new Error(`verifier returned unknown criterion ${c?.id}`);
    if (out[c.id]) throw new Error(`verifier returned ${c.id} twice`);
    if (typeof c.pass !== 'boolean') throw new Error(`verifier criterion ${c.id} has no boolean pass`);
    out[c.id] = { pass: c.pass, evidence: String(c.evidence ?? '') };
  }
  const missing = ids.filter((id) => !out[id]);
  if (missing.length) throw new Error(`verifier criteria missing: ${missing.join(', ')}`);
  return out;
}

export function buildVerifierDockerArgs({ image, name, checkout, model, uid, gid }) {
  return buildClaudeDockerArgs({ image, name, checkout, model, uid, gid,
    claudeArgs: ['--mcp-config', PLAYWRIGHT_MCP, '--allowedTools', VERIFIER_ALLOWED_TOOLS, '--disallowedTools', VERIFIER_DENIED_TOOLS] });
}

export function runVerifier({ config, checkout, criteria, env = {}, image, name = `adw-verify-${process.pid}-${Date.now()}`,
  run = spawnSync, uid = process.getuid(), gid = process.getgid() }) {
  try {
    const answer = callClaude({ cmd: 'docker', args: buildVerifierDockerArgs({ image, name, checkout, model: config.verifier.model, uid, gid }),
      input: buildVerifierPrompt({ criteria }), env, timeoutMs: config.verifier.timeoutSec * 1000, label: 'verifier', run });
    return { criteria: validateVerifierAnswer(answer, criteria.map((c) => c.id)), error: null };
  } catch (err) {
    if (isInterrupt(err)) throw err;
    return { criteria: null, error: err.message };
  } finally {
    // A timeout kills only the docker client; the container would keep running.
    run('docker', ['rm', '-f', name], { encoding: 'utf8', stdio: 'ignore' });
  }
}
