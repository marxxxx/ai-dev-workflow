// Every module `adw e2e` imports must ship in the npm package (AGENTS.md Rule 2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Static + dynamic relative imports, followed transitively from `entry`.
function importClosure(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"](\.[^'"]+)['"]/g)) {
      queue.push(path.resolve(path.dirname(file), m[1]));
    }
  }
  return [...seen].map((f) => path.relative(ROOT, f).split(path.sep).join('/')).sort();
}

test('package.json files lists every module e2e/local/cli.mjs imports', () => {
  const { files } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const missing = importClosure(path.join(ROOT, 'e2e/local/cli.mjs')).filter((f) => !files.includes(f));
  assert.deepEqual(missing, []);
});

test('package.json files ships the runtime data e2e/local reads', () => {
  const { files } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(files.includes('e2e/local/defaults.json'));
  assert.ok(files.includes('agent-src/config/ai-project.template.json'));
  for (const f of ['e2e/local/image/Dockerfile', 'e2e/local/image/package.json', 'e2e/local/image/package-lock.json', 'e2e/local/image/pr-cli.mjs']) {
    assert.ok(files.includes(f), f);
  }
});
