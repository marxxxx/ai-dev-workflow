// File-backend agent-dev contract checks. Never asserts on superpowers internals.
export const LOCAL_CONTRACT_CHECKS = ['ticket_review', 'spec_section', 'summary_section', 'cost_section', 'only_allowed_sections', 'branch_pushed', 'branch_naming', 'pr_draft', 'pr_title_naming', 'app_stopped', 'no_screenshots_in_repo'];

const ALLOWED = ['Approved Spec', 'Implementation Summary', 'Cost Summary'];

// Pure: `ticketFile` is the ticket file's TEXT (the CLI reads it), `ticket` its number. `prs` are the pull requests the
// e2e layer's fake gh/tea/az recorded (image/pr-cli.mjs); the last one of the pushed branch counts.
// Sections are the `\n---\n## <Title>` blocks agent-dev appends; the first chunk is frontmatter + body.
export function evaluateLocalContract({ ticket, ticketFile, branches, prs = [], diff, appListening }) {
  const sections = ticketFile.split('\n---\n## ').slice(1).map((s) => ({ title: s.split('\n')[0].trim(), text: s }));
  const body = (t) => sections.filter((s) => s.title === t).map((s) => s.text).join('\n');
  const status = /^status:\s*(\S+)\s*$/m.exec(ticketFile.split('\n---\n')[0])?.[1];
  const summary = body('Implementation Summary');
  const ok = (v) => (v ? 1 : 0);
  const pr = branches.length === 1 ? prs.filter((p) => p.branch === branches[0]).at(-1) : undefined;
  return {
    ticket_review: ok(status === 'review'),
    spec_section: ok(body('Approved Spec') !== ''),
    summary_section: ok(summary !== '' && /end[- ]to[- ]end|ende[- ]zu[- ]ende|e2e/i.test(summary)),
    cost_section: ok(body('Cost Summary') !== ''),
    only_allowed_sections: ok(sections.every((s) => ALLOWED.includes(s.title))),
    branch_pushed: ok(branches.length === 1),
    branch_naming: ok(branches.length === 1 && new RegExp(`^${ticket}_[a-z0-9_]+$`).test(branches[0])),
    pr_draft: ok(pr?.draft === true),
    pr_title_naming: ok(new RegExp(`^${ticket}: \\S`).test(pr?.title ?? '')),
    app_stopped: appListening === null ? null : ok(!appListening),
    no_screenshots_in_repo: ok(!/^diff --git a\/\S+\.(png|jpe?g|webp|gif) /mi.test(diff)),
  };
}

export const hasE2eSection = (markdown) => /^## End-to-end testing\s*$/mi.test(markdown);

// First local app URL's port inside the `## End-to-end testing` section (up to the next `## `).
export function appPortFromAgentsMd(markdown) {
  const start = /^## End-to-end testing\s*$/mi.exec(markdown);
  if (!start) return null;
  const rest = markdown.slice(start.index + start[0].length);
  const section = rest.split(/^## /m)[0];
  const m = /http:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/.exec(section);
  return m ? Number(m[1]) : null;
}
