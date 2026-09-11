import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateWorkspace(workspace, source) {
  if (typeof source !== 'string' || !source ||
      !(path.posix.isAbsolute(source) || /^[A-Za-z]:[\\/]/.test(source)) ||
      source === '/' || /^[A-Za-z]:[\\/]?$/.test(source)) {
    throw new Error('PROJECT_ROOT must be an explicit absolute project directory, not a filesystem root.');
  }
  if (!existsSync(workspace) || !statSync(workspace).isDirectory()) {
    throw new Error('The /workspace mount must be an existing project directory. Check PROJECT_ROOT.');
  }
  const root = realpathSync(workspace);
  const inside = candidate => {
    const relative = path.relative(root, candidate);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  function gitDirectory(candidate) {
    if (!inside(path.resolve(candidate)) || !existsSync(candidate) || !inside(realpathSync(candidate))) {
      throw new Error('Git directory is outside /workspace or missing. Use a standalone checkout or keep the complete Git directory inside the mounted project.');
    }
    return realpathSync(candidate);
  }
  const marker = path.join(root, '.git');
  if (existsSync(marker)) {
    let git = gitDirectory(marker);
    if (statSync(git).isFile()) {
      const match = /^gitdir: (.+)\s*$/m.exec(readFileSync(git, 'utf8'));
      if (!match) throw new Error('Invalid .git file: expected a gitdir reference.');
      git = gitDirectory(path.resolve(root, match[1].trim()));
    }
    const common = path.join(git, 'commondir');
    if (existsSync(common)) gitDirectory(path.resolve(git, readFileSync(common, 'utf8').trim()));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { validateWorkspace('/workspace', process.env.PROJECT_ROOT); }
  catch (error) { console.error(`agent runtime: ${error.message}`); process.exitCode = 1; }
}
