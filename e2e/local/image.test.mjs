import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureE2eImage, layerTag, overrideYaml } from './image.mjs';

const BASE_ID = 'sha256:1111';

// A layer dir and run dir; `docker` answers each argv (first match wins), everything else succeeds empty.
function setup(t, answers = []) {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-image-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const imageDir = path.join(dir, 'image');
  mkdirSync(imageDir);
  writeFileSync(path.join(imageDir, 'Dockerfile'), 'FROM x\n');
  writeFileSync(path.join(imageDir, 'package-lock.json'), '{}\n');
  const calls = []; const logs = [];
  const exec = (cmd, args, opts = {}) => {
    calls.push({ cmd, args, opts });
    const hit = answers.find(([match]) => match(args));
    return hit ? hit[1] : { status: 0, stdout: '', stderr: '' };
  };
  const tag = layerTag(BASE_ID, 'FROM x\n', '{}\n');
  const opts = { root: '/proj', runDir: path.join(dir, 'run'), composeFiles: ['/proj/compose.ai-dev.yml'], env: { PROJECT_ROOT: '/proj' },
    exec, log: (s) => logs.push(s), imageDir };
  return { calls, logs, opts, tag };
}

const is = (...parts) => (args) => parts.every((p, i) => args[i] === p);
const has = (part) => (args) => args.includes(part);
const isConfig = (args) => args.includes('config') && args.includes('json');
const configJson = (service) => ({ status: 0, stdout: JSON.stringify({ services: { 'ai-dev-workflow': service } }) });
const images = (ref) => [[has('--images'), { status: 0, stdout: `${ref}\n` }]];
// `docker image inspect` output for an image without USER: Config has no User key at all.
const baseInspect = (ref) => [(a) => is('image', 'inspect')(a) && a.at(-1) === ref, { status: 0, stdout: `${BASE_ID} {"Env":[]}\n` }];
const layerMissing = [(a) => is('image', 'inspect')(a) && a.at(-1).startsWith('adw-e2e:'), { status: 1, stdout: '', stderr: 'No such image' }];

test('layerTag is stable and changes with the base image or the lockfile', () => {
  const tag = layerTag('sha256:a', 'D', 'L');
  assert.match(tag, /^adw-e2e:[0-9a-f]{12}$/);
  assert.equal(layerTag('sha256:a', 'D', 'L'), tag);
  assert.notEqual(layerTag('sha256:b', 'D', 'L'), tag);
  assert.notEqual(layerTag('sha256:a', 'D', 'L2'), tag);
});

test('builds the layer on the compose image, labels it, prunes older ones and writes the override', (t) => {
  const ref = 'marxx/ai-dev-workflow:node-latest';
  const tag = layerTag(BASE_ID, 'FROM x\n', '{}\n');
  const { calls, logs, opts } = setup(t, [
    [isConfig, configJson({ image: ref })], ...images(ref), baseInspect(ref), layerMissing,
    [is('image', 'ls'), { status: 0, stdout: `${tag}\nadw-e2e:000000000000\n` }],
  ]);
  const out = ensureE2eImage(opts);
  assert.deepEqual(out, { image: ref, imageId: BASE_ID, tag, overrideFile: path.join(opts.runDir, 'compose.adw-e2e.yml') });
  const build = calls.find((c) => c.args[0] === 'build');
  // BuildKit reads `FROM sha256:…` as a Docker Hub repository: the base goes in by name, its ID only into the tag.
  assert.deepEqual(build.args, ['build', '--build-arg', `BASE_IMAGE=${ref}`, '--build-arg', 'BASE_USER=root',
    '--label', 'adw.e2e.root=/proj', '-t', tag, opts.imageDir]);
  assert.equal(build.opts.stdio, 'inherit');
  assert.ok(logs.some((l) => l.includes(`building the e2e layer on ${ref}`)));
  assert.deepEqual(calls.find((c) => is('image', 'ls')(c.args)).args, ['image', 'ls', '--filter', 'label=adw.e2e.root=/proj', '--format', '{{.Repository}}:{{.Tag}}']);
  assert.deepEqual(calls.filter((c) => is('image', 'rm')(c.args)).map((c) => c.args), [['image', 'rm', 'adw-e2e:000000000000']]);
  assert.equal(readFileSync(out.overrideFile, 'utf8'), overrideYaml(tag));
  assert.ok(!calls.some((c) => c.args[0] === 'pull'), 'present locally: no pull');
});

test('skips build and prune when the layer exists', (t) => {
  const ref = 'img:1';
  const { calls, opts } = setup(t, [[isConfig, configJson({ image: ref })], ...images(ref), baseInspect(ref)]);
  ensureE2eImage(opts);
  assert.ok(!calls.some((c) => c.args[0] === 'build' || is('image', 'ls')(c.args)));
});

