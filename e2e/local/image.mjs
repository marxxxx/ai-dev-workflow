// The agent under test runs on the project's own dev image plus a thin layer with acpx and the ACP adapters
// (e2e/local/image). Built once per adw e2e call when its tag is missing; the project's older layers are pruned.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const IMAGE_DIR = fileURLToPath(new URL('./image', import.meta.url));
const SERVICE = 'ai-dev-workflow';
// A build: without image: is tagged <project>-<service>. Not `config --images`: it adds the depends_on images in random order.
export const devImage = (config) => config.services?.[SERVICE]?.image ?? `${config.name}-${SERVICE}`;
const LABEL = 'adw.e2e.root';
// Passed to the build by name, so their values (which may hold credentials) never reach argv.
const PROXY_ENV = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'];

// Every file the layer is built from (LAYER_FILES) goes into the tag, so a change to any of them rebuilds.
const LAYER_FILES = ['Dockerfile', 'package-lock.json', 'pr-cli.mjs'];

export function layerTag(baseId, ...files) {
  const hash = createHash('sha256').update([baseId, ...files].join('\n')).digest('hex');
  return `adw-e2e:${hash.slice(0, 12)}`;
}

export const overrideYaml = (tag, services) => [
  '# Written by adw e2e: the agent runs on the e2e layer over the project\'s dev image.',
  '# No published ports: a trial\'s agent and judge projects run side by side, and the checks look inside the containers.',
  'services:', `  ${SERVICE}:`, `    image: ${tag}`, '    pull_policy: never', '    build: !reset null', '    ports: !reset []',
  ...services.filter((s) => s !== SERVICE).flatMap((s) => [`  ${s}:`, '    ports: !reset []']), '',
].join('\n');

const isHostFile = (p) => statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;

// The service's mount targets below /workspace, relative to it: a judge's fresh checkout must have them (postverify.mjs).
// A bind of a single host file needs a file as its mount point, everything else a directory.
function workspaceMountPoints(service, isFile) {
  return (service.volumes ?? []).flatMap((v) => {
    const rel = path.posix.relative('/workspace', v.target ?? '');
    if (!rel || rel.startsWith('..') || path.posix.isAbsolute(rel)) return [];
    return [{ path: rel, file: v.type === 'bind' && isFile(v.source) }];
  });
}

// `composeFiles` and `env` are a trial's (compose.ai-dev.yml, the certs overlay when set; composeEnv).
export function ensureE2eImage({ root, runDir, composeFiles, env, exec, log, imageDir = IMAGE_DIR, isFile = isHostFile }) {
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
  const config = JSON.parse(docker([...compose, 'config', '--format', 'json'], { env }));
  const services = config.services ?? {};
  const service = services[SERVICE];
  if (!service) throw new Error(`${composeFiles[0]} has no ${SERVICE} service`);
  if (service.build) docker([...compose, 'build', SERVICE], { env, stdio: 'inherit' });
  const image = devImage(config);
  // Config as JSON: an image without USER has no User key, which a {{.Config.User}} template rejects.
  const inspect = () => exec('docker', ['image', 'inspect', '--format', '{{.Id}} {{json .Config}}', image]);
  let found = inspect();
  if (found.status !== 0) {
    docker(['pull', image], { stdio: 'inherit' });
    found = inspect();
    if (found.status !== 0) throw new Error(`${image}: not found after pull`);
  }
  const out = String(found.stdout ?? '').trim();
  const imageId = out.split(' ')[0];
  const user = JSON.parse(out.slice(imageId.length).trim() || '{}').User;
  const tag = layerTag(imageId, ...LAYER_FILES.map((f) => readFileSync(path.join(imageDir, f), 'utf8')));
  if (exec('docker', ['image', 'inspect', '--format', '{{.Id}}', tag]).status !== 0) {
    log(`building the e2e layer on ${image}`);
    // BuildKit reads `FROM sha256:…` as a Docker Hub repository: the base goes in by its local name, its ID only into the tag.
    docker(['build', '--build-arg', `BASE_IMAGE=${image}`, '--build-arg', `BASE_USER=${user || 'root'}`,
      ...PROXY_ENV.filter((n) => env[n]).flatMap((n) => ['--build-arg', n]),
      ...(env.AGENT_CA_DIR ? ['--build-context', `certs=${env.AGENT_CA_DIR}`] : []),
      '--label', `${LABEL}=${root}`, '-t', tag, imageDir], { env, stdio: 'inherit' });
    const old = docker(['image', 'ls', '--filter', `label=${LABEL}=${root}`, '--format', '{{.Repository}}:{{.Tag}}']);
    // An image still in use stays; the next build tries again.
    for (const ref of old.split('\n').map((s) => s.trim()).filter((s) => s && s !== tag)) exec('docker', ['image', 'rm', ref]);
  }
  mkdirSync(runDir, { recursive: true });
  const overrideFile = path.join(runDir, 'compose.adw-e2e.yml');
  writeFileSync(overrideFile, overrideYaml(tag, Object.keys(services)));
  return { image, imageId, tag, overrideFile, mountPoints: workspaceMountPoints(service, isFile) };
}
