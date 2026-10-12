import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export function readJsonl(file) {
  const out = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* partial or foreign line */ }
  }
  return out;
}

export function walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries.flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.isFile() ? [p] : [];
  });
}

export function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export function sha256Dir(dir, { exclude } = {}) {
  const hash = createHash('sha256');
  for (const file of walk(dir).map((f) => path.relative(dir, f)).sort()) {
    if (exclude?.test(file)) continue;
    hash.update(file).update('\0').update(readFileSync(path.join(dir, file))).update('\0');
  }
  return hash.digest('hex');
}
