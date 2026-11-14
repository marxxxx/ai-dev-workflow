// Container setup written by `init`: stack detection, Compose slug, template rendering, the
// write-once file I/O and the next-steps printout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { STACKS, detectStack, composeSlug, renderContainerFiles, ensureLine, setEnvVar, replaceLine, writeContainerFiles, nextSteps, containerWarnings } from './container.mjs';
import { makeTmpRoot } from '../test-helpers.mjs';
import { LAUNCHERS } from './constants.mjs';

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
    const compose = fileOf(renderContainerFiles({ name: 'Demo', stack, backend: 'file' }), '.adw/compose.yml').content;
    assert.match(compose, /^name: demo-ai$/m);
    assert.ok(compose.includes(`\${AGENT_IMAGE:-${IMAGES[stack]}}`), 'image default');
    assert.equal(compose.includes('target: /workspace/node_modules'), stack === 'node');
    assert.equal(/^ {2}deps-node-modules:$/m.test(compose), stack === 'node');
    assert.doesNotMatch(compose, /^[ \t]+$/m, 'a removed placeholder left a whitespace-only line');
  });
}

for (const backend of ['file', 'github', 'gitea', 'azure-devops']) {
  test(`.adw/README.md for ${backend} carries only that backend's login`, () => {
    const files = renderContainerFiles({ name: 'Demo', stack: 'generic', backend, giteaLogin: 'myserver' });
    const doc = fileOf(files, '.adw/README.md').content;
    assert.equal(doc.includes('gh auth setup-git'), backend === 'github');
    assert.equal(doc.includes('tea login add'), backend === 'gitea');
    assert.equal(doc.includes('myserver'), backend === 'gitea');
    assert.equal(doc.includes('az login --use-device-code'), backend === 'azure-devops');
    assert.ok(doc.includes('git ls-remote origin'));
    assert.ok(doc.includes('docker volume rm demo-ai_agent-home'));
  });
}

test('renderContainerFiles returns the seven files under .adw/ and the root launchers, no placeholder left, adw.sh executable', () => {
  for (const stack of STACKS) {
    for (const backend of ['file', 'github', 'gitea', 'azure-devops']) {
      const files = renderContainerFiles({ name: 'Demo', stack, backend, giteaLogin: 'x' });
      assert.deepEqual(files.map((f) => f.path),
        ['.adw/compose.yml', '.adw/compose.certs.yml', '.adw/compose.dind.yml', '.adw/compose.dind-certs.yml',
          'adw.sh', 'adw.ps1', '.adw/README.md']);
      for (const f of files) assert.doesNotMatch(f.content, /@@[A-Z_]+@@/, `${stack}/${backend}: ${f.path}`);
      for (const f of files) {
        // Only the launchers name the old env file, to tell a leftover one to move.
        const content = [LAUNCHERS.sh, LAUNCHERS.ps1].includes(f.path)
          ? f.content.split('\n').filter((l) => !/\.env\.ai-dev/.test(l)).join('\n') : f.content;
        assert.doesNotMatch(content, /ai-dev\.sh|ai-dev\.ps1|AI-DEV\.md|compose\.ai-dev|\.env\.ai-dev|ai-project\.json/, `${stack}/${backend}: ${f.path}`);
      }
      assert.equal(fileOf(files, 'adw.sh').mode, 0o755);
      assert.equal(fileOf(files, 'adw.ps1').mode, undefined);
    }
  }
});

const OPTS = { name: 'Demo', stack: 'node', backend: 'github' };

test('writeContainerFiles writes all files into an empty root', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    const { written, skipped } = writeContainerFiles(root, OPTS);
    assert.deepEqual(written, ['.adw/compose.yml', '.adw/compose.certs.yml', '.adw/compose.dind.yml',
      '.adw/compose.dind-certs.yml', 'adw.sh', 'adw.ps1', '.adw/README.md', '.gitignore', '.gitattributes']);
    assert.deepEqual(skipped, []);
    assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), '.adw/.env\n');
    assert.equal(fs.readFileSync(path.join(root, '.gitattributes'), 'utf8'), 'adw.sh text eol=lf\n');
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(path.join(root, 'adw.sh')).mode & 0o777, 0o755);
    }
  } finally {
    cleanup();
  }
});

