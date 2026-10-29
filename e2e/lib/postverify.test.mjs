import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InterruptError } from './claude.mjs';
import { loadConfig } from './config.mjs';
import { buildTaskImage, postVerify, taskImage, verifierHash } from './postverify.mjs';

const config = loadConfig();
const criteria = [{ id: 'AC1', text: 'a' }, { id: 'AC2', text: 'b' }];
const scores = Object.fromEntries(Object.keys(config.review.criteria).map((k) => [k, 4]));
const nulls = Object.fromEntries(Object.keys(config.review.criteria).map((k) => [k, null]));

const settingsIn = (dir) => ['settings.json', 'settings.local.json', 'keep.md'].filter((f) => existsSync(path.join(dir, '.claude', f)));

function fakes(over = {}) {
  const seen = { checkouts: [] };
  const deps = {
    checkoutBundle: (bundle, dir) => {
      seen.checkouts.push(dir);
      mkdirSync(path.join(dir, '.claude'), { recursive: true });
      for (const f of ['settings.json', 'settings.local.json', 'keep.md']) writeFileSync(path.join(dir, '.claude', f), '{}');
      return { branch: '1_x', diff: 'DIFF' };
    },
    runVerifier: (a) => { seen.verifier = a; seen.verifierSettings = settingsIn(a.checkout); return { criteria: { AC1: { pass: true, evidence: 'e1' }, AC2: { pass: false, evidence: 'e2' } }, error: null }; },
    runReview: (a) => { seen.reviewSettings = settingsIn(a.checkout); seen.review = { ...a, diffText: readFileSync(a.diffPath, 'utf8') }; return { scores, reasons: { scope: 'ok' }, error: null }; },
    ...over,
  };
  return { seen, deps };
}

test('verifier and review get separate fresh checkouts; verdicts become per-criterion results', () => {
  const { seen, deps } = fakes();
  const pv = postVerify({ config, bundle: '/b/pr-head.bundle', criteria, spec: 'S', summary: 'U', env: { T: '1' }, image: 'img', deps });
  assert.equal(seen.checkouts.length, 2);
  assert.notEqual(seen.checkouts[0], seen.checkouts[1]);
  assert.equal(seen.verifier.checkout, seen.checkouts[0]);
  assert.equal(seen.verifier.image, 'img');
  assert.deepEqual(seen.verifier.env, { T: '1' });
  assert.ok(!('spec' in seen.verifier) && !('summary' in seen.verifier), 'the verifier never sees spec or summary');
  assert.equal(seen.review.checkout, seen.checkouts[1]);
  assert.equal(seen.review.image, 'img');
  assert.equal(path.dirname(seen.review.diffPath), path.join(path.dirname(seen.checkouts[0]), 'diff'));
  assert.equal(seen.review.diffText, 'DIFF');
  assert.deepEqual([seen.review.spec, seen.review.summary], ['S', 'U']);
  assert.deepEqual(pv, { acceptanceCriteria: { AC1: 'pass', AC2: 'fail' }, acceptanceEvidence: { AC1: 'e1', AC2: 'e2' }, acceptance: 0.5,
    verifierError: null, review: scores, reviewReasons: { scope: 'ok' }, reviewError: null });
  assert.equal(existsSync(path.dirname(seen.checkouts[0])), false, 'work dir removed');
});

test('agent-authored Claude settings are removed from both checkouts before the judges run', () => {
  const { seen, deps } = fakes();
  postVerify({ config, bundle: 'b', criteria, image: 'img', deps });
  assert.deepEqual(seen.verifierSettings, ['keep.md']);
  assert.deepEqual(seen.reviewSettings, ['keep.md']);
});

