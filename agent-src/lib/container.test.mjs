// Container setup written by `init`: stack detection, Compose slug, template rendering, the
// write-once file I/O and the next-steps printout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { STACKS, detectStack, composeSlug, renderContainerFiles, ensureLine, setEnvVar, writeContainerFiles, nextSteps, containerWarnings } from './container.mjs';
import { makeTmpRoot } from '../test-helpers.mjs';

const IMAGES = {
  node: 'marxx/ai-dev-workflow:node-latest',
  dotnet: 'marxx/ai-dev-workflow:dotnet-latest',
  generic: 'marxx/ai-dev-workflow:latest',
};

const fileOf = (files, p) => files.find((f) => f.path === p);

test('detectStack: package.json → node, *.csproj/*.sln/*.slnx → dotnet, both → dotnet, neither → generic', () => {
  const cases = [
    [['package.json'], 'node'],
    [['App.csproj'], 'dotnet'],
    [['App.sln'], 'dotnet'],
    [['App.slnx'], 'dotnet'],
    [['package.json', 'App.sln'], 'dotnet'],
    [['README.md'], 'generic'],
  ];
  for (const [entries, expected] of cases) {
    const { root, cleanup } = makeTmpRoot();
    try {
      for (const e of entries) fs.writeFileSync(path.join(root, e), '');
      assert.equal(detectStack(root), expected, entries.join(','));
    } finally {
      cleanup();
    }
  }
});

test('composeSlug lowercases and dashes runs of invalid chars', () => {
  assert.equal(composeSlug('My Cool_App 2'), 'my-cool_app-2');
  assert.equal(composeSlug('  --Foo..Bar--  '), 'foo-bar');
  assert.equal(composeSlug('!!!'), 'project');
  assert.equal(composeSlug('Ünïcode'), 'n-code');
});

for (const stack of STACKS) {
  test(`renderContainerFiles(${stack}) sets name, image and the node volume only for node`, () => {
    const compose = fileOf(renderContainerFiles({ name: 'Demo', stack, backend: 'file' }), 'compose.ai-dev.yml').content;
    assert.match(compose, /^name: demo-ai$/m);
    assert.ok(compose.includes(`\${AGENT_IMAGE:-${IMAGES[stack]}}`), 'image default');
    assert.equal(compose.includes('target: /workspace/node_modules'), stack === 'node');
    assert.equal(/^ {2}deps-node-modules:$/m.test(compose), stack === 'node');
    assert.doesNotMatch(compose, /^[ \t]+$/m, 'a removed placeholder left a whitespace-only line');
  });
}

for (const backend of ['file', 'github', 'gitea', 'azure-devops']) {
  test(`AI-DEV.md for ${backend} carries only that backend's login`, () => {
    const files = renderContainerFiles({ name: 'Demo', stack: 'generic', backend, giteaLogin: 'myserver' });
    const doc = fileOf(files, 'AI-DEV.md').content;
    assert.equal(doc.includes('gh auth setup-git'), backend === 'github');
    assert.equal(doc.includes('tea login add'), backend === 'gitea');
    assert.equal(doc.includes('myserver'), backend === 'gitea');
    assert.equal(doc.includes('az login --use-device-code'), backend === 'azure-devops');
    assert.ok(doc.includes('git ls-remote origin'));
    assert.ok(doc.includes('docker volume rm demo-ai_agent-home'));
  });
}

test('renderContainerFiles returns the seven files in order, no placeholder left, ai-dev.sh executable', () => {
  for (const stack of STACKS) {
    for (const backend of ['file', 'github', 'gitea', 'azure-devops']) {
      const files = renderContainerFiles({ name: 'Demo', stack, backend, giteaLogin: 'x' });
      assert.deepEqual(files.map((f) => f.path),
        ['compose.ai-dev.yml', 'compose.ai-dev.certs.yml', 'compose.ai-dev.dind.yml', 'compose.ai-dev.dind-certs.yml',
          'ai-dev.sh', 'ai-dev.ps1', 'AI-DEV.md']);
      for (const f of files) assert.doesNotMatch(f.content, /@@[A-Z_]+@@/, `${stack}/${backend}: ${f.path}`);
      assert.equal(fileOf(files, 'ai-dev.sh').mode, 0o755);
      assert.equal(fileOf(files, 'ai-dev.ps1').mode, undefined);
    }
  }
});

