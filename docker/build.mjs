#!/usr/bin/env node
// Builds all agent images from one versioned base and tags each as <tag> and latest.
//   node docker/build.mjs [--tag 2026.09.11] [--no-cache]
// Use --no-cache after a tool update so unpinned apt layers are refreshed as well.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findDrift } from './tools/inventory.mjs';

const DOCKER_DIR = fileURLToPath(new URL('.', import.meta.url));
const IMAGES = [
  { image: 'ai-dev-workflow', dockerfile: 'Dockerfile' },
  { image: 'ai-dev-workflow-node', dockerfile: 'Dockerfile.node', derived: true },
  { image: 'ai-dev-workflow-dotnet', dockerfile: 'Dockerfile.dotnet', derived: true },
];
const TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

export function defaultTag(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

export function buildPlan({ tag, revision, noCache = false }) {
  if (!TAG.test(tag ?? '')) throw new Error(`invalid image tag "${tag}"`);
  const base = `${IMAGES[0].image}:${tag}`;
  return IMAGES.map(({ image, dockerfile, derived }) => ({
    image,
    args: [
      'build', '-f', path.join(DOCKER_DIR, dockerfile),
      '-t', `${image}:${tag}`, '-t', `${image}:latest`,
      '--label', `org.opencontainers.image.version=${tag}`,
      '--label', `org.opencontainers.image.revision=${revision}`,
      ...(derived ? ['--build-arg', `BASE_IMAGE=${base}`] : []),
      ...(noCache ? ['--no-cache'] : []),
      DOCKER_DIR,
    ],
  }));
}

function gitRevision() {
  const git = args => spawnSync('git', args, { cwd: DOCKER_DIR, encoding: 'utf8' });
  const head = git(['rev-parse', 'HEAD']);
  if (head.status !== 0) return 'unknown';
  return `${head.stdout.trim()}${git(['status', '--porcelain']).stdout.trim() ? '-dirty' : ''}`;
}

function main(args) {
  const tagIndex = args.indexOf('--tag');
  const tag = tagIndex === -1 ? defaultTag() : args[tagIndex + 1];
  const plan = buildPlan({ tag, revision: gitRevision(), noCache: args.includes('--no-cache') });
  const drift = findDrift();
  if (drift.length) {
    for (const line of drift) console.error(`drift: ${line}`);
    console.error('Tool pins drifted from tools/inventory.json; run node docker/tools/inventory.mjs sync first.');
    return 1;
  }
  for (const { args: dockerArgs } of plan) {
    console.log(`\n> docker ${dockerArgs.join(' ')}`);
    const result = spawnSync('docker', dockerArgs, { stdio: 'inherit' });
    if (result.status !== 0) return result.status ?? 1;
  }
  console.log(`\nBuilt ${plan.map(step => `${step.image}:${tag}`).join(', ')} (also tagged latest).`);
  console.log(`Pin a project to this build with AGENT_IMAGE=<image>:${tag}.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
