// Build-time only: pre-provisions the Roslyn language server Serena's C# support would
// otherwise download on its first call. Version, URL, hash and layout are read from the
// installed Serena source, so they follow the Serena revision without a separate pin.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CLASS_NAME = 'CSharpLanguageServer';
const VERSION_CONSTANT = 'DEFAULT_CSHARP_LANGUAGE_SERVER_VERSION';
const FIELDS = {
  packageName: 'package_name', url: 'url', sha256: 'sha256', extractPath: 'extract_path', binaryName: 'binary_name',
};

export function parseRoslynDependency(source, platformId) {
  const fail = message => { throw new Error(`Serena C# language server source: ${message}`); };
  if (!new RegExp(`^class ${CLASS_NAME}\\(`, 'm').test(source)) fail(`class ${CLASS_NAME} not found`);
  const version = new RegExp(`^${VERSION_CONSTANT} = "([^"]+)"`, 'm').exec(source)?.[1];
  if (!version) fail(`${VERSION_CONSTANT} not found`);
  const block = source.split('RuntimeDependency(').slice(1)
    .map(entry => entry.slice(0, entry.indexOf('\n    )')))
    .find(entry => entry.includes(`platform_id="${platformId}"`));
  if (!block) fail(`no RuntimeDependency for platform ${platformId}`);
  if (!/id="CSharpLanguageServer"/.test(block)) fail(`the ${platformId} dependency is not CSharpLanguageServer`);
  if (!new RegExp(`package_version=${VERSION_CONSTANT},`).test(block)) fail(`the ${platformId} package_version is not ${VERSION_CONSTANT}`);
  const fields = {};
  for (const [key, field] of Object.entries(FIELDS)) {
    const value = new RegExp(`\\b${field}=f?"([^"]+)"`).exec(block)?.[1];
    if (!value) fail(`${field} missing for platform ${platformId}`);
    fields[key] = value.replaceAll(`{${VERSION_CONSTANT}}`, version);
  }
  if (!/^[0-9a-f]{64}$/.test(fields.sha256)) fail(`sha256 for platform ${platformId} is not a SHA-256 digest`);
  if (/[{}]/.test(fields.url)) fail(`unresolved placeholder in url ${fields.url}`);
  return { className: CLASS_NAME, version, ...fields };
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? `exit ${result.status}`}`);
}

// Lays out <destination>/<Class>/<package>.<version>/, the directory name Serena checks
// below $SERENA_HOME/language_servers/static/<Class>/ before it downloads.
export function provision(sourceFile, destination, platformId = `linux-${process.arch}`) {
  const dependency = parseRoslynDependency(readFileSync(sourceFile, 'utf8'), platformId);
  const work = mkdtempSync(path.join(tmpdir(), 'serena-roslyn-'));
  try {
    const archive = path.join(work, 'package.nupkg');
    run('curl', ['-fsSL', '--retry', '3', dependency.url, '-o', archive]);
    const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
    if (digest !== dependency.sha256) throw new Error(`sha256 mismatch for ${dependency.url}: ${digest}`);
    run('python3', ['-m', 'zipfile', '-e', archive, path.join(work, 'package')]);
    const extracted = path.join(work, 'package', dependency.extractPath);
    if (!existsSync(path.join(extracted, dependency.binaryName))) {
      throw new Error(`${dependency.binaryName} not found under ${dependency.extractPath}`);
    }
    const target = path.join(destination, dependency.className, `${dependency.packageName}.${dependency.version}`);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(extracted, target, { recursive: true });
    console.log(`Pre-provisioned ${dependency.packageName} ${dependency.version} at ${target}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [sourceFile, destination] = process.argv.slice(2);
  if (!sourceFile || !destination) throw new Error('usage: serena-roslyn.mjs <csharp_language_server.py> <destination>');
  provision(sourceFile, destination);
}