const OPTS = { name: 'Demo', stack: 'node', backend: 'github' };

test('writeContainerFiles writes all files into an empty root', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    const { written, skipped } = writeContainerFiles(root, OPTS);
    assert.deepEqual(written, ['compose.ai-dev.yml', 'compose.ai-dev.certs.yml', 'compose.ai-dev.dind.yml',
      'compose.ai-dev.dind-certs.yml', 'ai-dev.sh', 'ai-dev.ps1', 'AI-DEV.md', '.gitignore', '.gitattributes']);
    assert.deepEqual(skipped, []);
    assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), '.env.ai-dev\n');
    assert.equal(fs.readFileSync(path.join(root, '.gitattributes'), 'utf8'), 'ai-dev.sh text eol=lf\n');
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(path.join(root, 'ai-dev.sh')).mode & 0o777, 0o755);
    }
  } finally {
    cleanup();
  }
});

test('writeContainerFiles leaves existing files untouched and reports them', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    fs.writeFileSync(path.join(root, 'compose.ai-dev.yml'), 'mine');
    fs.writeFileSync(path.join(root, '.gitignore'), '.env.ai-dev\n');
    const { written, skipped } = writeContainerFiles(root, OPTS);
    assert.equal(fs.readFileSync(path.join(root, 'compose.ai-dev.yml'), 'utf8'), 'mine');
    assert.deepEqual(skipped, ['compose.ai-dev.yml']);
    assert.ok(!written.includes('compose.ai-dev.yml'));
    assert.ok(!written.includes('.gitignore'), 'an unchanged .gitignore is not reported as written');
  } finally {
    cleanup();
  }
});

test('ensureLine appends once, on its own line, and creates missing files', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    const file = path.join(root, '.gitignore');
    fs.writeFileSync(file, 'node_modules');
    assert.equal(ensureLine(file, '.env.ai-dev'), true);
    assert.equal(fs.readFileSync(file, 'utf8'), 'node_modules\n.env.ai-dev\n');
    assert.equal(ensureLine(file, '.env.ai-dev'), false);
    assert.equal(fs.readFileSync(file, 'utf8'), 'node_modules\n.env.ai-dev\n');

    fs.writeFileSync(file, 'a\r\n  .env.ai-dev  \r\n');
    assert.equal(ensureLine(file, '.env.ai-dev'), false);

    const fresh = path.join(root, 'new-file');
    assert.equal(ensureLine(fresh, 'x'), true);
    assert.equal(fs.readFileSync(fresh, 'utf8'), 'x\n');
  } finally {
    cleanup();
  }
});

test('setEnvVar adds KEY=value once and never overrides an existing assignment', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    const file = path.join(root, '.env.ai-dev');
    assert.equal(setEnvVar(file, 'AGENT_DIND', '1'), true);
    assert.equal(setEnvVar(file, 'AGENT_CA_DIR', ''), true);
    assert.equal(fs.readFileSync(file, 'utf8'), 'AGENT_DIND=1\nAGENT_CA_DIR=\n');
    assert.equal(setEnvVar(file, 'AGENT_CA_DIR', '/certs'), false);
    assert.equal(fs.readFileSync(file, 'utf8'), 'AGENT_DIND=1\nAGENT_CA_DIR=\n');

    fs.writeFileSync(file, '# AGENT_DIND=1\r\nexport AGENT_CA_DIR=/x');
    assert.equal(setEnvVar(file, 'AGENT_CA_DIR', '/y'), false, 'an export-prefixed assignment counts');
    assert.equal(setEnvVar(file, 'AGENT_DIND', '1'), true, 'a commented-out assignment does not count');
    assert.equal(fs.readFileSync(file, 'utf8'), '# AGENT_DIND=1\r\nexport AGENT_CA_DIR=/x\nAGENT_DIND=1\n');
  } finally {
    cleanup();
  }
});

