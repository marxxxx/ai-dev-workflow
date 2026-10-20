// Read-only ticket import: fetch a ticket's title and body from the project's tracker. Persisting is the CLI's job.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const HINT = 'Pass the ticket text with --ticket-file <file> instead.';
const defaultExec = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
// Block tags become line breaks, list items bullets, other tags vanish; entities are decoded in one pass.
export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<(br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? m)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const fail = (backend, what, cause) =>
  new Error(`ticket import (${backend}) failed: ${what}${cause ? `: ${cause}` : ''}. ${HINT}`);

// Run a reader command; any failure or bad JSON names the backend and the command.
function runJson(backend, exec, cmd, args) {
  const shown = [cmd, ...args].join(' ');
  try {
    return JSON.parse(exec(cmd, args));
  } catch (e) {
    throw fail(backend, shown, e.message);
  }
}

function fromTicketFile(text) {
  const m = /^# (.*)\n?([\s\S]*)$/m.exec(text);
  return m ? { title: m[1].trim(), body: m[2].trim() } : { title: '', body: text.trim() };
}

function fromFileBackend(root, ticket, project) {
  const dir = resolve(root, project.ticketing?.file?.dir ?? '.tickets/issues');
  const name = existsSync(dir) && readdirSync(dir).find((f) => f.startsWith(`${ticket}_`) && f.endsWith('.md'));
  if (!name) throw fail('file', `no ${join(dir, `${ticket}_*.md`)}`);
  const text = readFileSync(join(dir, name), 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  const title = /^title:\s*(.*)$/m.exec(m?.[1] ?? '')?.[1].trim().replace(/^(["'])(.*)\1$/, '$2') ?? '';
  const body = (m?.[2] ?? text).split('\n---\n## ')[0].trim();
  return { title, body };
}

export function importTicket({ root, ticket, project, exec = defaultExec, ticketFile }) {
  const backend = project?.ticketing?.backend;
  let result;
  if (ticketFile != null) result = fromTicketFile(ticketFile);
  else if (backend === 'github') {
    const j = runJson(backend, exec, 'gh', ['issue', 'view', String(ticket), '--repo', project.repository.slug, '--json', 'title,body']);
    result = { title: j.title ?? '', body: j.body ?? '' };
  } else if (backend === 'gitea') {
    const j = runJson(backend, exec, 'tea', ['api', '--login', project.ticketing.gitea.login, `repos/${project.repository.slug}/issues/${ticket}`]);
    result = { title: j.title ?? '', body: j.body ?? '' };
  } else if (backend === 'azure-devops') {
    const org = project.ticketing.azureDevOps.organization;
    const f = runJson(backend, exec, 'az', ['boards', 'work-item', 'show', '--id', String(ticket), '--org', `https://dev.azure.com/${org}`, '--output', 'json']).fields ?? {};
    const criteria = htmlToText(f['Microsoft.VSTS.Common.AcceptanceCriteria']);
    const body = [htmlToText(f['System.Description']), criteria && `Acceptance criteria\n\n${criteria}`].filter(Boolean).join('\n\n');
    result = { title: htmlToText(f['System.Title']), body };
  } else if (backend === 'file') result = fromFileBackend(root, ticket, project);
  else throw fail(String(backend), 'unknown ticketing backend');
  if (!result.title) throw fail(backend ?? 'ticket-file', 'ticket has no title');
  return result;
}
