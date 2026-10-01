import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoslynDependency } from '../tools/serena-roslyn.mjs';

// Excerpt of solidlsp/language_servers/csharp_language_server.py at the pinned Serena revision.
const source = `
DEFAULT_CSHARP_LANGUAGE_SERVER_VERSION = "5.5.0-2.26078.4"

_RUNTIME_DEPENDENCIES = [
    RuntimeDependency(
        id="CSharpLanguageServer",
        description="Roslyn Language Server for Windows (x64)",
        package_name="roslyn-language-server.win-x64",
        package_version=DEFAULT_CSHARP_LANGUAGE_SERVER_VERSION,
        url=f"https://www.nuget.org/api/v2/package/roslyn-language-server.win-x64/{DEFAULT_CSHARP_LANGUAGE_SERVER_VERSION}",
        platform_id="win-x64",
        archive_type="nupkg",
        binary_name="Microsoft.CodeAnalysis.LanguageServer.dll",
        extract_path="tools/net10.0/win-x64",
        sha256="7f3d4119e75305399e6faa81a68240b33c48b94ad523a904594abd00db95572a",
    ),
    RuntimeDependency(
        id="CSharpLanguageServer",
        description="Roslyn Language Server for Linux (x64)",
        package_name="roslyn-language-server.linux-x64",
        package_version=DEFAULT_CSHARP_LANGUAGE_SERVER_VERSION,
        url=f"https://www.nuget.org/api/v2/package/roslyn-language-server.linux-x64/{DEFAULT_CSHARP_LANGUAGE_SERVER_VERSION}",
        platform_id="linux-x64",
        archive_type="nupkg",
        binary_name="Microsoft.CodeAnalysis.LanguageServer.dll",
        extract_path="tools/net10.0/linux-x64",
        sha256="1aad25de456d637a1eee993ca0d569a1b78d711744ccb36410a3a20250a48aa6",
    ),
]

class CSharpLanguageServer(SolidLanguageServer):
    pass
`;

test('reads the pinned linux-x64 Roslyn dependency from the Serena source', () => {
  assert.deepEqual(parseRoslynDependency(source, 'linux-x64'), {
    className: 'CSharpLanguageServer',
    packageName: 'roslyn-language-server.linux-x64',
    version: '5.5.0-2.26078.4',
    url: 'https://www.nuget.org/api/v2/package/roslyn-language-server.linux-x64/5.5.0-2.26078.4',
    sha256: '1aad25de456d637a1eee993ca0d569a1b78d711744ccb36410a3a20250a48aa6',
    extractPath: 'tools/net10.0/linux-x64',
    binaryName: 'Microsoft.CodeAnalysis.LanguageServer.dll',
  });
});

test('fails when the platform dependency is absent', () => {
  assert.throws(() => parseRoslynDependency(source, 'linux-arm64'), /linux-arm64/);
});

test('fails when the default version constant is missing', () => {
  assert.throws(() => parseRoslynDependency(source.replace(/^DEFAULT_CSHARP.*$/m, ''), 'linux-x64'),
    /DEFAULT_CSHARP_LANGUAGE_SERVER_VERSION/);
});

test('fails when a field of the dependency is missing', () => {
  const withoutHash = source.replace(/sha256="1aad[^"]*",\n/, '');
  assert.throws(() => parseRoslynDependency(withoutHash, 'linux-x64'), /sha256/);
});

test('fails when the language server class was renamed', () => {
  assert.throws(() => parseRoslynDependency(source.replace('class CSharpLanguageServer(', 'class RoslynServer('), 'linux-x64'),
    /CSharpLanguageServer/);
});