test('writeContainerFiles writes the requested settings into .env.ai-dev and reports kept ones', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    fs.writeFileSync(path.join(root, '.env.ai-dev'), 'AGENT_CA_DIR=/mine\n');
    const { written, kept } = writeContainerFiles(root, { ...OPTS, env: { AGENT_DIND: '1', AGENT_CA_DIR: '' } });
    assert.equal(fs.readFileSync(path.join(root, '.env.ai-dev'), 'utf8'), 'AGENT_CA_DIR=/mine\nAGENT_DIND=1\n');
    assert.ok(written.includes('.env.ai-dev'));
    assert.deepEqual(kept, ['AGENT_CA_DIR']);
  } finally {
    cleanup();
  }
});

test('writeContainerFiles without settings creates no .env.ai-dev', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    const { kept } = writeContainerFiles(root, OPTS);
    assert.ok(!fs.existsSync(path.join(root, '.env.ai-dev')));
    assert.deepEqual(kept, []);
  } finally {
    cleanup();
  }
});

test('nextSteps lists the versioned generate command and the backend login, numbered without gaps', () => {
  const steps = (text) => text.split('\n').map((l) => l.match(/^ {2}(\d+)\. /)?.[1]).filter(Boolean).map(Number);

  const github = nextSteps({ backend: 'github', version: '1.2.3' });
  assert.match(github, /^ {2}1\. npx @strobl_dev\/adw@1\.2\.3 generate/m);
  assert.ok(github.includes('./ai-dev.sh gh auth login && ./ai-dev.sh gh auth setup-git'));
  assert.deepEqual(steps(github), [1, 2, 3, 4, 5, 6]);
  assert.ok(github.includes('AI-DEV.md'));
  assert.ok(github.includes('.\\ai-dev.ps1'));

  assert.ok(nextSteps({ backend: 'gitea', version: '1' }).includes('./ai-dev.sh tea login add'));
  assert.ok(nextSteps({ backend: 'azure-devops', version: '1' }).includes('./ai-dev.sh az login --use-device-code --allow-no-subscriptions'));

  const file = nextSteps({ backend: 'file', version: '1' });
  assert.doesNotMatch(file, /gh auth|tea login|az login/);
  assert.deepEqual(steps(file), [1, 2, 3, 4, 5]);
});

test('composeSlug never starts with an underscore (Compose rejects it)', () => {
  assert.equal(composeSlug('_internal'), 'internal');
  assert.equal(composeSlug('-_x'), 'x');
});

test('composeSlug falls back to the next candidate before the shared "project" default', () => {
  assert.equal(composeSlug('日本', 'My Repo'), 'my-repo');
  assert.equal(composeSlug('日本', '日本'), 'project');
});

test('writeContainerFiles names a non-Latin project after its directory, not the shared fallback', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeContainerFiles(root, { name: 'Проект', stack: 'generic', backend: 'file' });
    const compose = fs.readFileSync(path.join(root, 'compose.ai-dev.yml'), 'utf8');
    assert.match(compose, new RegExp(`^name: ${composeSlug(path.basename(root))}-ai$`, 'm'));
    assert.doesNotMatch(compose, /^name: project-ai$/m);
  } finally {
    cleanup();
  }
});

test('nextSteps prefixes every container command with the launcher', () => {
  const text = nextSteps({ backend: 'file', version: '1' });
  assert.ok(text.includes('./ai-dev.sh codex login --device-auth'));
  assert.ok(text.includes('./ai-dev.sh opencode auth login'));
});

