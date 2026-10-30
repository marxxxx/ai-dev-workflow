// Build-time only: provides the TypeScript installation Serena pins tsserver to for untrusted
// projects. Serena installs one only when it launches typescript-language-server itself; the image
// sets ls_path, so the image's typescript-serena is linked where Serena looks. The directory name is
// read from the installed Serena source, and a typescript-serena pin other than Serena's default
// version fails the build.
import { existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CLASS_NAME = 'TypeScriptLanguageServer';
const CONSTANTS = [
  'INITIAL_TYPESCRIPT_VERSION', 'DEFAULT_TYPESCRIPT_VERSION',
  'INITIAL_TYPESCRIPT_LANGUAGE_SERVER_VERSION', 'DEFAULT_TYPESCRIPT_LANGUAGE_SERVER_VERSION',
];
// The lines of _get_install_dir and _get_pinned_tsdk_path the directory name below is derived from.
const INSTALL_DIR_RULE = [
  'typescript_version == INITIAL_TYPESCRIPT_VERSION',
  'and typescript_language_server_version == INITIAL_TYPESCRIPT_LANGUAGE_SERVER_VERSION',
  'ls_dirname = "ts-lsp" if is_initial else f"ts-lsp-{typescript_version}-{typescript_language_server_version}"',
];
const TSDK_PATH = 'return os.path.join(install_dir, "node_modules", "typescript", "lib")';

export function parseTypeScriptPin(source) {
  const fail = message => { throw new Error(`Serena TypeScript language server source: ${message}`); };
  if (!new RegExp(`^class ${CLASS_NAME}\\(`, 'm').test(source)) fail(`class ${CLASS_NAME} not found`);
  const versions = {};
  for (const name of CONSTANTS) {
    versions[name] = new RegExp(`^${name} = "([^"]+)"`, 'm').exec(source)?.[1];
    if (!versions[name]) fail(`${name} not found`);
  }
  for (const line of INSTALL_DIR_RULE) if (!source.includes(line)) fail(`_get_install_dir changed: ${line} (ls_dirname rule) not found`);
  if (!source.includes(TSDK_PATH)) fail(`_get_pinned_tsdk_path no longer returns node_modules/typescript/lib`);
  const typescriptVersion = versions.DEFAULT_TYPESCRIPT_VERSION;
  const serverVersion = versions.DEFAULT_TYPESCRIPT_LANGUAGE_SERVER_VERSION;
  const initial = typescriptVersion === versions.INITIAL_TYPESCRIPT_VERSION
    && serverVersion === versions.INITIAL_TYPESCRIPT_LANGUAGE_SERVER_VERSION;
  return { className: CLASS_NAME, typescriptVersion, packageName: initial ? 'ts-lsp' : `ts-lsp-${typescriptVersion}-${serverVersion}` };
}

// Lays out <destination>/<Class>/<package>/node_modules/typescript -> <typescriptPackage>, the
// package launch-agent.mjs links below $SERENA_HOME/language_servers/static/<Class>/.
export function provision(sourceFile, typescriptPackage, destination) {
  const pin = parseTypeScriptPin(readFileSync(sourceFile, 'utf8'));
  const { version } = JSON.parse(readFileSync(path.join(typescriptPackage, 'package.json'), 'utf8'));
  if (version !== pin.typescriptVersion) {
    throw new Error(`typescript-serena is ${version}, but Serena pins tsserver to TypeScript ${pin.typescriptVersion}; `
      + 'align typescript-serena in docker/tools/inventory.json');
  }
  if (!existsSync(path.join(typescriptPackage, 'lib', 'tsserver.js'))) throw new Error(`${typescriptPackage} has no lib/tsserver.js`);
  const modules = path.join(destination, pin.className, pin.packageName, 'node_modules');
  mkdirSync(modules, { recursive: true });
  symlinkSync(typescriptPackage, path.join(modules, 'typescript'), 'dir');
  console.log(`Linked TypeScript ${version} for Serena's tsserver pin at ${modules}/typescript`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [sourceFile, typescriptPackage, destination] = process.argv.slice(2);
  if (!sourceFile || !typescriptPackage || !destination) {
    throw new Error('usage: serena-typescript.mjs <typescript_language_server.py> <typescript package> <destination>');
  }
  provision(sourceFile, typescriptPackage, destination);
}
