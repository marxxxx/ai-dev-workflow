// Proves that the .NET image keeps build output out of the mounted project: MSBuild picks
// up the image's ArtifactsPath as a global property, so bin/ and obj/ never land in the
// project directory and the host's obj/project.assets.json is never read or overwritten.
// Runs at image build time. The build below redirects into a temporary home of its own,
// so it leaves nothing behind in /home/dev (a fresh home volume is seeded from the image).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ARTIFACTS = '/home/dev/artifacts';
const PACKAGES = '/home/dev/.nuget/packages';
assert.equal(process.env.ArtifactsPath, ARTIFACTS, `The image must set ArtifactsPath=${ARTIFACTS}`);
assert.equal(process.env.NUGET_PACKAGES, PACKAGES, `The image must set NUGET_PACKAGES=${PACKAGES}`);

const home = mkdtempSync(path.join(tmpdir(), 'verify-artifacts-'));
try {
  const artifacts = path.join(home, 'artifacts');
  const project = path.join(home, 'App');
  mkdirSync(project);
  const framework = `net${execFileSync('dotnet', ['--version'], { encoding: 'utf8' }).trim().split('.')[0]}.0`;
  writeFileSync(path.join(project, 'App.csproj'), [
    '<Project Sdk="Microsoft.NET.Sdk">',
    '  <PropertyGroup>',
    `    <TargetFramework>${framework}</TargetFramework>`,
    '  </PropertyGroup>',
    '</Project>',
    '',
  ].join('\n'));
  writeFileSync(path.join(project, 'Class1.cs'), 'public class Class1 { }\n');
  execFileSync('dotnet', ['build', '--nologo', '-v:q'], {
    cwd: project,
    stdio: 'inherit',
    env: { ...process.env, HOME: home, ArtifactsPath: artifacts, NUGET_PACKAGES: path.join(home, 'nuget') },
  });
  for (const leaked of ['bin', 'obj']) {
    assert.equal(existsSync(path.join(project, leaked)),
      false, `dotnet build wrote ${leaked}/ into the project directory`);
  }
  assert.ok(existsSync(path.join(artifacts, 'bin', 'App')), 'Build output did not land under ArtifactsPath');
  assert.ok(existsSync(path.join(artifacts, 'obj', 'App', 'project.assets.json')),
    'Restore assets did not land under ArtifactsPath');
} finally {
  rmSync(home, { recursive: true, force: true });
}

console.log(`dotnet build keeps bin/obj out of the project directory (ArtifactsPath=${ARTIFACTS}): ok`);
