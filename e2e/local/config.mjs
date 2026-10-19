// Local E2E config: package defaults deep-merged with the project's ai-project.json `.e2e`, then the CLI harness/model.
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARNESSES } from '../lib/llm.mjs';

const DEFAULTS = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'defaults.json'), 'utf8'));
const ROLES = ['answerer', 'verifier', 'review'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Objects merge key by key; arrays and scalars from the override replace.
function merge(base, over) {
  if (!isObject(base) || !isObject(over)) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? merge(base[k], v) : v;
  return out;
}

function checkHarness(name, harness) {
  if (harness != null && !HARNESSES.includes(harness)) throw new Error(`e2e.${name}.harness must be one of ${HARNESSES.join(', ')}`);
}

export function loadLocalConfig(projectRoot, { harness, model } = {}) {
  const root = resolve(projectRoot);
  const file = join(root, 'ai-project.json');
  const project = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')).e2e ?? {}) : {};
  for (const key of Object.keys(project)) if (!(key in DEFAULTS)) throw new Error(`unknown e2e setting: ${key}`);
  const merged = merge(DEFAULTS, project);

  const agent = { harness: harness ?? merged.agent.harness, model: model ?? merged.agent.model };
  checkHarness('agent', agent.harness);
  for (const role of ROLES) checkHarness(role, merged[role].harness);
  if (!agent.harness) throw new Error('no agent harness: pass one or set e2e.agent.harness');

  // A role without its own harness follows the agent's harness and that CLI's default model.
  const roles = {};
  for (const role of ROLES) {
    const r = merged[role];
    roles[role] = r.harness ? r : { ...r, harness: agent.harness, model: null };
  }
  return { root, ...merged, agent, ...roles };
}

// Judges running on the agent's own harness+model: the report warns that they grade their own work.
export function selfJudged(config) {
  return ['verifier', 'review'].filter((r) => config[r].harness === config.agent.harness && config[r].model === config.agent.model);
}
