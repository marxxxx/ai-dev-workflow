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

/** Compose project-name slug: lowercase, runs of chars outside [a-z0-9_-] → '-', trimmed. */
export function composeSlug(name) {
  const slug = String(name).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'project';
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
export function renderContainerFiles({ name, stack, backend, giteaLogin = '' }) {
  const slug = composeSlug(name);
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
