// Upgrade from the ≤0.22 multi-agent workflow: delete the generated files of the units and includes
// 0.23 removed, and strip ai-project.json keys nothing reads anymore. `generate` only ever writes,
// so without this the old subagents and skills keep loading next to agent-dev.
//
// Only files carrying the generator's banner for that exact unit are deleted — a hand-written file
// that happens to share a name is kept. Project-owned leftovers (agent-custom/, scaffolded e2e
// scripts) are only reported.

import fs from 'node:fs';
import path from 'node:path';
import { CUSTOM_DIR } from './constants.mjs';
import { readJson } from './config.mjs';

export const OBSOLETE_UNITS = {
  agents: ['developer', 'code-reviewer', 'qa-engineer'],
  skills: ['dev-cycle', 'product-architect'],
};
export const OBSOLETE_INCLUDES = ['e2e-runtime', 'handoff'];

// Dotted ai-project.json paths: dropped by 0.23 (branchPattern, the review/QA states), older
// leftovers (itemNoun, e2e, app, handoff) and identity fields no rendered output uses anymore.
export const OBSOLETE_PROJECT_KEYS = [
  'project.slug',
  'project.serenaProject',
  'project.description',
  'repository.defaultBranch',
  'ticketing.itemNoun',
  'ticketing.azureDevOps.stateMapping.test',
  'ticketing.azureDevOps.stateMapping.failed',
  'ticketing.azureDevOps.stateMapping.acceptance-test',
  'git.branchPattern',
  'e2e',
  'app',
  'handoff',
];

// Scaffolded by v0.4–0.6 into the project; project-owned since.
const LEGACY_E2E_SCRIPTS = [path.join('scripts', 'e2e-up'), path.join('scripts', 'e2e-down')];

/** Every file ≤0.22 generated for a removed unit or include, with the banner source it carried. */
export function obsoleteOutputs() {
  const out = [];
  for (const name of OBSOLETE_UNITS.agents) {
    const source = `agent-src/agents/${name}`;
    out.push(
      { path: path.join('.claude', 'agents', `${name}.md`), source },
      { path: path.join('.codex', 'agents', `${name}.toml`), source },
      { path: path.join('.opencode', 'agents', `${name}.md`), source },
    );
  }
  for (const name of OBSOLETE_UNITS.skills) {
    const source = `agent-src/skills/${name}`;
    out.push(
      { path: path.join('.claude', 'skills', name, 'SKILL.md'), source },
      { path: path.join('.opencode', 'skills', name, 'SKILL.md'), source },
      { path: path.join('.agents', 'skills', name, 'SKILL.md'), source },
      { path: path.join('.agents', 'skills', name, 'agents', 'openai.yaml'), source },
    );
  }
  for (const name of OBSOLETE_INCLUDES) {
    out.push({ path: path.join('.agents', 'includes', `${name}.md`), source: `agent-src/includes/${name}.md` });
  }
  return out;
}

/** Unit dirs that only existed for removed skills, deepest first. */
function obsoleteUnitDirs() {
  return OBSOLETE_UNITS.skills.flatMap((name) => [
    path.join('.agents', 'skills', name, 'agents'),
    path.join('.agents', 'skills', name),
    path.join('.claude', 'skills', name),
    path.join('.opencode', 'skills', name),
  ]);
}

/** Whether `content` carries the generator banner for exactly `source` (plain or agent-custom). */
function hasBanner(content, source) {
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`DO NOT EDIT — generated from ${escaped}(;| \\+)`).test(content);
}

/**
 * Delete the obsolete generated files that carry their banner, then the unit dirs left empty.
 * Returns { deleted, kept } as project-relative paths; `kept` are same-named files adw did not write.
 */
export function removeObsoleteOutputs(projectRoot, { dryRun = false } = {}) {
  const deleted = [];
  const kept = [];
  for (const { path: rel, source } of obsoleteOutputs()) {
    const abs = path.join(projectRoot, rel);
    if (!fs.existsSync(abs)) continue;
    if (!hasBanner(fs.readFileSync(abs, 'utf8'), source)) {
      kept.push(rel);
      continue;
    }
    if (!dryRun) fs.rmSync(abs);
    deleted.push(rel);
  }
  if (!dryRun) {
    for (const rel of obsoleteUnitDirs()) {
      const abs = path.join(projectRoot, rel);
      if (fs.existsSync(abs) && fs.readdirSync(abs).length === 0) fs.rmdirSync(abs);
    }
  }
  return { deleted, kept };
}

/** Pure: a copy of `config` without OBSOLETE_PROJECT_KEYS, plus the dotted keys that were removed. */
export function pruneProjectConfig(config) {
  const copy = structuredClone(config);
  const removed = [];
  for (const key of OBSOLETE_PROJECT_KEYS) {
    const parts = key.split('.');
    const leaf = parts.pop();
    let parent = copy;
    for (const p of parts) parent = parent?.[p];
    if (parent && typeof parent === 'object' && Object.hasOwn(parent, leaf)) {
      delete parent[leaf];
      removed.push(key);
    }
  }
  return { config: copy, removed };
}

/** Strip obsolete keys from the project's ai-project.json; rewrites it only when something changed. */
export function cleanProjectConfig(projectRoot, { dryRun = false } = {}) {
  const file = path.join(projectRoot, 'ai-project.json');
  const project = readJson(file, 'ai-project.json', false);
  if (!project) return { removed: [] };
  const { config, removed } = pruneProjectConfig(project);
  if (removed.length > 0 && !dryRun) fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  return { removed };
}

/** Project-owned leftovers of the removed workflow: agent-custom/ dirs and scaffolded e2e scripts. */
export function findCustomLeftovers(projectRoot) {
  const candidates = [
    ...OBSOLETE_UNITS.agents.map((n) => path.join(CUSTOM_DIR, 'agents', n)),
    ...OBSOLETE_UNITS.skills.map((n) => path.join(CUSTOM_DIR, 'skills', n)),
    ...LEGACY_E2E_SCRIPTS,
  ];
  return candidates.filter((rel) => fs.existsSync(path.join(projectRoot, rel)));
}