test('a compose build: section is built first and its image is the base', (t) => {
  const ref = 'adw-e2e-image-ai-dev-workflow';
  const { calls, opts } = setup(t, [
    [isConfig, configJson({ build: { context: '/proj' } })], ...images(ref), baseInspect(ref), layerMissing,
  ]);
  ensureE2eImage(opts);
  const i = calls.findIndex((c) => c.args.includes('build') && c.args.includes('ai-dev-workflow') && c.args[0] === 'compose');
  assert.ok(i >= 0, 'compose build ai-dev-workflow');
  assert.ok(i < calls.findIndex((c) => c.args[0] === 'build'), 'before the layer build');
});

test('pulls the base image only when it is missing', (t) => {
  const ref = 'img:2';
  let pulled = false;
  const { calls, opts } = setup(t, [
    [isConfig, configJson({ image: ref })], ...images(ref),
    [(a) => is('pull')(a), { status: 0, stdout: '' }],
    [(a) => is('image', 'inspect')(a) && a.at(-1) === ref && !pulled && (pulled = true), { status: 1, stdout: '', stderr: 'No such image' }],
    baseInspect(ref), layerMissing,
  ]);
  ensureE2eImage(opts);
  assert.deepEqual(calls.find((c) => c.args[0] === 'pull').args, ['pull', ref]);
});

test('every compose call uses the given files, so the certs overlay is honoured', (t) => {
  const ref = 'img:3';
  const { calls, opts } = setup(t, [[isConfig, configJson({ image: ref })], ...images(ref), baseInspect(ref)]);
  ensureE2eImage({ ...opts, composeFiles: ['/proj/compose.ai-dev.yml', '/proj/compose.ai-dev.certs.yml'] });
  for (const c of calls.filter((x) => x.args[0] === 'compose')) {
    assert.deepEqual(c.args.slice(0, 5), ['compose', '-f', '/proj/compose.ai-dev.yml', '-f', '/proj/compose.ai-dev.certs.yml']);
    assert.equal(c.opts.env.PROJECT_ROOT, '/proj');
  }
});

test('a failed build throws before any override is written', (t) => {
  const ref = 'img:4';
  const { opts } = setup(t, [
    [isConfig, configJson({ image: ref })], ...images(ref), baseInspect(ref), layerMissing,
    [is('build'), { status: 1, stdout: null, stderr: null }],
  ]);
  assert.throws(() => ensureE2eImage(opts), /docker build failed \(exit 1\)/);
});

test('overrideYaml replaces the image and drops the build section', () => {
  assert.equal(overrideYaml('adw-e2e:abc'), [
    '# Written by adw e2e: the agent runs on the e2e layer over the project\'s dev image.',
    'services:', '  ai-dev-workflow:', '    image: adw-e2e:abc', '    pull_policy: never', '    build: !reset null', '',
  ].join('\n'));
});

test('the layer restores the base image user', (t) => {
  const ref = 'proj/ai-dev:1';
  const { calls, opts } = setup(t, [
    [isConfig, configJson({ image: ref })], ...images(ref),
    [(a) => is('image', 'inspect')(a) && a.at(-1) === ref, { status: 0, stdout: `${BASE_ID} {"Env":[],"User":"dev"}\n` }], layerMissing,
  ]);
  const out = ensureE2eImage(opts);
  assert.equal(out.imageId, BASE_ID);
  assert.ok(calls.find((c) => c.args[0] === 'build').args.includes('BASE_USER=dev'));
});

test('proxies go to the build by name, company certificates as the certs build context', (t) => {
  const ref = 'img:5';
  const { calls, opts } = setup(t, [[isConfig, configJson({ image: ref })], ...images(ref), baseInspect(ref), layerMissing]);
  const env = { PROJECT_ROOT: '/proj', HTTPS_PROXY: 'http://user:secret@proxy:3128', no_proxy: 'localhost', AGENT_CA_DIR: '/etc/company-ca' };
  ensureE2eImage({ ...opts, env });
  const build = calls.find((c) => c.args[0] === 'build');
  const pairs = build.args.flatMap((a, i) => (a === '--build-arg' || a === '--build-context' ? [`${a} ${build.args[i + 1]}`] : []));
  assert.deepEqual(pairs.filter((p) => !p.includes('BASE_')), ['--build-arg HTTPS_PROXY', '--build-arg no_proxy', '--build-context certs=/etc/company-ca']);
  assert.ok(!build.args.some((a) => a.includes('secret')), 'proxy values never reach argv');
  assert.equal(build.opts.env, env);
});
