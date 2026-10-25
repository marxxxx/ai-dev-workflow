// The agent under test runs on the project's own dev image plus a thin layer with acpx and the ACP adapters
// (e2e/local/image). Built once per adw e2e call when its tag is missing; the project's older layers are pruned.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const IMAGE_DIR = fileURLToPath(new URL('./image', import.meta.url));
const SERVICE = 'ai-dev-workflow';
const LABEL = 'adw.e2e.root';

export function layerTag(baseId, dockerfile, lockfile) {
  const hash = createHash('sha256').update(`${baseId}\n${dockerfile}\n${lockfile}`).digest('hex');
  return `adw-e2e:${hash.slice(0, 12)}`;
}

export const overrideYaml = (tag) => [
  '# Written by adw e2e: the agent runs on the e2e layer over the project\'s dev image.',
  'services:', `  ${SERVICE}:`, `    image: ${tag}`, '    pull_policy: never', '    build: !reset null', '',
].join('\n');

// `composeFiles` and `env` are a trial's (compose.ai-dev.yml, the certs overlay when set; composeEnv).
export function ensureE2eImage({ root, runDir, composeFiles, env, exec, log, imageDir = IMAGE_DIR }) {
  // Streamed steps (stdio inherit) have no stderr to quote: their output is already on the terminal.
  const docker = (args, opts = {}) => {
    const r = exec('docker', args, opts);
    if (r.error) throw r.error;
    if (r.status !== 0) {
      const step = args[0] === 'compose' ? `compose ${args[args.indexOf('-p') + 2]}` : args[0];
      const detail = String(r.stderr ?? '').trim().slice(-500) || 'see the output above';
      throw new Error(`docker ${step} failed (exit ${r.status}): ${detail}`);
    }
    return String(r.stdout ?? '');
  };
  const compose = ['compose', ...composeFiles.flatMap((f) => ['-f', f]), '-p', 'adw-e2e-image'];
  const service = JSON.parse(docker([...compose, 'config', '--format', 'json'], { env })).services?.[SERVICE];
  if (!service) throw new Error(`${composeFiles[0]} has no ${SERVICE} service`);
  if (service.build) docker([...compose, 'build', SERVICE], { env, stdio: 'inherit' });
  const image = docker([...compose, 'config', '--images', SERVICE], { env }).trim().split('\n')[0];
  const inspect = () => exec('docker', ['image', 'inspect', '--format', '{{.Id}}', image]);
  let found = inspect();
  if (found.status !== 0) {
    docker(['pull', image], { stdio: 'inherit' });
    found = inspect();
    if (found.status !== 0) throw new Error(`${image}: not found after pull`);
  }
  const imageId = String(found.stdout ?? '').trim();
  const tag = layerTag(imageId, readFileSync(path.join(imageDir, 'Dockerfile'), 'utf8'),
    readFileSync(path.join(imageDir, 'package-lock.json'), 'utf8'));
  if (exec('docker', ['image', 'inspect', '--format', '{{.Id}}', tag]).status !== 0) {
    log(`building the e2e layer on ${image}`);
    docker(['build', '--build-arg', `BASE_IMAGE=${imageId}`, '--label', `${LABEL}=${root}`, '-t', tag, imageDir], { stdio: 'inherit' });
    const old = docker(['image', 'ls', '--filter', `label=${LABEL}=${root}`, '--format', '{{.Repository}}:{{.Tag}}']);
    // An image still in use stays; the next build tries again.
    for (const ref of old.split('\n').map((s) => s.trim()).filter((s) => s && s !== tag)) exec('docker', ['image', 'rm', ref]);
  }
  mkdirSync(runDir, { recursive: true });
  const overrideFile = path.join(runDir, 'compose.adw-e2e.yml');
  writeFileSync(overrideFile, overrideYaml(tag));
  return { image, imageId, tag, overrideFile };
}
