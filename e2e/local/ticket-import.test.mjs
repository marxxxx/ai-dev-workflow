import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importTicket } from './ticket-import.mjs';

const project = (backend, extra = {}) => ({
  repository: { slug: 'acme/app' },
  ticketing: { backend, gitea: { login: 'me' }, file: { dir: '.tickets/issues' }, azureDevOps: { organization: 'org' }, ...extra },
});
const stub = (out) => { const calls = []; const exec = (cmd, args) => { calls.push([cmd, args]); return out; }; return { exec, calls }; };

test('github reads the issue with gh', () => {
  const { exec, calls } = stub(JSON.stringify({ title: 'T', body: 'B' }));
  assert.deepEqual(importTicket({ root: '/p', ticket: 5, project: project('github'), exec }), { title: 'T', body: 'B' });
  assert.deepEqual(calls, [['gh', ['issue', 'view', '5', '--repo', 'acme/app', '--json', 'title,body']]]);
});

test('gitea reads the issue with tea api', () => {
  const { exec, calls } = stub(JSON.stringify({ title: 'T', body: null }));
  assert.deepEqual(importTicket({ root: '/p', ticket: 5, project: project('gitea'), exec }), { title: 'T', body: '' });
  assert.deepEqual(calls, [['tea', ['api', '--login', 'me', 'repos/acme/app/issues/5']]]);
});

test('azure-devops strips HTML, decodes entities, appends acceptance criteria', () => {
  const fields = {
    'System.Title': 'T',
    'System.Description': '<div>a &amp; b</div><p>c&nbsp;&lt;d&gt;</p>',
    'Microsoft.VSTS.Common.AcceptanceCriteria': '<ul><li>x</li></ul>',
  };
  const { exec, calls } = stub(JSON.stringify({ fields }));
  const r = importTicket({ root: '/p', ticket: 9, project: project('azure-devops'), exec });
  assert.equal(r.title, 'T');
  assert.match(r.body, /^a & b/);
  assert.match(r.body, /c <d>/);
  assert.match(r.body, /Acceptance criteria\n\n- x$/);
  assert.deepEqual(calls, [['az', ['boards', 'work-item', 'show', '--id', '9', '--org', 'https://dev.azure.com/org', '--output', 'json']]]);
});

test('azure-devops without acceptance criteria', () => {
  const { exec } = stub(JSON.stringify({ fields: { 'System.Title': 'T', 'System.Description': '<div>a &amp; b</div>' } }));
  assert.deepEqual(importTicket({ root: '/p', ticket: 9, project: project('azure-devops'), exec }), { title: 'T', body: 'a & b' });
});

test('file backend reads frontmatter title and body up to the comment section', () => {
  const root = mkdtempSync(join(tmpdir(), 'adw-ti-'));
  mkdirSync(join(root, '.tickets/issues'), { recursive: true });
  writeFileSync(join(root, '.tickets/issues/3_add_x.md'), '---\ntitle: "Add x"\nstatus: new\n---\n\nDo it.\n\nMore.\n\n---\n## Spec\nignored\n');
  const r = importTicket({ root, ticket: 3, project: project('file'), exec: () => assert.fail('no exec') });
  assert.deepEqual(r, { title: 'Add x', body: 'Do it.\n\nMore.' });
});

test('file backend errors name --ticket-file when the ticket is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'adw-ti-'));
  assert.throws(() => importTicket({ root, ticket: 3, project: project('file') }), /--ticket-file/);
});

test('ticketFile wins over every backend', () => {
  const { exec, calls } = stub('{}');
  const r = importTicket({ root: '/p', ticket: 5, project: project('github'), exec, ticketFile: 'preamble\n# Hello\n\nbody\nmore\n' });
  assert.deepEqual(r, { title: 'Hello', body: 'body\nmore' });
  assert.equal(calls.length, 0);
});

test('unknown backend and empty title name --ticket-file', () => {
  assert.throws(() => importTicket({ root: '/p', ticket: 1, project: project('jira'), exec: () => '' }), /--ticket-file/);
  const { exec } = stub(JSON.stringify({ title: '', body: 'x' }));
  assert.throws(() => importTicket({ root: '/p', ticket: 1, project: project('github'), exec }), /github.*--ticket-file/s);
});

test('exec failure names backend, command and --ticket-file', () => {
  const exec = () => { throw new Error('boom'); };
  assert.throws(() => importTicket({ root: '/p', ticket: 1, project: project('gitea'), exec }), /gitea.*tea api --login me.*boom.*--ticket-file/s);
});
