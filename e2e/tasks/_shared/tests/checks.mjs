// agent-dev contract checks, evaluated from the Gitea state after a trial. Never asserts on
// superpowers internals.
const starts = (b, t) => b.trimStart().startsWith(`## ${t}`);
// A spec or plan path as superpowers writes them; agent-dev never names one on the ticket.
const DOC_PATH = /\b(?:specs|plans)\/[\w.-]+\.md\b/;
const PLAN_IN_DIFF = /^diff --git a\/\S*\bplans\/\S+\.md /m;

// The added lines of every file in `diff` whose path matches `fileRe`, without the leading `+`.
export function addedText(diff, fileRe) {
  return diff.split(/^diff --git /m).filter((chunk) => fileRe.test(/^a\/(\S+)/.exec(chunk)?.[1] ?? ''))
    .flatMap((chunk) => chunk.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)))
    .join('\n');
}

export function evaluateContract({ issue, comments, pulls, prDiff, appListening }) {
  const bodies = comments.map((c) => c.body);
  const status = issue.labels.map((l) => l.name).filter((n) => n.startsWith('status:'));
  const spec = bodies.filter((b) => starts(b, 'Approved Spec')).join('\n');
  const summary = bodies.find((b) => starts(b, 'Implementation Summary')) ?? '';
  const pr = pulls.length === 1 ? pulls[0] : null;
  const specFile = addedText(prDiff, /\bspecs\/[\w.-]+\.md$/);
  const ok = (v) => (v ? 1 : 0);
  return {
    ticket_open: ok(issue.state === 'open'),
    ticket_review: ok(status.length === 1 && status[0] === 'status:review'),
    spec_comment: ok(spec !== ''),
    spec_comment_complete: ok(!/\$\(|\$\{/.test(spec)),
    spec_comment_condensed: ok(!bodies.some((b) => DOC_PATH.test(b)) && (specFile === '' || spec.length < specFile.length)),
    summary_comment: ok(summary !== '' && /end[- ]to[- ]end|ende[- ]zu[- ]ende|e2e/i.test(summary)),
    cost_comment: ok(bodies.some((b) => starts(b, 'Cost Summary'))),
    only_allowed_comments: ok(bodies.every((b) => /^## (Approved Spec|Implementation Summary|Cost Summary)/.test(b.trimStart()))),
    pr_draft: ok(pr && /^WIP:/i.test(pr.title) && pr.base?.ref === 'main' && !pr.merged),
    branch_naming: ok(/^1_[a-z0-9_]+$/.test(pr?.head?.ref ?? '')),
    pr_title_naming: ok(/^WIP:\s*1: \S/.test(pr?.title ?? '')),
    app_stopped: ok(!appListening),
    no_screenshots_in_repo: ok(!/^diff --git a\/\S+\.(png|jpe?g|webp|gif) /mi.test(prDiff)),
    plan_discarded: ok(!PLAN_IN_DIFF.test(prDiff)),
  };
}

// The task's own test command (task.toml [verifier.env] TEST_COMMAND): no stack is assumed here.
export function testCommand(env) {
  const command = env.TEST_COMMAND?.trim();
  if (!command) throw new Error('TEST_COMMAND is not set (task.toml [verifier.env])');
  return command;
}

// Runs the agent's own tests on the PR head; run(cwd, cmd, args) returns { ok, out }.
export function runOwnTests(dir, command, run) {
  const r = run(dir, 'bash', ['-c', command]);
  return { pass: r.ok ? 1 : 0, out: r.out };
}
