// Migration of the old root layout (ai-project.json, compose.ai-dev*.yml, ai-dev.sh, …) into .adw/.
// Moves are plain filesystem renames: content is never changed and nothing is ever overwritten —
// when the target exists, both stay and the pair is reported as a conflict.

import fs from 'node:fs';
import path from 'node:path';
import { ADW_DIR, COMPOSE_FILES, CUSTOM_DIR, ENV_FILE, LAUNCHERS, PROJECT_FILE, README_FILE } from './constants.mjs';
import { readJson } from './config.mjs';
import { ensureLine, renderContainerFiles, replaceLine } from './container.mjs';

export const LEGACY_MOVES = [
  ['ai-project.json', PROJECT_FILE],
  ['compose.ai-dev.yml', COMPOSE_FILES.base],
  ['compose.ai-dev.certs.yml', COMPOSE_FILES.certs],
  ['compose.ai-dev.dind.yml', COMPOSE_FILES.dind],
  ['compose.ai-dev.dind-certs.yml', COMPOSE_FILES.dindCerts],
  ['.env.ai-dev', ENV_FILE],
  ['agent-custom', CUSTOM_DIR],
];

// Rendered fresh from the current templates instead of moved: they were never customized.
export const LEGACY_REWRITES = [
  ['ai-dev.sh', LAUNCHERS.sh],
  ['ai-dev.ps1', LAUNCHERS.ps1],
  ['AI-DEV.md', README_FILE],
];

const OLD_ENV = '.env.ai-dev';
const abs = (root, rel) => path.join(root, rel);
const present = (root, rel) => fs.existsSync(abs(root, rel));

function hasLine(file, line) {
  return fs.existsSync(file) && fs.readFileSync(file, 'utf8').split(/\r?\n/).some((l) => l.trim() === line);
}

/** Existing old-layout paths, except .env.ai-dev (a teammate's local file stays until they upgrade). */
export function legacyLayoutPaths(projectRoot) {
  return [...LEGACY_MOVES, ...LEGACY_REWRITES].map(([from]) => from).filter((from) => from !== OLD_ENV && present(projectRoot, from));
}

export function assertCurrentLayout(projectRoot) {
  const found = legacyLayoutPaths(projectRoot);
  if (found.length) {
    throw new Error(`Old adw layout found: ${found.join(', ')}. Run adw's \`upgrade\` command to move them into .adw/.`);
  }
}

/**
 * Move/rewrite the old files into .adw/. With `dryRun` nothing is written; the result lists what
 * would happen. Returns { changes: [{from, to, kind}], conflicts: [{from, to}], edits: [string] }.
 */
export function migrateLayout(projectRoot, { dryRun = false } = {}) {
  const changes = [];
  const conflicts = [];
  const edits = [];
  const ensureAdw = () => { if (!dryRun) fs.mkdirSync(abs(projectRoot, ADW_DIR), { recursive: true }); };

  for (const [from, to] of LEGACY_MOVES) {
    if (!present(projectRoot, from)) continue;
    if (present(projectRoot, to)) { conflicts.push({ from, to }); continue; }
    ensureAdw();
    if (!dryRun) fs.renameSync(abs(projectRoot, from), abs(projectRoot, to));
    changes.push({ from, to, kind: 'move' });
  }

  // The files as they are now: after a real move at the new place, in a dry run (or on a
  // conflict) wherever they still are.
  const current = (to) => (present(projectRoot, to) ? to : LEGACY_MOVES.find(([, t]) => t === to)[0]);
  const project = readJson(abs(projectRoot, current(PROJECT_FILE)), 'project config', false) || {};
  const composePath = abs(projectRoot, current(COMPOSE_FILES.base));
  const composeText = fs.existsSync(composePath) && fs.statSync(composePath).isFile() ? fs.readFileSync(composePath, 'utf8') : '';
  const slug = /^name:\s*["']?(\S+?)-ai["']?\s*$/m.exec(composeText)?.[1];

  let rendered;
  for (const [from, to] of LEGACY_REWRITES) {
    if (!present(projectRoot, from)) continue;
    if (present(projectRoot, to)) { conflicts.push({ from, to }); continue; }
    rendered ??= renderContainerFiles({
      name: project.project?.name || '',
      stack: 'generic',
      backend: project.ticketing?.backend || 'file',
      giteaLogin: project.ticketing?.gitea?.login || '',
      projectDir: projectRoot,
      slug,
    });
    const file = rendered.find((f) => f.path === to);
    if (!dryRun) {
      fs.mkdirSync(path.dirname(abs(projectRoot, to)), { recursive: true });
      fs.writeFileSync(abs(projectRoot, to), file.content, file.mode ? { mode: file.mode } : undefined);
      fs.rmSync(abs(projectRoot, from), { force: true });
    }
    changes.push({ from, to, kind: 'rewrite' });
  }

  // Ignore files: never created, only edited when they exist.
  const gitignore = abs(projectRoot, '.gitignore');
  const movedEnv = changes.some((c) => c.from === OLD_ENV);
  if (fs.existsSync(gitignore) && (movedEnv || hasLine(gitignore, OLD_ENV)) && !hasLine(gitignore, ENV_FILE)) {
    if (dryRun || ensureLine(gitignore, ENV_FILE)) edits.push(`Added ${ENV_FILE} to .gitignore`);
  }
  const gitattributes = abs(projectRoot, '.gitattributes');
  const oldAttr = 'ai-dev.sh text eol=lf';
  if (hasLine(gitattributes, oldAttr) && (dryRun || replaceLine(gitattributes, oldAttr, `${LAUNCHERS.sh} text eol=lf`))) {
    edits.push('Replaced ai-dev.sh with adw.sh in .gitattributes');
  }
  return { changes, conflicts, edits };
}
