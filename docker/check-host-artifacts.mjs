// Warns when the mounted project carries build artifacts of the host platform that no
// container volume masks, and when in-tree .NET output is shared without a redirect.
// Advisory only: host and container installs overwrite each other, but the agents still
// start. Read-only, and it never descends into a dependency tree.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { workspaceMounts } from './workspace-mounts.mjs';

const MAX_DEPTH = 5;
const SKIP = new Set(['.git', '.vs', '.hg', '.svn']);
const HOST_PACKAGE = /(^|-)(win32|windows|darwin)(-|$)|msvc/i;
const HOST_SHIM = /\.(cmd|ps1)$/i;
const PROJECT_FILE = /\.(csproj|fsproj|sln|slnx)$/i;
const OUTPUT = new Set(['bin', 'obj']);

const slashes = target => target.split(path.sep).join('/');

function entries(directory) {
  try { return readdirSync(directory, { withFileTypes: true }); } catch { return []; }
}

function masked(directory, mounts) {
  const target = slashes(directory);
  return mounts.some(mount => target === slashes(mount) || target.startsWith(`${slashes(mount)}/`));
}

// apps/web/node_modules -> deps-apps-web; a root node_modules -> deps-root.
function volumeName(relative) {
  const parent = path.posix.dirname(slashes(relative));
  const slug = parent === '.' ? 'root' : parent.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `deps-${slug || 'root'}`;
}

// pnpm materialises packages as symlinks into its store, so a directory check alone misses
// them — a symlinked entry is just as much a candidate as a real directory here.
const isPackageLike = entry => entry.isDirectory() || entry.isSymbolicLink();

function hostTrace(nodeModules) {
  for (const entry of entries(path.join(nodeModules, '.bin'))) {
    if (!entry.isDirectory() && HOST_SHIM.test(entry.name)) return path.join('.bin', entry.name);
  }
  for (const entry of entries(nodeModules)) {
    if (!isPackageLike(entry)) continue;
    if (HOST_PACKAGE.test(entry.name)) return entry.name;
    if (!entry.name.startsWith('@')) continue;
    for (const scoped of entries(path.join(nodeModules, entry.name))) {
      if (isPackageLike(scoped) && HOST_PACKAGE.test(scoped.name)) return `${entry.name}/${scoped.name}`;
    }
  }
  return null;
}

export function findHostArtifacts({ root, mounts = [], artifactsPath = '' }) {
  const warnings = [];
  const output = [];
  const queue = [{ directory: root, depth: 0 }];
  while (queue.length) {
    const { directory, depth } = queue.shift();
    const list = entries(directory);
    // MSBuild writes bin/obj into the same directory as the project file, so only a bin/obj
    // that sits next to one is .NET output — a csproj elsewhere in the tree proves nothing
    // about an unrelated bin/ (a plain Node CLI's own bin/, for example).
    const hasProjectFile = list.some(entry => entry.isFile() && PROJECT_FILE.test(entry.name));
    for (const entry of list) {
      const full = path.join(directory, entry.name);
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules') {
        if (masked(full, mounts)) continue;
        const trace = hostTrace(full);
        if (trace) {
          const relative = path.relative(root, full);
          const volume = volumeName(relative);
          warnings.push([
            `agent runtime: warning: ${slashes(relative)} holds host-platform files (${slashes(trace)})`,
            '  and no container volume masks it, so host and container installs overwrite each other.',
            '  Add to your compose.ai-dev.yml, under services.ai-dev-workflow.volumes:',
            '      - type: volume',
            `        source: ${volume}`,
            `        target: /workspace/${slashes(relative)}`,
            `  and declare the volume at the bottom of the file: ${volume}:`,
          ].join('\n'));
        }
        continue;
      }
      if (OUTPUT.has(entry.name)) {
        if (hasProjectFile) output.push(path.relative(root, full));
        continue;
      }
      if (SKIP.has(entry.name)) continue;
      if (depth + 1 < MAX_DEPTH) queue.push({ directory: full, depth: depth + 1 });
    }
  }
  if (!artifactsPath && output.length) {
    const listed = output.slice(0, 3).map(slashes).join(', ');
    warnings.push([
      `agent runtime: warning: in-tree .NET build output (${listed}${output.length > 3 ? ', …' : ''}) is shared with the host`,
      '  and ArtifactsPath is not set, so host and container builds overwrite each other, including',
      '  obj/project.assets.json and its package paths. Use the .NET image, or set ArtifactsPath in',
      '  the service environment of your compose.ai-dev.yml.',
    ].join('\n'));
  }
  return warnings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const warnings = findHostArtifacts({
      root: '/workspace',
      mounts: workspaceMounts(),
      artifactsPath: process.env.ArtifactsPath ?? '',
    });
    for (const warning of warnings) console.warn(warning);
  } catch (error) {
    // Advisory check: a failure here must never keep the agents from starting.
    console.warn(`agent runtime: warning: could not inspect the project for host build artifacts (${error.message})`);
  }
}