test('writeContainerFiles leaves existing files untouched and reports them', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeCompose(root, 'mine');
    fs.writeFileSync(path.join(root, '.gitignore'), '.adw/.env\n');
    const { written, skipped } = writeContainerFiles(root, OPTS);
    assert.equal(fs.readFileSync(path.join(root, '.adw/compose.yml'), 'utf8'), 'mine');
    assert.deepEqual(skipped, ['.adw/compose.yml']);
    assert.ok(!written.includes('.adw/compose.yml'));
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
    assert.equal(ensureLine(file, '.adw/.env'), true);
    assert.equal(fs.readFileSync(file, 'utf8'), 'node_modules\n.adw/.env\n');
    assert.equal(ensureLine(file, '.adw/.env'), false);
    assert.equal(fs.readFileSync(file, 'utf8'), 'node_modules\n.adw/.env\n');

    fs.writeFileSync(file, 'a\r\n  .adw/.env  \r\n');
    assert.equal(ensureLine(file, '.adw/.env'), false);

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
    const file = path.join(root, '.adw/.env');
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

test('writeContainerFiles writes the requested settings into .adw/.env and reports kept ones', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    fs.mkdirSync(path.join(root, '.adw'));
    fs.writeFileSync(path.join(root, '.adw/.env'), 'AGENT_CA_DIR=/mine\n');
    const { written, kept } = writeContainerFiles(root, { ...OPTS, env: { AGENT_DIND: '1', AGENT_CA_DIR: '' } });
    assert.equal(fs.readFileSync(path.join(root, '.adw/.env'), 'utf8'), 'AGENT_CA_DIR=/mine\nAGENT_DIND=1\n');
    assert.ok(written.includes('.adw/.env'));
    assert.deepEqual(kept, ['AGENT_CA_DIR']);
  } finally {
    cleanup();
  }
});

test('writeContainerFiles without settings creates no .adw/.env', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    const { kept } = writeContainerFiles(root, OPTS);
    assert.ok(!fs.existsSync(path.join(root, '.adw/.env')));
    assert.deepEqual(kept, []);
  } finally {
    cleanup();
  }
});

test('nextSteps lists the versioned generate command and the backend login, numbered without gaps', () => {
  const steps = (text) => text.split('\n').map((l) => l.match(/^ {2}(\d+)\. /)?.[1]).filter(Boolean).map(Number);

  const github = nextSteps({ backend: 'github', version: '1.2.3' });
  assert.match(github, /^ {2}1\. npx @strobl_dev\/adw@1\.2\.3 generate/m);
  assert.ok(github.includes('./adw.sh gh auth login && ./adw.sh gh auth setup-git'));
  assert.deepEqual(steps(github), [1, 2, 3, 4, 5, 6]);
  assert.ok(github.includes('.adw/README.md'));
  assert.ok(github.includes('.\\adw.ps1'));
  assert.ok(github.includes('Commit .adw/, adw.sh, adw.ps1 and the generated dirs.'));
  assert.ok(github.includes('Details: .adw/README.md'));

  assert.ok(nextSteps({ backend: 'gitea', version: '1' }).includes('./adw.sh tea login add'));
  assert.ok(nextSteps({ backend: 'azure-devops', version: '1' }).includes('./adw.sh az login --use-device-code --allow-no-subscriptions'));

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
    const compose = fs.readFileSync(path.join(root, '.adw/compose.yml'), 'utf8');
    assert.match(compose, new RegExp(`^name: ${composeSlug(path.basename(root))}-ai$`, 'm'));
    assert.doesNotMatch(compose, /^name: project-ai$/m);
  } finally {
    cleanup();
  }
});

test('nextSteps prefixes every container command with the launcher', () => {
  const text = nextSteps({ backend: 'file', version: '1' });
  assert.ok(text.includes('./adw.sh codex login --device-auth'));
  assert.ok(text.includes('./adw.sh opencode auth login'));
});

// Runs adw.sh against a fake `docker` on PATH that logs one line per call (AGENT_IMAGE, then
// the arguments, NUL separated) and fails `pull` when FAKE_PULL_FAILS=1. Returns each call's
// arguments with its AGENT_IMAGE, and the stderr.
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^AGENT_(DIND|CA_DIR)$/.test(k)));

