// Serena C# acceptance for the .NET image: offline, through the normal entrypoint, as the
// runtime user, on a fresh home volume. The first container restores the fixture offline and
// checks semantics; the second reuses the volume to prove the startup link is idempotent and
// that the restore assets persist.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const image = process.env.AGENT_IMAGE || 'ai-dev-workflow-dotnet';
const fixture = fileURLToPath(new URL('./fixtures/csharp-semantic', import.meta.url));
const temporary = mkdtempSync(path.join(tmpdir(), 'agent-semantic-csharp-'));
const project = path.join(temporary, 'project');
const volume = `agent-semantic-csharp-${process.pid}-${Date.now()}`;

function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 600_000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) throw result.error;
  return result;
}

// Linux bind mounts keep ownership: map the runtime user to this user, as the launch scripts
// do, so Serena can write .serena into the copy and the cleanup can remove it again.
const hostIds = process.getuid?.() > 0 ? ['-e', `HOST_UID=${process.getuid()}`, '-e', `HOST_GID=${process.getgid()}`] : [];

cpSync(fixture, project, { recursive: true });
writeFileSync(path.join(project, 'ai-project.json'), `${JSON.stringify({ ticketing: { backend: 'github' } })}\n`);
try {
  assert.equal(docker(['volume', 'create', volume]).status, 0);
  for (const options of [['--restore'], []]) {
    // Same isolation as the Compose template, plus no network at all.
    const result = docker([
      'run', '--rm', '--init', '--network', 'none',
      '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--cap-add', 'DAC_OVERRIDE', '--cap-add', 'FOWNER',
      '--cap-add', 'SETUID', '--cap-add', 'SETGID', '--security-opt', 'no-new-privileges:true',
      '-e', `PROJECT_ROOT=${project}`, ...hostIds,
      '--mount', `type=bind,source=${project},target=/workspace`,
      '--mount', `type=volume,source=${volume},target=/home/dev`,
      image, 'node', '/usr/local/lib/agent-runtime/verify-semantic.mjs', 'csharp', ...options,
    ]);
    process.stdout.write(result.stdout);
    assert.equal(result.status, 0, `C# semantic check ${options.join(' ') || '(reused home)'} failed:\n${result.stderr.slice(-6000)}`);
  }
  console.log('Serena C# acceptance passed: offline, fresh home, startup link, restore, cross-project references, reuse.');
} finally {
  docker(['volume', 'rm', '--force', volume]);
  rmSync(temporary, { recursive: true, force: true });
}
