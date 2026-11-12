import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTmpRoot } from '../test-helpers.mjs';
import { assertCurrentLayout, legacyLayoutPaths, migrateLayout } from './layout.mjs';

const COMPOSE = '# custom header\nname: shop-ai\nservices:\n  extra: { image: x } # my own line\n';

function fixture(files) {
  const { root, cleanup } = makeTmpRoot();
  const abs = (p) => path.join(root, p);
  for (const [p, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(abs(p)), { recursive: true });
    fs.writeFileSync(abs(p), content);
  }
  const read = (p) => fs.readFileSync(abs(p), 'utf8');
  const exists = (p) => fs.existsSync(abs(p));
  return { root, abs, read, exists, cleanup };
}

const gitea = (login = 'srv') => JSON.stringify({ project: { name: 'Shop' }, ticketing: { backend: 'gitea', gitea: { login } } });

const fullOld = () => ({
  'ai-project.json': gitea(),
  'compose.ai-dev.yml': COMPOSE,
  'compose.ai-dev.certs.yml': 'certs\n',
  'compose.ai-dev.dind.yml': 'dind\n',
  'compose.ai-dev.dind-certs.yml': 'dindcerts\n',
  '.env.ai-dev': 'TOKEN=1\n',
  'agent-custom/skills/agent-dev/append.md': 'x',
  'ai-dev.sh': 'old sh\n',
  'ai-dev.ps1': 'old ps1\n',
  'AI-DEV.md': 'old readme\n',
  '.gitignore': '.env.ai-dev\n',
  '.gitattributes': 'ai-dev.sh text eol=lf\n',
});

function snapshot(root, dir = root, out = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { out[path.relative(root, p)] = null; snapshot(root, p, out); }
    else out[path.relative(root, p)] = fs.readFileSync(p, 'utf8');
  }
  return out;
}

test('migrateLayout moves every old file unchanged and rewrites launchers and README', () => {
  const { root, abs, read, exists, cleanup } = fixture(fullOld());
  try {
    const r = migrateLayout(root);
    assert.equal(read('.adw/compose.yml'), COMPOSE);
    assert.equal(read('.adw/compose.dind-certs.yml'), 'dindcerts\n');
    assert.equal(read('.adw/.env'), 'TOKEN=1\n');
    assert.equal(read('.adw/custom/skills/agent-dev/append.md'), 'x');
    assert.equal(read('.adw/project.json'), gitea());
    for (const old of ['ai-project.json', 'compose.ai-dev.yml', '.env.ai-dev', 'agent-custom', 'ai-dev.sh', 'ai-dev.ps1', 'AI-DEV.md']) {
      assert.ok(!exists(old), old);
    }
    assert.ok(read('.adw/README.md').includes('shop-ai_agent-home') && read('.adw/README.md').includes('--name srv'));
    assert.ok(read('adw.sh').includes('.adw/compose.yml'));
    assert.ok(exists('adw.ps1'));
    if (process.platform !== 'win32') assert.equal(fs.statSync(abs('adw.sh')).mode & 0o777, 0o755);
    assert.deepEqual(read('.gitignore').split('\n').filter(Boolean), ['.env.ai-dev', '.adw/.env']);
    assert.equal(read('.gitattributes'), 'adw.sh text eol=lf\n');
    assert.deepEqual(r.conflicts, []);
    assert.ok(r.changes.some((c) => c.from === 'ai-dev.sh' && c.to === 'adw.sh' && c.kind === 'rewrite'));
    assert.ok(r.changes.some((c) => c.from === 'compose.ai-dev.yml' && c.kind === 'move'));
    assert.deepEqual(r.edits, ['Added .adw/.env to .gitignore', 'Replaced ai-dev.sh with adw.sh in .gitattributes']);
  } finally { cleanup(); }
});

test('migrateLayout is idempotent', () => {
  const { root, cleanup } = fixture(fullOld());
  try {
    migrateLayout(root);
    const before = snapshot(root);
    assert.deepEqual(migrateLayout(root), { changes: [], conflicts: [], edits: [] });
    assert.deepEqual(snapshot(root), before);
  } finally { cleanup(); }
});

