// Acceptance criteria of a task: the `| AC<n> | <text> |` rows of its acceptance-criteria.md.
import { readFileSync } from 'node:fs';

export function parseCriteria(markdown) {
  const criteria = [...markdown.matchAll(/^\|\s*(AC\d+)\s*\|\s*(.+?)\s*\|\s*$/gm)].map(([, id, text]) => ({ id, text }));
  if (!criteria.length) throw new Error('no acceptance criteria found');
  const ids = criteria.map((c) => c.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`duplicate acceptance criterion ${dup}`);
  return criteria;
}

export function loadCriteria(file) {
  return parseCriteria(readFileSync(file, 'utf8'));
}
