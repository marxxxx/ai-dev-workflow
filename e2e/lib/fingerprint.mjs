// Records every component version that can change a run's outcome; compare diffs these.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { configHash, harnessVersion } from './config.mjs';
import { sha256Dir, sha256File, walk } from './fsutil.mjs';
import { seedRepo, taskDir } from './tasks.mjs';

export const ACP_VERSIONS = { acpx: '0.11.2', claudeCodeAcp: '0.16.2', codexAcp: '1.12.0' };
// Generated agent files and local build output are no part of the task.
export const TASK_EXCLUDE = /(^|\/)(\.claude|\.agents|\.opencode|\.codex|bin|obj|artifacts|TestResults)\/|\.mcp\.json$/;

export function buildFingerprint({ config, harness, task, verifierHash, seed = seedRepo(config, task),
  exec = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', cwd: config.root }) }) {
  const root = config.root;
  const inventory = path.join(root, 'docker/tools/inventory.json');
  const inv = JSON.parse(readFileSync(inventory, 'utf8'));
  const baseImage = config.tasks[task].baseImage;
  const skill = (p) => sha256File(path.join(seed, p, 'skills/agent-dev/SKILL.md'));
  const includes = walk(path.join(seed, '.agents/includes')).sort().map(sha256File).join(':');
  return {
    adw: { version: JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version,
      sha: exec('git', ['rev-parse', 'HEAD']).trim(), dirty: exec('git', ['status', '--porcelain']).trim() !== '' },
    skill: { claude: skill('.claude'), codex: skill('.agents'), opencode: skill('.opencode'), includes },
    image: { ref: baseImage, id: exec('docker', ['image', 'inspect', '--format', '{{.Id}}', baseImage]).trim(),
      inventory: sha256File(inventory), harnessVersion: harnessVersion(config, harness, inventory),
      superpowers: inv.sourceRevisions.superpowers },
    harbor: { version: exec('harbor', ['--version']).trim(), ...ACP_VERSIONS },
    code: { agents: sha256Dir(path.join(root, 'e2e/agents'), { exclude: /__pycache__/ }),
      lib: sha256Dir(path.join(root, 'e2e/lib'), { exclude: /(^|\/)fixtures\/|\.test\.mjs$/ }) },
    config: configHash(config),
    verifierHash,
    models: { target: config.harnesses[harness].model, subagents: config.harnesses[harness].subagentModel ?? null,
      simulatedUser: config.simulatedUser.model, verifier: config.verifier.model, review: config.review.model },
    task: sha256Dir(taskDir(config, task), { exclude: TASK_EXCLUDE }),
  };
}

function flatten(obj, prefix = '') {
  return Object.entries(obj ?? {}).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v)
    ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));
}

export function diffFingerprints(a, b) {
  const fa = Object.fromEntries(flatten(a)); const fb = Object.fromEntries(flatten(b));
  return [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort()
    .filter((k) => JSON.stringify(fa[k]) !== JSON.stringify(fb[k]))
    .map((key) => ({ key, from: fa[key], to: fb[key] }));
}