test('a checkout whose .claude is a symlink loses the link, never the file it points to', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'adw-pv-target-'));
  writeFileSync(path.join(target, 'settings.json'), '{"host":true}');
  try {
    const { seen, deps } = fakes({ checkoutBundle: (bundle, dir) => {
      mkdirSync(dir, { recursive: true });
      symlinkSync(target, path.join(dir, '.claude'), 'junction');
      seen.checkouts.push(dir);
      return { branch: '1_x', diff: 'DIFF' };
    } });
    seen.linkSeen = [];
    deps.runVerifier = (a) => { seen.linkSeen.push(lstatSync(path.join(a.checkout, '.claude'), { throwIfNoEntry: false }) ?? null); return { criteria: null, error: 'x' }; };
    postVerify({ config, bundle: 'b', criteria, image: 'img', deps });
    assert.equal(readFileSync(path.join(target, 'settings.json'), 'utf8'), '{"host":true}', 'the host file survives');
    assert.deepEqual(seen.linkSeen, [null], 'the link is gone from the checkout');
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('a failed verifier gives null acceptance, and a usage limit skips the review', () => {
  const failed = postVerify({ config, bundle: 'b', criteria, image: 'img',
    deps: fakes({ runVerifier: () => ({ criteria: null, error: 'verifier exit 1: crash' }) }).deps });
  assert.deepEqual(failed.acceptanceCriteria, { AC1: null, AC2: null });
  assert.equal(failed.acceptance, null);
  assert.equal(failed.acceptanceEvidence, null);
  assert.equal(failed.reviewError, null, 'the review still runs');
  let reviewed = false;
  const limited = postVerify({ config, bundle: 'b', criteria, image: 'img',
    deps: fakes({ runVerifier: () => ({ criteria: null, error: 'verifier exit 1: usage_limit_reached: limit' }), runReview: () => { reviewed = true; } }).deps });
  assert.equal(reviewed, false);
  assert.match(limited.reviewError, /usage_limit_reached/);
  assert.deepEqual(limited.review, nulls);
});

test('a bundle that cannot be checked out yields errors for both roles instead of throwing', () => {
  const pv = postVerify({ config, bundle: 'b', criteria, image: 'img',
    deps: fakes({ checkoutBundle: () => { throw new Error('bundle must hold main and one PR branch, has: refs/heads/x'); } }).deps });
  assert.equal(pv.acceptance, null);
  assert.match(pv.verifierError, /^checkout: bundle must hold main/);
  assert.match(pv.reviewError, /^checkout: /);
  assert.deepEqual(pv.review, nulls);
});

test('an interrupt from a judge propagates: no checkout error verdict, no review, work dir removed', () => {
  const { seen, deps } = fakes({ runVerifier: () => { throw new InterruptError('SIGINT'); } });
  let reviewed = false;
  deps.runReview = () => { reviewed = true; };
  assert.throws(() => postVerify({ config, bundle: 'b', criteria, image: 'img', deps }), (e) => e.interrupted === true);
  assert.equal(reviewed, false);
  assert.equal(existsSync(path.dirname(seen.checkouts[0])), false, 'work dir removed');
});

test('verifierHash is stable and changes with criteria, models and rubric, not with limits', () => {
  const h = verifierHash({ config, criteria });
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(verifierHash({ config, criteria }), h);
  assert.notEqual(verifierHash({ config, criteria: [{ id: 'AC1', text: 'changed' }, criteria[1]] }), h);
  assert.notEqual(verifierHash({ config: { ...config, verifier: { ...config.verifier, model: 'other' } }, criteria }), h);
  assert.notEqual(verifierHash({ config: { ...config, review: { ...config.review, model: 'other' } }, criteria }), h);
  assert.notEqual(verifierHash({ config: { ...config, review: { ...config.review, criteria: { scope: 'x' } } }, criteria }), h);
  assert.equal(verifierHash({ config: { ...config, verifier: { ...config.verifier, timeoutSec: 1 } }, criteria }), h);
});

test('the task image is built from the task environment as adw-e2e-<task>', () => {
  let call;
  assert.equal(buildTaskImage({ config, task: 'demo-todo', exec: (cmd, args) => { call = [cmd, ...args]; } }), 'adw-e2e-demo-todo');
  assert.equal(taskImage('demo-todo-dotnet'), 'adw-e2e-demo-todo-dotnet');
  const env = path.join(config.root, 'e2e/tasks/demo-todo/environment');
  assert.deepEqual(call, ['docker', 'build', '-t', 'adw-e2e-demo-todo', '-f', path.join(env, 'Dockerfile'), env]);
});

test('postVerify labels each judge transcript with its kind', () => {
  const { seen, deps } = fakes();
  const got = [];
  postVerify({ config, bundle: 'b', criteria, image: 'img', deps, onTranscript: (kind, text) => got.push([kind, text]) });
  seen.verifier.onTranscript('V');
  seen.review.onTranscript('R');
  assert.deepEqual(got, [['verifier', 'V'], ['review', 'R']]);
  const quiet = fakes();
  postVerify({ config, bundle: 'b', criteria, image: 'img', deps: quiet.deps });
  assert.doesNotThrow(() => quiet.seen.verifier.onTranscript('V'), 'transcripts are optional');
});
