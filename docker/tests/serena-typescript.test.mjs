import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseTypeScriptPin, provision } from '../tools/serena-typescript.mjs';

// Excerpt of solidlsp/language_servers/typescript_language_server.py at the pinned Serena revision.
const source = `
INITIAL_TYPESCRIPT_VERSION = "5.9.3"
DEFAULT_TYPESCRIPT_VERSION = "5.9.3"
INITIAL_TYPESCRIPT_LANGUAGE_SERVER_VERSION = "5.1.3"
DEFAULT_TYPESCRIPT_LANGUAGE_SERVER_VERSION = "5.1.3"


def _get_install_dir(ls_resources_dir: str, typescript_version: str, typescript_language_server_version: str) -> str:
    # legacy unversioned dir reserved for INITIAL pair; any other version combination goes into a versioned subdir
    is_initial = (
        typescript_version == INITIAL_TYPESCRIPT_VERSION
        and typescript_language_server_version == INITIAL_TYPESCRIPT_LANGUAGE_SERVER_VERSION
    )
    ls_dirname = "ts-lsp" if is_initial else f"ts-lsp-{typescript_version}-{typescript_language_server_version}"
    return os.path.join(ls_resources_dir, ls_dirname)


class TypeScriptLanguageServer(SolidLanguageServer):
    def _get_pinned_tsdk_path(self) -> str:
        install_dir = _get_install_dir(
            self._ls_resources_dir,
            self._custom_settings.get("typescript_version", DEFAULT_TYPESCRIPT_VERSION),
            self._custom_settings.get("typescript_language_server_version", DEFAULT_TYPESCRIPT_LANGUAGE_SERVER_VERSION),
        )
        return os.path.join(install_dir, "node_modules", "typescript", "lib")
`;

test('reads the install directory Serena pins tsserver to for its default versions', () => {
  assert.deepEqual(parseTypeScriptPin(source), {
    className: 'TypeScriptLanguageServer', typescriptVersion: '5.9.3', packageName: 'ts-lsp',
  });
});

test('uses the versioned directory once the defaults move past the initial pair', () => {
  const bumped = source.replace('DEFAULT_TYPESCRIPT_VERSION = "5.9.3"', 'DEFAULT_TYPESCRIPT_VERSION = "6.0.3"');
  assert.deepEqual(parseTypeScriptPin(bumped), {
    className: 'TypeScriptLanguageServer', typescriptVersion: '6.0.3', packageName: 'ts-lsp-6.0.3-5.1.3',
  });
});

test('fails when a version constant is missing', () => {
  assert.throws(() => parseTypeScriptPin(source.replace(/^DEFAULT_TYPESCRIPT_LANGUAGE_SERVER_VERSION.*$/m, '')),
    /DEFAULT_TYPESCRIPT_LANGUAGE_SERVER_VERSION/);
});

test('fails when the install directory naming changed', () => {
  assert.throws(() => parseTypeScriptPin(source.replace('"ts-lsp" if is_initial', '"tsserver" if is_initial')), /ls_dirname/);
});

test('fails when the pinned tsdk path no longer points into node_modules/typescript/lib', () => {
  assert.throws(() => parseTypeScriptPin(source.replace('"typescript", "lib"', '"typescript"')), /_get_pinned_tsdk_path/);
});

test('fails when the language server class was renamed', () => {
  assert.throws(() => parseTypeScriptPin(source.replace('class TypeScriptLanguageServer(', 'class TsServer(')),
    /TypeScriptLanguageServer/);
});

function fixture(t, typescriptVersion) {
  const root = mkdtempSync(path.join(tmpdir(), 'serena-typescript-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceFile = path.join(root, 'typescript_language_server.py');
  writeFileSync(sourceFile, source);
  const typescript = path.join(root, 'agent-tools', 'typescript-serena');
  mkdirSync(path.join(typescript, 'lib'), { recursive: true });
  writeFileSync(path.join(typescript, 'package.json'), JSON.stringify({ name: 'typescript', version: typescriptVersion }));
  writeFileSync(path.join(typescript, 'lib', 'tsserver.js'), '// tsserver\n');
  return { sourceFile, typescript, destination: path.join(root, 'ls') };
}

test('links the image TypeScript where Serena looks for its managed installation', t => {
  const { sourceFile, typescript, destination } = fixture(t, '5.9.3');
  provision(sourceFile, typescript, destination);
  const lib = path.join(destination, 'TypeScriptLanguageServer', 'ts-lsp', 'node_modules', 'typescript', 'lib');
  assert.equal(realpathSync(lib), realpathSync(path.join(typescript, 'lib')));
  assert.equal(readFileSync(path.join(lib, 'tsserver.js'), 'utf8'), '// tsserver\n');
});

test('fails when the image TypeScript is not the version Serena pins', t => {
  const { sourceFile, typescript, destination } = fixture(t, '5.8.2');
  assert.throws(() => provision(sourceFile, typescript, destination), /5\.8\.2.*5\.9\.3/);
});