test('migrateLayout dryRun reports the same changes and touches nothing', () => {
  const { root, cleanup } = fixture(fullOld());
  try {
    const before = snapshot(root);
    const dry = migrateLayout(root, { dryRun: true });
    assert.deepEqual(snapshot(root), before);
    assert.ok(!fs.existsSync(path.join(root, '.adw')));
    assert.deepEqual(migrateLayout(root), dry);
  } finally { cleanup(); }
});

test('migrateLayout leaves both files on a conflict and still moves the rest', () => {
  const { root, read, exists, cleanup } = fixture({
    'ai-project.json': gitea('old'),
    '.adw/project.json': gitea('new'),
    'compose.ai-dev.yml': COMPOSE,
  });
  try {
    const r = migrateLayout(root);
    assert.deepEqual(r.conflicts, [{ from: 'ai-project.json', to: '.adw/project.json' }]);
    assert.equal(read('ai-project.json'), gitea('old'));
    assert.equal(read('.adw/project.json'), gitea('new'));
    assert.equal(read('.adw/compose.yml'), COMPOSE);
    assert.ok(!exists('compose.ai-dev.yml'));
  } finally { cleanup(); }
});

test('migrateLayout reports a rewrite conflict and keeps both launchers', () => {
  const { root, read, cleanup } = fixture({ 'ai-project.json': gitea(), 'ai-dev.sh': 'old\n', 'adw.sh': 'mine\n' });
  try {
    const r = migrateLayout(root);
    assert.deepEqual(r.conflicts, [{ from: 'ai-dev.sh', to: 'adw.sh' }]);
    assert.equal(read('ai-dev.sh'), 'old\n');
    assert.equal(read('adw.sh'), 'mine\n');
  } finally { cleanup(); }
});

test('migrateLayout without container files moves only the config', () => {
  const { root, exists, cleanup } = fixture({ 'ai-project.json': gitea(), 'agent-custom/a.md': 'a' });
  try {
    const r = migrateLayout(root);
    assert.deepEqual(r.changes.map((c) => c.to), ['.adw/project.json', '.adw/custom']);
    assert.ok(!exists('adw.sh') && !exists('adw.ps1') && !exists('.adw/README.md') && !exists('.gitignore') && !exists('.gitattributes'));
    assert.deepEqual(r.edits, []);
  } finally { cleanup(); }
});

test('migrateLayout never creates .gitignore, even when .env.ai-dev moves', () => {
  const { root, exists, cleanup } = fixture({ '.env.ai-dev': 'A=1\n' });
  try {
    const r = migrateLayout(root);
    assert.ok(exists('.adw/.env') && !exists('.gitignore'));
    assert.deepEqual(r.edits, []);
  } finally { cleanup(); }
});

test('migrateLayout adds .adw/.env to a CRLF .gitignore once', () => {
  const { root, read, cleanup } = fixture({ '.env.ai-dev': 'A=1\n', '.gitignore': '.env.ai-dev\r\nnode_modules\r\n' });
  try {
    migrateLayout(root);
    migrateLayout(root);
    assert.equal(read('.gitignore').split(/\r?\n/).filter((l) => l === '.adw/.env').length, 1);
  } finally { cleanup(); }
});

test('migrateLayout README slug falls back without a -ai name', () => {
  const { root, read, cleanup } = fixture({
    'ai-project.json': JSON.stringify({ project: { name: 'My Shop' }, ticketing: { backend: 'file' } }),
    'compose.ai-dev.yml': 'name: custom\n',
    'AI-DEV.md': 'old\n',
  });
  try {
    migrateLayout(root);
    assert.ok(read('.adw/README.md').includes('my-shop-ai_agent-home'));
  } finally { cleanup(); }
});

test('legacyLayoutPaths ignores .env.ai-dev; assertCurrentLayout names the rest', () => {
  const a = fixture({ '.env.ai-dev': 'A=1\n' });
  const b = fixture({ 'ai-project.json': '{}', 'ai-dev.sh': 'x' });
  try {
    assert.deepEqual(legacyLayoutPaths(a.root), []);
    assertCurrentLayout(a.root);
    assert.throws(() => assertCurrentLayout(b.root), /Old adw layout found: ai-project\.json, ai-dev\.sh\. Run adw's `upgrade` command/);
  } finally { a.cleanup(); b.cleanup(); }
});
