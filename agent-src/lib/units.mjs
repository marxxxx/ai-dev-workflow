// Canonical unit loading: agent-src/{agents,skills}/<name>/ → { kind, name, body, manifest, overlays }.

import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR } from './constants.mjs';
import { normalizeLF } from './serialize.mjs';

export function loadUnits() {
  const units = [];
  for (const type of ['agents', 'skills']) {
    const dir = path.join(SRC_DIR, type);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      const unitDir = path.join(dir, name);
      if (!fs.statSync(unitDir).isDirectory()) continue;
      const bodyPath = path.join(unitDir, 'body.md');
      const manifestPath = path.join(unitDir, 'manifest.json');
      if (!fs.existsSync(bodyPath) || !fs.existsSync(manifestPath)) {
        throw new Error(`Unit ${type}/${name} is missing body.md or manifest.json`);
      }
      const body = normalizeLF(fs.readFileSync(bodyPath, 'utf8'));
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const overlays = {};
      const overlayDir = path.join(unitDir, 'overlays');
      if (fs.existsSync(overlayDir)) {
        for (const f of fs.readdirSync(overlayDir)) {
          if (f.endsWith('.md')) {
            overlays[f.replace(/\.md$/, '')] = normalizeLF(fs.readFileSync(path.join(overlayDir, f), 'utf8'));
          }
        }
      }
      units.push({ kind: type === 'agents' ? 'agent' : 'skill', name, unitDir, body, manifest, overlays });
    }
  }
  return units;
}