function fakeDocker(root) {
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
  return { bin, log };
}

function runLauncher(env = {}, dotenv, legacyDotenv) {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeContainerFiles(root, OPTS);
    if (dotenv) fs.writeFileSync(path.join(root, '.adw/.env'), dotenv);
    if (legacyDotenv) fs.writeFileSync(path.join(root, '.env.ai-dev'), legacyDotenv);
    const { bin, log } = fakeDocker(root);
    const result = spawnSync('sh', [path.join(root, 'adw.sh'), 'true'],
      { env: { ...cleanEnv(), ...env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
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

test('adw.sh adds the dind overlay only for AGENT_DIND=1, and its certs companion with AGENT_CA_DIR', { skip: process.platform === 'win32' }, () => {
  assert.deepEqual(launcherFiles({}), ['.adw/compose.yml']);
  assert.deepEqual(launcherFiles({ AGENT_DIND: '0' }), ['.adw/compose.yml']);
  assert.deepEqual(launcherFiles({ AGENT_CA_DIR: '/certs' }), ['.adw/compose.yml', '.adw/compose.certs.yml']);
  assert.deepEqual(launcherFiles({ AGENT_DIND: '1' }), ['.adw/compose.yml', '.adw/compose.dind.yml']);
  assert.deepEqual(launcherFiles({}, 'AGENT_DIND=1\nAGENT_CA_DIR=/certs\n'),
    ['.adw/compose.yml', '.adw/compose.certs.yml', '.adw/compose.dind.yml', '.adw/compose.dind-certs.yml']);
});

test('adw.sh pulls the configured image with the same compose files before the run', { skip: process.platform === 'win32' }, () => {
  const { status, stderr, calls } = runLauncher({}, 'AGENT_DIND=1\nAGENT_IMAGE=example/agent:dated\n');
  assert.equal(status, 0, stderr);
  assert.equal(calls.length, 2);
  const [pull, run] = calls;
  assert.deepEqual(pull.slice(-2), ['pull', 'ai-dev-workflow']);
  assert.deepEqual(pull.slice(0, -2), run.slice(0, -4), 'same compose files for pull and run');
  assert.ok(pull.includes('.adw/compose.dind.yml'));
  assert.equal(pull.image, 'example/agent:dated', '.adw/.env reaches the pull');
});

test('adw.sh starts the local image with a warning when the pull fails', { skip: process.platform === 'win32' }, () => {
  const { status, stderr, calls } = runLauncher({ FAKE_PULL_FAILS: '1' });
  assert.equal(status, 0, stderr);
  assert.deepEqual(calls.map((c) => c.find((a) => a === 'pull' || a === 'run')), ['pull', 'run']);
  assert.match(stderr, /could not pull/i);
});

test('.adw/README.md explains the opt-in daemon and how to stop it for this project', () => {
  const doc = fileOf(renderContainerFiles({ name: 'Demo', stack: 'generic', backend: 'file' }), '.adw/README.md').content;
  assert.ok(doc.includes('AGENT_DIND=1'));
  assert.ok(doc.includes('docker compose -p demo-ai down'));
});

// v0.29.0 and earlier wrote .adw/compose.yml without KILL: the root init (tini) cannot signal
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

const writeCompose = (root, content) => {
  fs.mkdirSync(path.join(root, '.adw'), { recursive: true });
  fs.writeFileSync(path.join(root, '.adw/compose.yml'), content);
};

test('containerWarnings flags a .adw/compose.yml that drops all capabilities without KILL', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeCompose(root, `services:\n  ai-dev-workflow:\n    init: true\n${LEGACY_CAPS}`);
    const [warning, ...rest] = containerWarnings(root);
    assert.deepEqual(rest, []);
    assert.match(warning, /\.adw\/compose\.yml/);
    assert.match(warning, /- KILL/);
  } finally {
    cleanup();
  }
});

test('containerWarnings is silent for the current template, without the file, and when caps are not dropped', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    assert.deepEqual(containerWarnings(root), [], 'no .adw/compose.yml');
    writeContainerFiles(root, OPTS);
    assert.deepEqual(containerWarnings(root), [], 'freshly written template');
    const file = path.join(root, '.adw/compose.yml');
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
    writeCompose(root, `    # KILL lets tini forward signals\n${LEGACY_CAPS}`);
    assert.equal(containerWarnings(root).length, 1);
  } finally {
    cleanup();
  }
});

