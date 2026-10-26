import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as metrics from '../lib/metrics.mjs';
import { compareRuns } from '../lib/compare.mjs';
import { renderRunReport } from '../lib/report.mjs';
import { diffFingerprints } from '../lib/fingerprint.mjs';
import { makeClaudeTrial } from '../lib/fixtures/make.mjs';
import { LOCAL_CONTRACT_CHECKS } from './contract.mjs';
import { newRunDir } from './store.mjs';
import { buildLocalTrialRecord, compareWithBaseline, localFingerprint, localReward, writeRun } from './record.mjs';

const criteria = [{ id: 'AC1', text: 'a' }, { id: 'AC2', text: 'b' }];
const config = { agent: { harness: 'claude-code', model: null }, answerer: { harness: 'claude-code', model: null },
  verifier: { harness: 'codex', model: null }, review: { harness: 'claude-code', model: null, criteria: { scope: 'q' } },
  thresholds: { tokensMedianRise: 0.5, costMedianRise: 0.5, agentTimeMedianRise: 0.5, judgeMedianDrop: 1 },
  ccusage: { version: '20.0.32' }, mcpServers: ['playwright'], appPort: 3000 };
const DEPS = { ...metrics, ccusageUsage: () => ({ ccusageTotal: null, deviation: null, warning: null, cost: 0.5, models: null }) };
const allPass = Object.fromEntries(LOCAL_CONTRACT_CHECKS.map((c) => [c, 1]));
const conversation = { turns: 4, humanAsked: 0, done: true, stuck: false, error: null };
const tmp = () => mkdtempSync(path.join(tmpdir(), 'adw-record-'));

function trialIn(dir, over = {}) {
  makeClaudeTrial(dir);
  return buildLocalTrialRecord({ id: 'claude-code-1', harness: 'claude-code', trialDir: dir, config, criteria,
    checks: allPass, ownTests: 1, conversation, agentSeconds: 120, deps: DEPS, ...over });
}