// Runs ai-dev.sh against a fake `docker` on PATH that logs one line per call (AGENT_IMAGE, then
// the arguments, NUL separated) and fails `pull` when FAKE_PULL_FAILS=1. Returns each call's
// arguments with its AGENT_IMAGE, and the stderr.
function runLauncher(env = {}, dotenv) {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeContainerFiles(root, OPTS);
    if (dotenv) fs.writeFileSync(path.join(root, '.env.ai-dev'), dotenv);
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    const log = path.join(root, 'docker.log');
    fs.writeFileSync(path.join(bin, 'docker'), [
      '#!/bin/sh',
      `printf '%s\\0' "\${AGENT_IMAGE:-}" "$@" >> '${log}'`,
      `printf '\\n' >> '${log}'`,
      'for a; do [ "$a" = pull ] && [ "${FAKE_PULL_FAILS:-}" = 1 ] && exit 1; done',
      'exit 0',
      '',
    ].join('\n'), { mode: 0o755 });
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^AGENT_(DIND|CA_DIR)$/.test(k)));
    const result = spawnSync('sh', [path.join(root, 'ai-dev.sh'), 'true'],
      { env: { ...clean, ...env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
    const calls = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)
      .map((line) => line.split('\0').slice(0, -1).map((a) => (path.isAbsolute(a) ? path.relative(root, a) : a)))
      .map(([image, ...args]) => Object.assign(args, { image }));
    return { status: result.status, stderr: result.stderr, calls };
  } finally {
    cleanup();
  }
}

// The launcher's compose files for the run.
function launcherFiles(env, dotenv) {
  const { status, stderr, calls } = runLauncher(env, dotenv);
  assert.equal(status, 0, stderr);
  const args = calls.at(-1);
  assert.deepEqual(args.slice(-4), ['run', '--rm', 'ai-dev-workflow', 'true']);
  return args.flatMap((a, i) => (args[i - 1] === '-f' ? [a] : []));
}

test('ai-dev.sh adds the dind overlay only for AGENT_DIND=1, and its certs companion with AGENT_CA_DIR', { skip: process.platform === 'win32' }, () => {
  assert.deepEqual(launcherFiles({}), ['compose.ai-dev.yml']);
  assert.deepEqual(launcherFiles({ AGENT_DIND: '0' }), ['compose.ai-dev.yml']);
  assert.deepEqual(launcherFiles({ AGENT_CA_DIR: '/certs' }), ['compose.ai-dev.yml', 'compose.ai-dev.certs.yml']);
  assert.deepEqual(launcherFiles({ AGENT_DIND: '1' }), ['compose.ai-dev.yml', 'compose.ai-dev.dind.yml']);
  assert.deepEqual(launcherFiles({}, 'AGENT_DIND=1\nAGENT_CA_DIR=/certs\n'),
    ['compose.ai-dev.yml', 'compose.ai-dev.certs.yml', 'compose.ai-dev.dind.yml', 'compose.ai-dev.dind-certs.yml']);
});

test('ai-dev.sh pulls the configured image with the same compose files before the run', { skip: process.platform === 'win32' }, () => {
  const { status, stderr, calls } = runLauncher({}, 'AGENT_DIND=1\nAGENT_IMAGE=example/agent:dated\n');
  assert.equal(status, 0, stderr);
  assert.equal(calls.length, 2);
  const [pull, run] = calls;
  assert.deepEqual(pull.slice(-2), ['pull', 'ai-dev-workflow']);
  assert.deepEqual(pull.slice(0, -2), run.slice(0, -4), 'same compose files for pull and run');
  assert.ok(pull.includes('compose.ai-dev.dind.yml'));
  assert.equal(pull.image, 'example/agent:dated', '.env.ai-dev reaches the pull');
});

test('ai-dev.sh starts the local image with a warning when the pull fails', { skip: process.platform === 'win32' }, () => {
  const { status, stderr, calls } = runLauncher({ FAKE_PULL_FAILS: '1' });
  assert.equal(status, 0, stderr);
  assert.deepEqual(calls.map((c) => c.find((a) => a === 'pull' || a === 'run')), ['pull', 'run']);
  assert.match(stderr, /could not pull/i);
});

