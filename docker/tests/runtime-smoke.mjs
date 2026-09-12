import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, chmodSync, readFileSync, readdirSync, writeFileSync, rmSync, copyFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const template = fileURLToPath(new URL('../docker-compose.yml', import.meta.url));
const temporary = mkdtempSync(path.join(tmpdir(), 'agent-runtime-smoke-'));
const project = path.join(temporary, 'project with spaces');
mkdirSync(project);
// Linux bind mounts keep host ownership; let the foreign fixture UID (12345) write here.
chmodSync(project, 0o777);
mkdirSync(path.join(project, '.codex'));
mkdirSync(path.join(project, '.agents/skills/example'), { recursive: true });
writeFileSync(path.join(project, 'ai-project.json'), JSON.stringify({ ticketing: { backend: 'azure-devops', azureDevOps: { organization: 'fixture-org' } } }));
writeFileSync(path.join(project, '.mcp.json'), JSON.stringify({ mcpServers: {
  ado: { command: 'npx', args: ['-y', '@azure-devops/mcp@2', 'fixture-org'] },
  dxdocs: { type: 'http', url: 'https://example.invalid/mcp' },
} }));
writeFileSync(path.join(project, '.codex/config.toml'), '[mcp_servers.ado]\ncommand = "npx"\nargs = ["-y", "@azure-devops/mcp@2", "fixture-org"]\n[mcp_servers.dxdocs]\nurl = "https://example.invalid/mcp"\n');
writeFileSync(path.join(project, '.agents/skills/example/SKILL.md'), '---\nname: example\ndescription: Fixture skill\n---\nRead only.\n');
// A project-declared volume must mask this host node_modules without touching it.
const nested = path.join(project, 'apps', 'web', 'node_modules');
mkdirSync(nested, { recursive: true });
for (const directory of [path.join(project, 'apps'), path.join(project, 'apps', 'web'), nested]) {
  chmodSync(directory, 0o777);
}
writeFileSync(path.join(nested, 'host-marker'), 'host\n');
const override = path.join(temporary, 'deps-override.yml');
writeFileSync(override, [
  'services:',
  '  ai-dev-workflow:',
  '    volumes:',
  '      - type: volume',
  '        source: deps-apps-web',
  '        target: /workspace/apps/web/node_modules',
  'volumes:',
  '  deps-apps-web:',
  '',
].join('\n'));
// Unmasked and full of host binaries: the preflight must say so without failing.
mkdirSync(path.join(project, 'pkg', 'node_modules', '@rollup', 'rollup-win32-x64-msvc'), { recursive: true });
const preserved = ['ai-project.json', '.mcp.json', '.codex/config.toml', '.agents/skills/example/SKILL.md'];
const before = preserved.map(file => readFileSync(path.join(project, file)));
// Meaningful only on Linux, where a bind mount keeps real host uids (see the HOST_UID
// remapping check below for the same platform guard).
const projectFileUid = process.platform === 'linux' ? statSync(path.join(project, 'ai-project.json')).uid : null;
const id = `agent-smoke-${process.pid}-${Date.now()}`;
const projects = [id, `${id}-other`, `${id}-deps`];
const env = { ...process.env, PROJECT_ROOT: project, AGENT_IMAGE: process.env.AGENT_IMAGE || 'ai-dev-workflow', HOST_UID: '12345', HOST_GID: '12345' };
delete env.CONTEXT7_API_KEY;
delete env.AZURE_TENANT_ID;
function docker(args, options = {}) {
  const result = spawnSync('docker', args, { env, encoding: 'utf8', timeout: 180000, ...options });
  if (result.error) throw result.error;
  return result;
}
function compose(args, options = {}) {
  const { name = id, file = template, ...execution } = options;
  const files = (Array.isArray(file) ? file : [file]).flatMap(entry => ['-f', entry]);
  return docker(['compose', '-p', name, ...files, ...args], execution);
}
function ok(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
function run(args, options) { return compose(['run', '--rm', '-T', '--no-deps', 'ai-dev-workflow', ...args], options); }
try {
  const withoutRoot = { ...env }; delete withoutRoot.PROJECT_ROOT;
  assert.notEqual(compose(['config'], { env: withoutRoot }).status, 0);
  const configuration = JSON.parse(ok(compose(['config', '--format', 'json'])));
  const service = configuration.services['ai-dev-workflow'];
  assert.equal(service.build, undefined);
  assert.equal(service.init, true);
  assert.equal(service.network_mode, undefined);
  assert.equal(service.privileged, undefined);
  assert.equal(service.volumes.length, 2);
  const bind = service.volumes.find(mount => mount.type === 'bind');
  assert.equal(bind.target, '/workspace');
  assert.equal(path.resolve(bind.source), project);
  // Compose v2 omits false; v5 emits it. Either way the host path must not be auto-created.
  assert.notEqual(bind.bind?.create_host_path, true);
  assert.equal(service.volumes.find(mount => mount.type === 'volume').target, '/home/dev');
  const copied = path.join(project, 'compose.ai-dev.yml'); copyFileSync(template, copied);
  const copiedConfig = JSON.parse(ok(compose(['config', '--format', 'json'], { file: copied })));
  assert.deepEqual(copiedConfig.services['ai-dev-workflow'].volumes, service.volumes);
  const second = JSON.parse(ok(compose(['config', '--format', 'json'], { name: projects[1] })));
  assert.notEqual(second.volumes['agent-home'].name, configuration.volumes['agent-home'].name);

  assert.notEqual(run(['true'], { env: { ...env, PROJECT_ROOT: path.join(temporary, 'missing') } }).status, 0);
  assert.notEqual(run(['true'], { env: { ...env, PROJECT_ROOT: '.' } }).status, 0);
  for (const bad of ['0', '-1', 'text', '4294967295']) {
    assert.notEqual(run(['true'], { env: { ...env, HOST_UID: bad } }).status, 0);
  }
  ok(run(['bash', '-c', 'test "$(id -u)" = 12345 && test "$(id -g)" = 12345 && echo persisted > "$HOME/persistence" && echo writable > /workspace/written']));
  if (process.platform === 'linux') {
    assert.equal(statSync(path.join(project, 'written')).uid, 12345);
  }
  assert.equal(ok(run(['cat', '/home/dev/persistence'])), 'persisted');
  ok(run(['bash', '-c', 'test "$(id -u)" = 12346 && test "$(stat -c %u "$HOME/persistence")" = 12346 && echo remapped >> "$HOME/persistence"'], { env: { ...env, HOST_UID: '12346', HOST_GID: '12346' } }));
  ok(run(['bash', '-c', 'test ! -e "$HOME/persistence"'], { name: projects[1] }));
  assert.equal(run(['bash', '-c', 'exit 37']).status, 37);
  ok(run(['bash', '-c', 'test ! -S /var/run/docker.sock && test ! -d /host && test -r /workspace/.agents/skills/example/SKILL.md']));
  writeFileSync(path.join(project, '.git'), 'gitdir: /outside/git/worktrees/agent\n');
  assert.notEqual(run(['true']).status, 0);
  rmSync(path.join(project, '.git'));
  ok(run(['verify-agent-config.sh']));
  if (ok(run(['bash', '-c', 'echo "${IMAGE_VARIANT:-base}"'])) === 'dotnet') {
    // The startup hook trusted the dev certificate in this home volume as the remapped user.
    ok(run(['bash', '-c', 'cd "$HOME" && dotnet dev-certs https --check --trust']));
  }
  // A volume mounted below the bind is container-only: writable by the runtime user,
  // and invisible to the host directory it masks.
  const deps = { name: projects[2], file: [template, override] };
  ok(run(['bash', '-c', [
    'test "$(stat -c %u /workspace/apps/web/node_modules)" = 12345',
    'test ! -e /workspace/apps/web/node_modules/host-marker',
    'echo container > /workspace/apps/web/node_modules/container-marker',
  ].join(' && ')], deps));
  assert.deepEqual(readdirSync(nested), ['host-marker'], 'The container volume must not reach the host node_modules');
  ok(run(['bash', '-c', 'test -e /workspace/apps/web/node_modules/container-marker'], deps));
  if (process.platform === 'linux') {
    // The chown that gives a nested volume to the runtime user must stay scoped to that
    // mount: a regression that walked the chown up into /workspace would flip ownership of
    // the host project tree itself, which this unchanged host file's uid rules out.
    assert.equal(statSync(path.join(project, 'ai-project.json')).uid, projectFileUid);
  }
  const preflight = run(['true']);
  assert.equal(preflight.status, 0, preflight.stderr);
  assert.match(preflight.stderr, /pkg\/node_modules holds host-platform files/);
  assert.match(preflight.stderr, /source: deps-pkg/);
  const configHash = ok(run(['sha256sum', '/home/dev/.codex/config.toml'])).split(/\s+/)[0];
  assert.equal(ok(run(['sha256sum', '/home/dev/.codex/config.toml'])).split(/\s+/)[0], configHash);
  preserved.forEach((file, index) => assert.deepEqual(readFileSync(path.join(project, file)), before[index], `Startup modified ${file}`));
  ok(run(['bash', '-c', 'printf "invalid = [" > "$HOME/.codex/config.toml"']));
  assert.notEqual(run(['true']).status, 0, 'Invalid runtime configuration must abort startup');
  console.log('Runtime smoke passed: mounts, paths, UID mapping, persistence, config preservation, failure handling.');
} finally {
  for (const name of projects) compose(['down', '--volumes', '--remove-orphans'], { name, file: [template, override] });
  rmSync(temporary, { recursive: true, force: true });
}
