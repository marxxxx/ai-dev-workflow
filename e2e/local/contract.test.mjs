import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_CONTRACT_CHECKS, evaluateLocalContract, appPortFromAgentsMd, hasE2eSection } from './contract.mjs';

const TICKET = [
  '---', 'title: "Add due dates"', 'status: review', '---', '', 'Scope.',
  '', '---', '## Approved Spec', '`docs/spec.md`',
  '', '---', '## Implementation Summary', 'End-to-end check passed.',
  '', '---', '## Cost Summary', '12k tokens', '',
].join('\n');
const base = () => ({ ticket: 3, ticketFile: TICKET, branches: ['3_add_due_dates'], diff: 'diff --git a/src/a.js b/src/a.js\n', appListening: false });

test('a complete ticket file passes every check', () => {
  const r = evaluateLocalContract(base());
  assert.deepEqual(Object.keys(r), LOCAL_CONTRACT_CHECKS);
  for (const k of LOCAL_CONTRACT_CHECKS) assert.equal(r[k], 1, k);
});

test('an extra section, wrong status or missing sections fail', () => {
  assert.equal(evaluateLocalContract({ ...base(), ticketFile: TICKET + '\n---\n## Notes\nx\n' }).only_allowed_sections, 0);
  const r = evaluateLocalContract({ ...base(), ticketFile: TICKET.replace('status: review', 'status: in-progress') });
  assert.equal(r.ticket_review, 0);
  const none = evaluateLocalContract({ ...base(), ticketFile: '---\nstatus: review\n---\n\nbody\n' });
  assert.equal(none.spec_section, 0);
  assert.equal(none.summary_section, 0);
  assert.equal(none.cost_section, 0);
});

test('the summary must mention end-to-end testing', () => {
  const t = TICKET.replace('End-to-end check passed.', 'Done.');
  assert.equal(evaluateLocalContract({ ...base(), ticketFile: t }).summary_section, 0);
});

test('branches: exactly one, named <n>_slug', () => {
  assert.equal(evaluateLocalContract({ ...base(), branches: ['3_a', '3_b'] }).branch_pushed, 0);
  assert.equal(evaluateLocalContract({ ...base(), branches: [] }).branch_pushed, 0);
  assert.equal(evaluateLocalContract({ ...base(), branches: ['feature-x'] }).branch_naming, 0);
  assert.equal(evaluateLocalContract({ ...base(), branches: ['4_x'] }).branch_naming, 0);
});

test('app_stopped is null when unknown; screenshots in the diff fail', () => {
  assert.equal(evaluateLocalContract({ ...base(), appListening: null }).app_stopped, null);
  assert.equal(evaluateLocalContract({ ...base(), appListening: true }).app_stopped, 0);
  assert.equal(evaluateLocalContract({ ...base(), diff: 'diff --git a/shot.PNG b/shot.PNG\n' }).no_screenshots_in_repo, 0);
});

const MD = '# P\n\nSee http://localhost:1111 here.\n\n## End-to-end testing\n\nStart: `x`\nApp at http://127.0.0.1:5173/ ok.\n\n## Other\nhttp://localhost:9999\n';

test('appPortFromAgentsMd reads the port inside the section only', () => {
  assert.equal(appPortFromAgentsMd(MD), 5173);
  assert.equal(appPortFromAgentsMd('## End-to-end testing\nhttp://0.0.0.0:80\n'), 80);
  assert.equal(appPortFromAgentsMd('# P\n\nhttp://localhost:1111\n'), null);
  assert.equal(appPortFromAgentsMd('## End-to-end testing\nno url\n## Other\nhttp://localhost:9999\n'), null);
});

test('hasE2eSection', () => {
  assert.equal(hasE2eSection(MD), true);
  assert.equal(hasE2eSection('# P\n## Other\n'), false);
});