test('AI-DEV.md explains the opt-in daemon and how to stop it for this project', () => {
  const doc = fileOf(renderContainerFiles({ name: 'Demo', stack: 'generic', backend: 'file' }), 'AI-DEV.md').content;
  assert.ok(doc.includes('AGENT_DIND=1'));
  assert.ok(doc.includes('docker compose -p demo-ai down'));
});

// v0.29.0 and earlier wrote compose.ai-dev.yml without KILL: the root init (tini) cannot signal
// the dev user's processes and stops the container on the first forwarded signal.
const LEGACY_CAPS = `    cap_drop:
      - ALL
    # Root setup remaps dev and owns its home, then drops privileges.
    cap_add:
      - CHOWN
      - DAC_OVERRIDE
      - FOWNER
      - SETUID
      - SETGID
`;

test('containerWarnings flags a compose.ai-dev.yml that drops all capabilities without KILL', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    fs.writeFileSync(path.join(root, 'compose.ai-dev.yml'), `services:\n  ai-dev-workflow:\n    init: true\n${LEGACY_CAPS}`);
    const [warning, ...rest] = containerWarnings(root);
    assert.deepEqual(rest, []);
    assert.match(warning, /compose\.ai-dev\.yml/);
    assert.match(warning, /- KILL/);
  } finally {
    cleanup();
  }
});

test('containerWarnings is silent for the current template, without the file, and when caps are not dropped', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    assert.deepEqual(containerWarnings(root), [], 'no compose.ai-dev.yml');
    writeContainerFiles(root, OPTS);
    assert.deepEqual(containerWarnings(root), [], 'freshly written template');
    const file = path.join(root, 'compose.ai-dev.yml');
    fs.writeFileSync(file, LEGACY_CAPS.replace('      - FOWNER\n', '      - FOWNER\n      - CAP_KILL\n'));
    assert.deepEqual(containerWarnings(root), [], 'CAP_KILL spelling');
    fs.writeFileSync(file, '    cap_drop: [ALL]\n    cap_add: [CHOWN, "KILL", SETUID]\n');
    assert.deepEqual(containerWarnings(root), [], 'flow-style list');
    fs.writeFileSync(file, 'services:\n  ai-dev-workflow:\n    init: true\n');
    assert.deepEqual(containerWarnings(root), [], 'no cap_drop: nothing to restore');
  } finally {
    cleanup();
  }
});

test('containerWarnings ignores KILL that only appears in a comment', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    fs.writeFileSync(path.join(root, 'compose.ai-dev.yml'), `    # KILL lets tini forward signals\n${LEGACY_CAPS}`);
    assert.equal(containerWarnings(root).length, 1);
  } finally {
    cleanup();
  }
});

test('containerWarnings flags launchers written before they pulled the image', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeContainerFiles(root, OPTS);
    fs.writeFileSync(path.join(root, 'ai-dev.sh'), '#!/bin/sh\n# docker compose pull is not run here\nexec docker compose -f compose.ai-dev.yml run --rm ai-dev-workflow "$@"\n');
    fs.writeFileSync(path.join(root, 'ai-dev.ps1'), "& docker compose run --rm ai-dev-workflow @args\n");
    const [warning, ...rest] = containerWarnings(root);
    assert.deepEqual(rest, []);
    assert.match(warning, /ai-dev\.sh and ai-dev\.ps1/);
    assert.match(warning, /init/);
    fs.rmSync(path.join(root, 'ai-dev.sh'));
    assert.match(containerWarnings(root)[0], /^Note: ai-dev\.ps1 does not/);
  } finally {
    cleanup();
  }
});

test('containerWarnings is silent for the current launchers', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeContainerFiles(root, OPTS);
    assert.deepEqual(containerWarnings(root), []);
    fs.rmSync(path.join(root, 'ai-dev.ps1'));
    assert.deepEqual(containerWarnings(root), [], 'a removed launcher needs no fix');
  } finally {
    cleanup();
  }
});
