// Dev-container setup written by `init`: stack detection, the Compose project slug and the
// rendering of the project-owned container files from agent-src/container/. These files are
// written once and then belong to the project; the generator pipeline never renders or checks them.
//
// Templates use `@@KEY@@` placeholders (plain string replacement, separate from `{{token}}`).

import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR } from './constants.mjs';

const TEMPLATE_DIR = path.join(SRC_DIR, 'container');

export const STACKS = ['node', 'dotnet', 'generic'];

const IMAGES = {
  node: 'marxx/ai-dev-workflow:node-latest',
  dotnet: 'marxx/ai-dev-workflow:dotnet-latest',
  generic: 'marxx/ai-dev-workflow:latest',
};

// Replacements for the two line-sized placeholders in compose.ai-dev.yml (node only).
const NODE_MOUNT = [
  '      # Container-only node_modules: masks the host install (see the note below).',
  '      - type: volume',
  '        source: deps-node-modules',
  '        target: /workspace/node_modules',
].join('\n');
const NODE_VOLUME = '  deps-node-modules:';

/**
 * Default stack for the project root. .NET wins when both are present: its image is what makes
 * the C# language server work, and it still builds a JS frontend.
 */
export function detectStack(projectRoot) {
  const entries = fs.readdirSync(projectRoot);
  if (entries.some((e) => /\.(sln|slnx|csproj)$/i.test(e))) return 'dotnet';
  if (entries.includes('package.json')) return 'node';
  return 'generic';
}

/**
 * Compose project-name slug: lowercase, runs of chars outside [a-z0-9_-] → '-', trimmed so it
 * starts with [a-z0-9] as Compose requires. The first candidate that leaves anything wins; the
 * shared 'project' default is the last resort, since projects with the same slug share a home volume.
 */
export function composeSlug(...candidates) {
  for (const name of candidates) {
    const slug = String(name).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|-+$/g, '');
    if (slug) return slug;
  }
  return 'project';
}

const readTemplate = (rel) => fs.readFileSync(path.join(TEMPLATE_DIR, rel), 'utf8');

/** Replace `@@KEY@@` placeholders; a placeholder alone on its line is dropped with the line when empty. */
function fill(text, values) {
  return text
    .replace(/^@@([A-Z_]+)@@\n/gm, (m, key) => (key in values ? (values[key] ? `${values[key]}\n` : '') : m))
    .replace(/@@([A-Z_]+)@@/g, (m, key) => (key in values ? values[key] : m));
}

/**
 * The container files for a project, relative to its root, in write order. Throws when a
 * template still carries a placeholder after rendering.
 */
export function renderContainerFiles({ name, stack, backend, giteaLogin = '', projectDir = '' }) {
  const slug = composeSlug(name, path.basename(projectDir));
  const node = stack === 'node';
  const values = {
    SLUG: slug,
    IMAGE: IMAGES[stack],
    NODE_MOUNT: node ? NODE_MOUNT : '',
    NODE_VOLUME: node ? NODE_VOLUME : '',
    GITEA_LOGIN: giteaLogin,
  };
  values.TICKETING = fill(readTemplate(`ticketing/${backend}.md`), values).trimEnd();

  const files = [
    { path: 'compose.ai-dev.yml' },
    { path: 'compose.ai-dev.certs.yml' },
    { path: 'compose.ai-dev.dind.yml' },
    { path: 'compose.ai-dev.dind-certs.yml' },
    { path: 'ai-dev.sh', mode: 0o755 },
    { path: 'ai-dev.ps1' },
    { path: 'AI-DEV.md' },
  ].map((f) => ({ ...f, content: fill(readTemplate(f.path), values) }));

  for (const f of files) {
    const left = f.content.match(/@@[A-Z_]+@@/);
    if (left) throw new Error(`container template: unresolved placeholder ${left[0]} in ${f.path}`);
  }
  return files;
}

/**
 * Append `line` to `file` unless a (trimmed) line already equals it; creates the file when
 * missing. Returns whether the file changed.
 */
export function ensureLine(file, line) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (current.split(/\r?\n/).some((l) => l.trim() === line)) return false;
  const sep = current && !current.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(file, `${current}${sep}${line}\n`);
  return true;
}

/**
 * Write the container files into `projectRoot`, each only when missing, then make sure
 * `.env.ai-dev` is git-ignored and `ai-dev.sh` keeps LF endings. Returns the relative paths
 * written and those left untouched.
 */
export function writeContainerFiles(projectRoot, opts) {
  const written = [];
  const skipped = [];
  for (const f of renderContainerFiles({ ...opts, projectDir: projectRoot })) {
    const dest = path.join(projectRoot, f.path);
    if (fs.existsSync(dest)) { skipped.push(f.path); continue; }
    fs.writeFileSync(dest, f.content);
    if (f.mode) fs.chmodSync(dest, f.mode);
    written.push(f.path);
  }
  if (ensureLine(path.join(projectRoot, '.gitignore'), '.env.ai-dev')) written.push('.gitignore');
  if (ensureLine(path.join(projectRoot, '.gitattributes'), 'ai-dev.sh text eol=lf')) written.push('.gitattributes');
  return { written, skipped };
}

// One-line ticketing login per backend for the next-steps printout; `file` has none.
const TICKETING_LOGIN = {
  github: './ai-dev.sh gh auth login && ./ai-dev.sh gh auth setup-git',
  gitea: './ai-dev.sh tea login add  (flags: AI-DEV.md, section 3)',
  'azure-devops': './ai-dev.sh az login --use-device-code --allow-no-subscriptions',
};

/** The numbered next steps printed by `init` after a container setup, specific to `backend`. */
export function nextSteps({ backend, version }) {
  const steps = [
    `npx @strobl_dev/adw@${version} generate  (renders .claude/.codex/.opencode/.agents)`,
    './ai-dev.sh claude  (log in once; or: ./ai-dev.sh codex login --device-auth / ./ai-dev.sh opencode auth login)',
    TICKETING_LOGIN[backend],
    'Create AGENTS.md: ./ai-dev.sh claude, then /init (add an "End-to-end testing" section for agent-dev\'s e2e check)',
    'Commit ai-project.json, the generated dirs and the container files.',
    'Start working: ./ai-dev.sh claude --dangerously-skip-permissions, then ask for agent-dev on a ticket.',
  ].filter(Boolean);
  return [
    'Next steps:',
    ...steps.map((s, i) => `  ${i + 1}. ${s}`),
    '  Details: AI-DEV.md  (PowerShell: .\\ai-dev.ps1 instead of ./ai-dev.sh)',
  ].join('\n');
}