test('the README shows the manual compose command with --project-directory', () => {
  const readme = fileOf(renderContainerFiles({ name: 'Demo', stack: 'generic', backend: 'file' }), '.adw/README.md').content;
  assert.ok(readme.includes('--project-directory . -f .adw/compose.yml'));
});

test('renderContainerFiles uses an explicit slug', () => {
  const readme = fileOf(renderContainerFiles({ name: 'Demo', stack: 'generic', backend: 'file', slug: 'legacy' }), '.adw/README.md').content;
  assert.ok(readme.includes('legacy-ai_agent-home'));
});

test('writeContainerFiles ignores .adw/.env, marks adw.sh as LF and puts settings into .adw/.env', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeContainerFiles(root, { ...OPTS, env: { AGENT_DIND: '1' } });
    assert.ok(fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split('\n').includes('.adw/.env'));
    assert.ok(fs.readFileSync(path.join(root, '.gitattributes'), 'utf8').split('\n').includes('adw.sh text eol=lf'));
    assert.equal(fs.readFileSync(path.join(root, '.adw/.env'), 'utf8'), 'AGENT_DIND=1\n');
    assert.ok(!fs.existsSync(path.join(root, '.env.ai-dev')));
  } finally {
    cleanup();
  }
});

test('replaceLine swaps one trimmed line and reports whether it changed', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    const file = path.join(root, '.gitattributes');
    fs.writeFileSync(file, 'a\r\n  ai-dev.sh text eol=lf  \r\nb\r\n');
    assert.equal(replaceLine(file, 'ai-dev.sh text eol=lf', 'adw.sh text eol=lf'), true);
    assert.equal(fs.readFileSync(file, 'utf8'), 'a\r\nadw.sh text eol=lf\r\nb\r\n');
    assert.equal(replaceLine(file, 'ai-dev.sh text eol=lf', 'adw.sh text eol=lf'), false);
    assert.equal(replaceLine(path.join(root, 'missing'), 'x', 'y'), false);
  } finally {
    cleanup();
  }
});

test('adw.sh passes the project root as project directory from any cwd', { skip: process.platform === 'win32' }, () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeContainerFiles(root, OPTS);
    const { bin, log } = fakeDocker(root);
    fs.mkdirSync(path.join(root, 'src'));
    const result = spawnSync('sh', ['../adw.sh', 'true'], {
      cwd: path.join(root, 'src'), encoding: 'utf8', env: { ...cleanEnv(), PATH: `${bin}:${process.env.PATH}` },
    });
    assert.equal(result.status, 0, result.stderr);
    const real = fs.realpathSync(root);
    const calls = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\0').slice(1, -1));
    assert.equal(calls.length, 2);
    for (const args of calls) {
      assert.deepEqual(args.slice(0, 5), ['compose', '--project-directory', real, '-f', `${real}/.adw/compose.yml`]);
    }
  } finally {
    cleanup();
  }
});

test('adw.sh reads .adw/.env and warns about a leftover .env.ai-dev', { skip: process.platform === 'win32' }, () => {
  const viaEnv = runLauncher({}, 'AGENT_DIND=1\n');
  assert.equal(viaEnv.status, 0, viaEnv.stderr);
  assert.ok(viaEnv.calls.at(-1).includes('.adw/compose.dind.yml'));
  assert.doesNotMatch(viaEnv.stderr, /\.env\.ai-dev/);

  const legacy = runLauncher({}, undefined, 'AGENT_DIND=1\n');
  assert.equal(legacy.status, 0, legacy.stderr);
  assert.match(legacy.stderr, /move \.env\.ai-dev to \.adw\/\.env/);
  assert.ok(!legacy.calls.at(-1).includes('.adw/compose.dind.yml'), 'the old file is not read');

  const both = runLauncher({}, 'AGENT_DIND=1\n', 'AGENT_DIND=0\n');
  assert.equal(both.status, 0, both.stderr);
  assert.match(both.stderr, /move \.env\.ai-dev to \.adw\/\.env/);
  assert.ok(both.calls.at(-1).includes('.adw/compose.dind.yml'), 'only .adw/.env is read');
});
