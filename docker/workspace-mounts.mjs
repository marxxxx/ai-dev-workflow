// Discovers the container's own mounts inside the workspace. Compose may mask project
// subdirectories (a container-only node_modules, for example) with volumes; the runtime
// finds them here instead of being told where they are.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ESCAPES = { '040': ' ', '011': '\t', '012': '\n', '134': '\\' };

export function nestedMounts(mountinfo, root = '/workspace') {
  if (typeof mountinfo !== 'string') return [];
  const prefix = `${root.replace(/\/+$/, '')}/`;
  const mounts = [];
  for (const entry of mountinfo.split('\n')) {
    const fields = entry.split(' ');
    if (fields.length < 5) continue;
    const target = fields[4].replace(/\\(040|011|012|134)/g, (_, code) => ESCAPES[code]);
    if (!target.startsWith(prefix) || target.includes('\0')) continue;
    if (!mounts.includes(target)) mounts.push(target);
  }
  return mounts;
}

export function workspaceMounts(root = '/workspace') {
  return nestedMounts(readFileSync('/proc/self/mountinfo', 'utf8'), root);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  // NUL-separated so the entrypoint can read mount points containing spaces.
  process.stdout.write(workspaceMounts().map(mount => `${mount}\0`).join(''));
}