test('a local trial record carries session tokens, the e2e check, human questions and the conversation error', () => {
  const dir = tmp();
  try {
    const t = trialIn(dir, { conversation: { ...conversation, humanAsked: 2, nudged: 3, error: 'agent-timeout' } });
    assert.equal(typeof t.tokens.total, 'number');
    assert.equal(t.checks.e2e_performed, 1);
    assert.equal(t.humanAsked, 2);
    assert.equal(t.nudged, 3);
    assert.deepEqual(t.durations, { agent: 120 });
    assert.equal(t.cost, 0.5);
    assert.deepEqual({ harbor: t.errors.harbor, bridge: t.errors.bridge, timeout: t.errors.timeout, quota: t.errors.quota },
      { harbor: null, bridge: 'agent-timeout', timeout: true, quota: false });
    assert.equal(t.contract, 1);
    assert.equal(t.acceptance, 0, 'acceptance waits for post-verification');
    assert.equal(t.reward, 0);
    const noPort = trialIn(dir, { config: { ...config, appPort: null }, checks: { ...allPass, app_stopped: null }, ownTests: null });
    assert.equal(noPort.checks.e2e_performed, null);
    assert.equal(noPort.contract, 1, 'null checks count in neither direction');
    assert.equal(noPort.ownTests, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('localReward: every non-null check, own tests (or none) and acceptance must pass; null only when unjudged', () => {
  const t = { checks: { a: 1, b: null }, ownTests: 1, acceptance: 1 };
  assert.equal(localReward(t), 1);
  assert.equal(localReward({ ...t, ownTests: null }), 1, 'no test command is no failure');
  assert.equal(localReward({ ...t, ownTests: 0 }), 0);
  assert.equal(localReward({ ...t, checks: { a: 0, b: null } }), 0);
  assert.equal(localReward({ ...t, acceptance: 0.5 }), 0);
  assert.equal(localReward({ ...t, acceptance: null }), null, 'a broken verifier is no agent failure');
  assert.equal(localReward({ ...t, acceptance: null, ownTests: null }), null);
  assert.equal(localReward({ ...t, acceptance: null, ownTests: 0 }), 0);
  assert.equal(localReward({ ...t, acceptance: null, checks: { a: 0 } }), 0);
});

test('the fingerprint names every role and hashes the stored ticket files', () => {
  const dir = tmp();
  try {
    writeFileSync(path.join(dir, 'ticket.md'), '# T\n\nbody\n');
    writeFileSync(path.join(dir, 'answers.json'), '[]\n');
    const args = { image: 'ai-dev:1', imageId: 'sha256:abc', e2eImage: 'adw-e2e:abc', cliVersions: { 'claude-code': '2.0.0', codex: '0.9.0' },
      baseCommit: 'deadbeef', dir, config, verifierHash: 'f00d' };
    const fp = localFingerprint(args);
    assert.match(fp.adw.version, /^\d+\.\d+\.\d+/);
    assert.equal(fp.adw.sha, null);
    assert.deepEqual(fp.image, { ref: 'ai-dev:1', id: 'sha256:abc', e2e: 'adw-e2e:abc' });
    assert.deepEqual(fp.roles.verifier, { harness: 'codex', model: null, cliVersion: '0.9.0' });
    assert.deepEqual(fp.models, { target: 'claude-code/default', answerer: 'claude-code/default', verifier: 'codex/default', review: 'claude-code/default' });
    assert.match(fp.ticket, /^[0-9a-f]{64}$/);
    assert.match(fp.answers, /^[0-9a-f]{64}$/);
    assert.equal(fp.acceptance, null, 'no acceptance.md yet');
    const other = localFingerprint({ ...args, config: { ...config, review: { ...config.review, harness: 'opencode', model: 'azure/gpt' } } });
    assert.ok(diffFingerprints(fp, other).some((d) => d.key === 'roles.review.harness'));
    assert.ok(diffFingerprints(fp, other).some((d) => d.key === 'roles.review.model'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function runIn(dir, ts, trial, fpOver = {}) {
  const fingerprint = { ...localFingerprint({ image: 'ai-dev:1', imageId: 'sha256:abc', cliVersions: { 'claude-code': '2.0.0', codex: '0.9.0' },
    baseCommit: 'deadbeef', dir, config, verifierHash: 'f00d' }), ...fpOver };
  const runDir = newRunDir(dir, 'claude-code', ts);
  return { runDir, run: writeRun({ runDir, ticket: 7, fingerprint, trials: [trial], aborted: null }) };
}

test('writeRun writes run.json and report.md; a human answer makes the run not comparable', () => {
  const dir = tmp();
  try {
    const t = trialIn(path.join(dir, 'trial'));
    const { runDir, run } = runIn(dir, '2026-10-19T1000Z', { ...t, humanAsked: 1 });
    const stored = JSON.parse(readFileSync(path.join(runDir, 'run.json'), 'utf8'));
    assert.equal(stored.schema, 2);
    assert.equal(stored.local, true);
    assert.equal(stored.task, '#7');
    assert.equal(stored.harness, 'claude-code');
    assert.equal(stored.config.model, 'default');
    assert.equal(stored.comparable, false);
    assert.equal(run.comparable, false);
    assert.equal(runIn(dir, '2026-10-19T1001Z', t).run.comparable, true);
    assert.equal(writeRun({ runDir, ticket: 7, fingerprint: stored.fingerprint, trials: [t], aborted: 'quota' }).comparable, false);
    const md = readFileSync(path.join(runDir, 'report.md'), 'utf8');
    assert.match(md, /# E2E #7 · claude-code/);
    assert.match(md, /not calibrated \(local run\)/);
    assert.match(md, /Self-judged.*review/);
    assert.doesNotMatch(md, /\(null\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('nudges are counted per run and shown, and never make a run incomparable', () => {
  const dir = tmp();
  try {
    const t = trialIn(path.join(dir, 'trial'), { conversation: { ...conversation, nudged: 2 } });
    const { run } = runIn(dir, '2026-10-19T1000Z', t);
    assert.equal(run.nudged, 2);
    assert.equal(run.comparable, true);
    assert.match(renderRunReport(run), /Human asked: 0 · nudged: 2 · comparable: yes/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('renderRunReport renders a local run: human questions, comparability, no calibration lookup', () => {
  const dir = tmp();
  try {
    const t = trialIn(path.join(dir, 'trial'), { ownTests: null, checks: { ...allPass, app_stopped: null } });
    const { run } = runIn(dir, '2026-10-19T1000Z', { ...t, humanAsked: 2 });
    const md = renderRunReport(run);
    assert.match(md, /Human asked: 2 · nudged: 0 · comparable: no/);
    assert.match(md, /adw \d+\.\d+\.\d+ · trials: 1/);
    assert.match(md, /own tests — /);
    assert.match(md, /Failed checks: none/, 'an unchecked check is no failure');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('compareWithBaseline: identical runs compare as same and write compare.md; no comparable baseline gives null', () => {
  const dir = tmp();
  try {
    const t = trialIn(path.join(dir, 'trial'));
    const first = runIn(dir, '2026-10-19T1000Z', t);
    assert.equal(compareWithBaseline({ dir, ...first, config }), null);
    const second = runIn(dir, '2026-10-19T1100Z', t);
    const cmp = compareWithBaseline({ dir, ...second, config });
    assert.equal(cmp.baseline, first.runDir);
    assert.equal(cmp.result.verdict, 'same');
    assert.equal(cmp.result.verdict, compareRuns(first.run, second.run, config.thresholds).verdict);
    const md = readFileSync(path.join(second.runDir, 'compare.md'), 'utf8');
    assert.match(md, /# Compare #7 · claude-code: \*\*same\*\*/);
    assert.doesNotMatch(md, /not calibrated/);
    const other = runIn(dir, '2026-10-19T1200Z', t, { baseCommit: 'cafe' });
    assert.equal(compareWithBaseline({ dir, ...other, config }), null, 'another base commit is no baseline');
    assert.equal(existsSync(path.join(other.runDir, 'compare.md')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('compareWithBaseline: an explicit baseline dir wins over the lookup, even another base commit', () => {
  const dir = tmp();
  try {
    const t = trialIn(path.join(dir, 'trial'));
    const first = runIn(dir, '2026-10-19T1000Z', t, { baseCommit: 'cafe' });
    const second = runIn(dir, '2026-10-19T1100Z', t);
    const cmp = compareWithBaseline({ dir, ...second, config, baseline: first.runDir });
    assert.equal(cmp.baseline, first.runDir);
    assert.equal(cmp.result.verdict, compareRuns(first.run, second.run, config.thresholds).verdict);
    assert.ok(existsSync(path.join(second.runDir, 'compare.md')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
