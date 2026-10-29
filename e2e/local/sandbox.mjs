// The throwaway clone an e2e trial runs in: the consumer project at a base commit, on the `file`
// ticketing backend, regenerated with this package's generator, with a local bare repo as origin.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ISOLATE, COMMIT } from '../lib/bundle.mjs';
import { renderAll, writeAll } from '../../agent-src/lib/pipeline.mjs';
import { removeObsoleteOutputs } from '../../agent-src/lib/upgrade.mjs';
import { e2eSectionOf } from './contract.mjs';

const TEMPLATE = path.join(fileURLToPath(new URL('../../agent-src/config/', import.meta.url)), 'ai-project.template.json');
const defaultGit = (args, env = {}) => execFileSync('git', [...ISOLATE, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...env } });

const slugify = (title) => title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40).replace(/_+$/, '') || 'ticket';

// Identity from the project's config; a base commit without one gets it from the template and the dir name.
function sandboxConfig(work, root) {
  const file = path.join(work, 'ai-project.json');
  const template = JSON.parse(readFileSync(TEMPLATE, 'utf8'));
  const base = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const name = path.basename(path.resolve(root));
  return {
    project: base.project ?? { name },
    repository: base.repository ?? { slug: name },
    git: { ...(base.git ?? template.git), prTarget: 'main' },
    ticketing: { backend: 'file', file: { dir: '.tickets/issues', metadataFile: '.tickets/metadata.json' } },
  };
}

// `adw e2e .`: the working tree as an unreferenced commit on top of HEAD, built in a throwaway index, so HEAD, branch,
// index and stash stay as they are. Untracked files count, git-ignored ones (.env.ai-dev) never; .adw/e2e stays at
// HEAD's state, so a ticket's acceptance criteria cannot reach the agent. A clean tree is HEAD itself (worktree null);
// otherwise `worktree` is the snapshot's tree hash, the same for the same local state.
export function snapshotWorkingTree(root, git = defaultGit) {
  const head = git(['-C', root, 'rev-parse', '--verify', 'HEAD^{commit}']).trim();
  const tmp = mkdtempSync(path.join(tmpdir(), 'adw-snapshot-'));
  try {
    const env = { GIT_INDEX_FILE: path.join(tmp, 'index') };
    git(['-C', root, 'read-tree', head], env);
    git(['-C', root, 'add', '-A', '--', ':/', ':(top,exclude).adw/e2e'], env);
    const tree = git(['-C', root, 'write-tree'], env).trim();
    if (tree === git(['-C', root, 'rev-parse', `${head}^{tree}`]).trim()) return { head, commit: head, worktree: null };
    const commit = git([...COMMIT, '-C', root, 'commit-tree', tree, '-p', head, '-m', 'adw e2e: working tree']).trim();
    return { head, commit, worktree: tree };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

export function createSandbox({ root, baseCommit, ticket, ticketText, trialDir, e2eSection = null, git = defaultGit }) {
  const work = path.join(trialDir, 'work');
  const origin = path.join(trialDir, 'origin.git');
  mkdirSync(trialDir, { recursive: true });
  // No template: the host's init.templateDir hooks would fire on the agent's commits in the container.
  git(['clone', '-q', '--no-hardlinks', '--no-checkout', '--template=', path.resolve(root), work]);
  git(['-C', work, 'checkout', '-q', '--detach', baseCommit]);
  // The real remote must not be reachable from the sandbox.
  for (const remote of git(['-C', work, 'remote']).split('\n').filter(Boolean)) git(['-C', work, 'remote', 'remove', remote]);
  git(['init', '-q', '--bare', '--template=', origin]);
  git(['-C', work, 'remote', 'add', 'origin', origin]);
  // The trial's agent-home volume is fresh, so the container has no identity; Harbor's seed sets the same one.
  git(['-C', work, 'config', 'user.name', 'ADW E2E Agent']);
  git(['-C', work, 'config', 'user.email', 'agent@e2e.local']);
  git(['-C', work, 'checkout', '-q', '-B', 'main']);
  // The clone's branch for the root's HEAD would pass for a second branch.
  for (const b of git(['-C', work, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/']).split('\n')) {
    if (b && b !== 'main') git(['-C', work, 'branch', '-q', '-D', b]);
  }
  git(['-C', work, 'push', '-q', 'origin', 'main']);

  writeFileSync(path.join(work, 'ai-project.json'), `${JSON.stringify(sandboxConfig(work, root), null, 2)}\n`);
  const issues = path.join(work, '.tickets', 'issues');
  mkdirSync(issues, { recursive: true });
  const title = JSON.stringify(ticketText.title);
  writeFileSync(path.join(issues, `${ticket}_${slugify(ticketText.title)}.md`), `---\ntitle: ${title}\nstatus: new\n---\n\n${ticketText.body}\n`);

  // Same steps as `upgrade`: an older base commit's stale generated files go, the current ones are written.
  const outputs = renderAll(work);
  removeObsoleteOutputs(work);
  const log = console.log;
  console.log = () => {};
  try { writeAll(outputs, work); } finally { console.log = log; }

  // A base commit older than the project's AGENTS.md section gets the working tree's, so the verifier can run the app.
  const agentsFile = path.join(work, 'AGENTS.md');
  const agents = existsSync(agentsFile) ? readFileSync(agentsFile, 'utf8') : '';
  const e2eOverlay = Boolean(e2eSection) && e2eSectionOf(agents) === null;
  if (e2eOverlay) writeFileSync(agentsFile, `${agents}${agents === '' || agents.endsWith('\n\n') ? '' : agents.endsWith('\n') ? '\n' : '\n\n'}${e2eSection}\n`);

  git(['-C', work, 'add', '-A']);
  git([...COMMIT, '-C', work, 'commit', '-q', '-m', 'e2e setup']);
  git(['-C', work, 'push', '-q', 'origin', 'main']);
  mkdirSync(path.join(work, '.git', 'info'), { recursive: true });
  appendFileSync(path.join(work, '.git', 'info', 'exclude'), '.acpxrc.json\n');
  return { work, origin, e2eOverlay };
}

export function collectSandbox({ work, origin, ticket, git = defaultGit }) {
  const issues = path.join(work, '.tickets', 'issues');
  const name = existsSync(issues) ? readdirSync(issues).find((f) => f.startsWith(`${ticket}_`)) : undefined;
  const ticketFile = name ? readFileSync(path.join(issues, name), 'utf8') : '';
  const branches = git(['-C', origin, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/']).split('\n').filter((b) => b && b !== 'main');
  // The pull requests the e2e layer's fake gh/tea/az recorded (image/pr-cli.mjs).
  const prLog = path.join(work, '.git', 'adw-e2e', 'pr.jsonl');
  const prs = existsSync(prLog) ? readFileSync(prLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  if (branches.length !== 1) return { ticketFile, branches, prs, bundle: null, diff: '' };
  const bundle = path.join(path.dirname(origin), 'pr-head.bundle');
  git(['-C', origin, 'bundle', 'create', bundle, 'main', branches[0]]);
  const diff = git(['-C', origin, 'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', `main...${branches[0]}`]);
  return { ticketFile, branches, prs, bundle, diff };
}
