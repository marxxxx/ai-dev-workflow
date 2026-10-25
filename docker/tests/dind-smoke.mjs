// Runtime smoke for the opt-in dind overlay: daemon reachability, image builds, compose
// workloads with project binds and published ports, Testcontainers, and the host boundary.
// Needs network access (image pulls, npm install).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderContainerFiles } from '../../agent-src/lib/container.mjs';

const inventory = JSON.parse(readFileSync(fileURLToPath(new URL('../tools/inventory.json', import.meta.url)), 'utf8'));
const temporary = mkdtempSync(path.join(tmpdir(), 'agent-dind-smoke-'));
// The compose file and dind overlay consuming projects get from `init`, rendered the same way.
const rendered = renderContainerFiles({ name: 'smoke', stack: 'generic', backend: 'file' });
const [template, overlay] = ['compose.ai-dev.yml', 'compose.ai-dev.dind.yml'].map(name => {
  const file = path.join(temporary, name);
  writeFileSync(file, rendered.find(candidate => candidate.path === name).content);
  return file;
});
const project = path.join(temporary, 'project with spaces');
mkdirSync(path.join(project, 'web'), { recursive: true });
writeFileSync(path.join(project, 'ai-project.json'), JSON.stringify({ ticketing: { backend: 'file' } }));
writeFileSync(path.join(project, 'web', 'index.html'), 'served-from-project\n');
writeFileSync(path.join(project, 'Dockerfile'), 'FROM busybox:1.37\nRUN echo built-in-dind > /built\n');
writeFileSync(path.join(project, 'stack.yml'), [
  'services:',
  '  web:',
  '    image: nginx:1.29-alpine',
  '    ports: ["80:80"]',
  '    volumes: ["./web:/usr/share/nginx/html:ro"]',
  '',
].join('\n'));
writeFileSync(path.join(project, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
writeFileSync(path.join(project, 'testcontainers.mjs'), [
  "import { GenericContainer, Wait } from 'testcontainers';",
  "const container = await new GenericContainer('nginx:1.29-alpine').withExposedPorts(80)",
  "  .withWaitStrategy(Wait.forHttp('/', 80)).start();",
  'const response = await fetch(`http://${container.getHost()}:${container.getMappedPort(80)}/`);',
  "if (!response.ok) throw new Error(`HTTP ${response.status}`);",
  'await container.stop();',
  "console.log('testcontainers-ok');",
  '',
].join('\n'));

const id = `agent-dind-smoke-${process.pid}-${Date.now()}`;
const ids = process.platform === 'linux' ? { HOST_UID: String(process.getuid()), HOST_GID: String(process.getgid()) } : {};
const env = { ...process.env, PROJECT_ROOT: project, AGENT_IMAGE: process.env.AGENT_IMAGE || 'ai-dev-workflow', ...ids };
function compose(args) {
  const result = spawnSync('docker', ['compose', '-p', id, '-f', template, '-f', overlay, ...args],
    { env, encoding: 'utf8', timeout: 600000 });
  if (result.error) throw result.error;
  return result;
}
function ok(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
const agent = script => ok(compose(['run', '--rm', '-T', 'ai-dev-workflow', 'bash', '-c', `set -euo pipefail; ${script}`]));

try {
  assert.equal(agent('docker info --format "{{.ServerVersion}}"').split('\n').at(-1), inventory.dindImage.docker);
  // The agent reaches the sidecar's socket only; no host socket and no other host path.
  agent('test -S /run/dind/docker.sock && test ! -e /var/run/docker.sock && test "$(id -u)" != 0');
  const sidecar = ok(compose(['ps', '-q', 'docker']));
  const mounts = JSON.parse(ok(spawnSync('docker', ['inspect', '--format', '{{json .Mounts}}', sidecar], { encoding: 'utf8' })));
  const binds = mounts.filter(mount => mount.Type === 'bind');
  assert.deepEqual(binds.map(mount => mount.Destination), ['/workspace']);
  assert.equal(path.resolve(binds[0].Source), project);

  assert.equal(agent('docker build -q -t dind-smoke-built . >/dev/null && docker run --rm dind-smoke-built cat /built'), 'built-in-dind');
  // Relative binds resolve to the project; published ports answer on localhost.
  assert.match(agent('docker compose -f stack.yml up -d --wait >/dev/null 2>&1 && curl -fsS http://localhost:80/'), /served-from-project/);
  agent('docker compose -f stack.yml down >/dev/null 2>&1');
  // A nested container writing into the project leaves a file the agent can still remove.
  agent('docker run --rm -v /workspace/web:/out busybox:1.37 sh -c "echo nested > /out/nested.txt" && rm /workspace/web/nested.txt');
  assert.deepEqual(readdirSync(path.join(project, 'web')), ['index.html']);

  assert.match(agent('npm install --no-audit --no-fund --silent testcontainers@11 >/dev/null && node testcontainers.mjs'), /testcontainers-ok/);
  console.log('dind smoke passed: daemon, build, compose with project binds and ports, nested writes, Testcontainers, host boundary.');
} finally {
  compose(['down', '--volumes', '--remove-orphans']);
  rmSync(temporary, { recursive: true, force: true });
}
