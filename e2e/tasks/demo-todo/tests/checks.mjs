// agent-dev contract checks, evaluated from the Gitea state after a trial. Never asserts on
// superpowers internals.
const starts = (b, t) => b.trimStart().startsWith(`## ${t}`);

export function evaluateContract({ issue, comments, pulls, prDiff, appListening }) {
  const bodies = comments.map((c) => c.body);
  const status = issue.labels.map((l) => l.name).filter((n) => n.startsWith('status:'));
  const spec = bodies.filter((b) => starts(b, 'Approved Spec')).join('\n');
  const summary = bodies.find((b) => starts(b, 'Implementation Summary')) ?? '';
  const pr = pulls.length === 1 ? pulls[0] : null;
  const ok = (v) => (v ? 1 : 0);
  return {
    ticket_open: ok(issue.state === 'open'),
    ticket_review: ok(status.length === 1 && status[0] === 'status:review'),
    spec_comment: ok(spec !== ''),
    spec_comment_complete: ok(spec.length >= 400 && !/\$\(|\$\{/.test(spec)),
    summary_comment: ok(summary !== '' && /end[- ]to[- ]end|e2e/i.test(summary)),
    cost_comment: ok(bodies.some((b) => starts(b, 'Cost Summary'))),
    only_allowed_comments: ok(bodies.every((b) => /^## (Approved Spec|Implementation Summary|Cost Summary)/.test(b.trimStart()))),
    pr_draft: ok(pr && /^WIP:/i.test(pr.title) && pr.base?.ref === 'main' && !pr.merged),
    branch_naming: ok(/^1_[a-z0-9_]+$/.test(pr?.head?.ref ?? '')),
    pr_title_naming: ok(/^WIP:\s*1: \S/.test(pr?.title ?? '')),
    app_stopped: ok(!appListening),
    no_screenshots_in_repo: ok(!/^diff --git a\/\S+\.(png|jpe?g|webp|gif) /mi.test(prDiff)),
  };
}
