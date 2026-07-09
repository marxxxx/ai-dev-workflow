// Canonical unit loading: agent-src/{agents,skills}/<name>/ → { kind, name, body, manifest, overlays }.
//
// A project may customize any shipped unit from a committed, project-owned agent-custom/ dir that
// mirrors this layout (agent-custom/{agents,skills}/<name>/). Two knobs, both generation *inputs*:
//   - body.md   → full override; replaces the package body for that unit (escape hatch).
//   - append.md → additive fragment appended after the package body + platform overlay (safe default).
// Absence of the dir is a no-op, so behavior is identical to package-only when a project opts out.

import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR, CUSTOM_DIR } from './constants.mjs';
import { normalizeLF } from './serialize.mjs';

export function loadUnits(projectRoot) {
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
      let body = normalizeLF(fs.readFileSync(bodyPath, 'utf8'));
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

      // Overlay project customizations from agent-custom/<type>/<name>/ if present.
      let append;
      let customized = false;
      if (projectRoot) {
        const customDir = path.join(projectRoot, CUSTOM_DIR, type, name);
        const overridePath = path.join(customDir, 'body.md');
        const appendPath = path.join(customDir, 'append.md');
        if (fs.existsSync(overridePath)) {
          body = normalizeLF(fs.readFileSync(overridePath, 'utf8'));
          customized = true;
        }
        if (fs.existsSync(appendPath)) {
          append = normalizeLF(fs.readFileSync(appendPath, 'utf8'));
          customized = true;
        }
      }

      units.push({ kind: type === 'agents' ? 'agent' : 'skill', name, unitDir, body, manifest, overlays, append, customized });
    }
  }
  return units;
}
