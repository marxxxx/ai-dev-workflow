// Dev-container setup written by `init`: stack detection, the Compose project slug and the
// rendering of the project-owned container files from agent-src/container/. These files are
// written once and then belong to the project; the generator pipeline never renders or checks them.
//
// Templates use `@@KEY@@` placeholders (plain string replacement, separate from `{{token}}`).

import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR, ADW_DIR, ENV_FILE, README_FILE, COMPOSE_FILES, LAUNCHERS } from './constants.mjs';

const TEMPLATE_DIR = path.join(SRC_DIR, 'container');

export const STACKS = ['node', 'dotnet', 'generic'];

const IMAGES = {
  node: 'marxx/ai-dev-workflow:node-latest',
  dotnet: 'marxx/ai-dev-workflow:dotnet-latest',
  generic: 'marxx/ai-dev-workflow:latest',
};

// Replacements for the two line-sized placeholders in compose.yml (node only).
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
 * The container files for a project, relative to its root, in write order. `slug` overrides the
 * Compose slug derived from `name` and the project directory; `mcp` adds the opt-in MCP server
 * overlay and its certs companion. Throws when a template still carries a placeholder after rendering.
 */
export function renderContainerFiles({ name, stack, backend, giteaLogin = '', projectDir = '', slug: givenSlug, mcp = false }) {
  const slug = givenSlug || composeSlug(name, path.basename(projectDir));
  const node = stack === 'node';
  const values = {
    SLUG: slug,
    IMAGE: IMAGES[stack],
    NODE_MOUNT: node ? NODE_MOUNT : '',
    NODE_VOLUME: node ? NODE_VOLUME : '',
    GITEA_LOGIN: giteaLogin,
  };
  values.TICKETING = fill(readTemplate(`ticketing/${backend}.md`), values).trimEnd();

  // Launchers stay at the project root; every other file lives in .adw/ under its template name.
  const files = [
    { path: COMPOSE_FILES.base },
    { path: COMPOSE_FILES.certs },
    { path: COMPOSE_FILES.dind },
    { path: COMPOSE_FILES.dindCerts },
    ...(mcp ? [{ path: COMPOSE_FILES.mcp }, { path: COMPOSE_FILES.mcpCerts }] : []),
    { path: LAUNCHERS.sh, mode: 0o755 },
    { path: LAUNCHERS.ps1 },
    { path: README_FILE },
  ].map((f) => ({ ...f, content: fill(readTemplate(path.posix.basename(f.path)), values) }));

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
 * Append `KEY=value` to the env file `file` unless it already assigns KEY (a value set by hand
 * always wins); creates the file when missing. Returns whether the file changed.
 */
export function setEnvVar(file, key, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const assigns = new RegExp(`^\\s*(export\\s+)?${key}\\s*=`);
  if (current.split(/\r?\n/).some((l) => assigns.test(l))) return false;
  const sep = current && !current.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(file, `${current}${sep}${key}=${value}\n`);
  return true;
}

/**
 * Replace the (trimmed) line `oldLine` of `file` with `newLine`, keeping the other lines and the
 * line endings. Returns false when the file is missing or has no such line.
 */
export function replaceLine(file, oldLine, newLine) {
  if (!fs.existsSync(file)) return false;
  const parts = fs.readFileSync(file, 'utf8').split(/(\r?\n)/); // content, separator, content, …
  let changed = false;
  for (let i = 0; i < parts.length; i += 2) {
    if (!changed && parts[i].trim() === oldLine) { parts[i] = newLine; changed = true; }
  }
  if (changed) fs.writeFileSync(file, parts.join(''));
  return changed;
}

/** Printed by `init` when the Docker daemon overlay is enabled. */
export const DIND_WARNING = [
  'WARNING: the Docker overlay (AGENT_DIND=1) reduces isolation.',
  '  It runs a privileged Docker daemon next to the agent, and every agent in the container can',
  '  reach its socket. That is root-equivalent: on Linux the agent can become root on the host; on',
  '  Windows/macOS it can become root in the Docker Desktop VM, which reaches your drives.',
  '  Enable it only where that is acceptable. Remove AGENT_DIND from .adw/.env to turn it off.',
].join('\n');

/** Printed by `init` when the MCP server is enabled. Never carries the token itself. */
export const MCP_NOTE = [
  `MCP server (${COMPOSE_FILES.mcp}): its token, ADW_MCP_TOKEN, is in ${ENV_FILE} (git-ignored).`,
  `  Start it with ./adw.sh mcp (PowerShell: .\\adw.ps1 mcp). Endpoint: http://localhost:8787/mcp`,
  `  (host address and port: ADW_MCP_BIND, ADW_MCP_PORT in ${ENV_FILE}). Clients send the token in the`,
  '  x-api-key header (or Authorization: Bearer).',
  `  ADW_MCP_BIND=0.0.0.0 in ${ENV_FILE} exposes it to the network: set ADW_MCP_TLS_CERT and`,
  '  ADW_MCP_TLS_KEY too. Agents it starts have no Docker daemon.',
].join('\n');

/**
 * Write the container files into `projectRoot`, each only when missing, then make sure
 * `.adw/.env` is git-ignored and `adw.sh` keeps LF endings. `opts.env` settings are added to
 * `.adw/.env` unless it already assigns them. Returns the relative paths written, those left
 * untouched and the setting keys kept as they were.
 */
export function writeContainerFiles(projectRoot, { env = {}, ...opts }) {
  const written = [];
  const skipped = [];
  const kept = [];
  fs.mkdirSync(path.join(projectRoot, ADW_DIR), { recursive: true });
  for (const f of renderContainerFiles({ ...opts, projectDir: projectRoot })) {
    const dest = path.join(projectRoot, f.path);
    if (fs.existsSync(dest)) { skipped.push(f.path); continue; }
    fs.writeFileSync(dest, f.content);
    if (f.mode) fs.chmodSync(dest, f.mode);
    written.push(f.path);
  }
  if (ensureLine(path.join(projectRoot, '.gitignore'), ENV_FILE)) written.push('.gitignore');
  if (ensureLine(path.join(projectRoot, '.gitattributes'), `${LAUNCHERS.sh} text eol=lf`)) written.push('.gitattributes');
  let envChanged = false;
  for (const [key, value] of Object.entries(env)) {
    if (setEnvVar(path.join(projectRoot, ENV_FILE), key, value)) envChanged = true;
    else kept.push(key);
  }
  if (envChanged) written.push(ENV_FILE);
  return { written, skipped, kept };
}

/**
 * Fixes the project-owned container files need and `upgrade` cannot apply: v0.29.0 and earlier
 * dropped all capabilities without keeping KILL in .adw/compose.yml, so the root init (tini)
 * cannot forward signals to the dev user's processes and stops the container on the first one
 * (a resize).
 */
export function containerWarnings(projectRoot) {
  return [killWarning(projectRoot), pullWarning(projectRoot), mcpLauncherWarning(projectRoot)].filter(Boolean);
}

// Launchers written before the MCP server have no `mcp` command, so they cannot start .adw/compose.mcp.yml.
function mcpLauncherWarning(projectRoot) {
  if (!fs.existsSync(path.join(projectRoot, COMPOSE_FILES.mcp))) return null;
  const old = Object.values(LAUNCHERS).filter((name) => {
    const file = path.join(projectRoot, name);
    return fs.existsSync(file) && !fs.readFileSync(file, 'utf8').includes(path.posix.basename(COMPOSE_FILES.mcp));
  });
  if (!old.length) return null;
  return `Note: ${old.join(', ')} ha${old.length === 1 ? 's' : 've'} no \`mcp\` command to start the MCP server of ${COMPOSE_FILES.mcp}. `
    + `To get it, delete ${old.join(' and ')} and run \`adw init\` (keep .adw/project.json, set up the dev container); it writes `
    + `the current launcher${old.length === 1 ? '' : 's'} and leaves every existing file untouched.`;
}

// .adw/compose.yml without comments, or null when there is none.
function composeYaml(projectRoot) {
  const file = path.join(projectRoot, COMPOSE_FILES.base);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n');
}

// v0.40.1 and earlier launchers only pulled ai-dev-workflow. A project image that .adw/compose.yml builds (build:)
// is in no registry: the pull fails on every start and the image never gets a newer base image.
const OLD_PULL = { [LAUNCHERS.sh]: /compose pull ai-dev-workflow/, [LAUNCHERS.ps1]: /'pull', 'ai-dev-workflow'/ };
function pullWarning(projectRoot) {
  const yaml = composeYaml(projectRoot);
  if (!yaml || !/^\s+build:/m.test(yaml)) return null;
  const old = Object.entries(OLD_PULL).filter(([name, pull]) => {
    const file = path.join(projectRoot, name);
    if (!fs.existsSync(file)) return false;
    const text = fs.readFileSync(file, 'utf8');
    return pull.test(text) && !/build.{0,6}--pull/.test(text);
  }).map(([name]) => name);
  if (!old.length) return null;
  return `Note: ${old.join(', ')} only pull${old.length === 1 ? 's' : ''} the ai-dev-workflow image, which ${COMPOSE_FILES.base} builds `
    + '(build:): the pull fails on every start and the image keeps its old base image. Rebuild it with `build --pull` '
    + `instead: delete ${old.join(' and ')} and run \`adw init\` (keep .adw/project.json, set up the dev container); it writes `
    + `the current launcher${old.length === 1 ? '' : 's'} and leaves every existing file untouched.`;
}

function killWarning(projectRoot) {
  const yaml = composeYaml(projectRoot);
  if (!yaml) return null;
  const dropsAll = /cap_drop:\s*(?:\[[^\]]*|(?:\s*-\s*\S+)*\s*-\s*)["']?ALL\b/.test(yaml);
  if (!dropsAll || /\b(?:CAP_)?KILL\b/.test(yaml)) return null;
  return `Note: ${COMPOSE_FILES.base} lacks the KILL capability, so the container stops when tini cannot `
    + 'forward a signal ("Operation not permitted"). Add `- KILL` under cap_add of the ai-dev-workflow service.';
}

// One-line ticketing login per backend for the next-steps printout; `file` has none.
const TICKETING_LOGIN = {
  github: './adw.sh gh auth login && ./adw.sh gh auth setup-git',
  gitea: './adw.sh tea login add  (flags: .adw/README.md, section 3)',
  'azure-devops': './adw.sh az login --use-device-code --allow-no-subscriptions',
};

/** The numbered next steps printed by `init` after a container setup, specific to `backend`. */
export function nextSteps({ backend, version }) {
  const steps = [
    `npx @strobl_dev/adw@${version} generate  (renders .claude/.codex/.opencode/.agents)`,
    './adw.sh claude  (log in once; or: ./adw.sh codex login --device-auth / ./adw.sh opencode auth login)',
    TICKETING_LOGIN[backend],
    'Create AGENTS.md: ./adw.sh claude, then /init (add an "End-to-end testing" section for agent-dev\'s e2e check)',
    'Commit .adw/, adw.sh, adw.ps1 and the generated dirs.',
    'Start working: ./adw.sh claude --dangerously-skip-permissions, then ask for agent-dev on a ticket.',
  ].filter(Boolean);
  return [
    'Next steps:',
    ...steps.map((s, i) => `  ${i + 1}. ${s}`),
    '  Details: .adw/README.md  (PowerShell: .\\adw.ps1 instead of ./adw.sh)',
  ].join('\n');
}
