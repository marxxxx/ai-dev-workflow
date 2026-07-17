// Cost output: the resolved token/cost-accounting include the workflow reads at runtime.

import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR } from './constants.mjs';
import { normalizeLF } from './serialize.mjs';
import { substituteTokens } from './tokens.mjs';

/**
 * Render the resolved cost include — the single-source-of-truth for how the workflow records a
 * ticket's ccusage session cost (via a per-run ledger) and posts the token/cost summary comment when
 * the ticket reaches acceptance-test. Platform-neutral: per-harness differences are expressed as
 * in-prose branches (like the e2e-runtime include's Windows/Linux split). Mirrors renderE2eInclude.
 * Returns null when no include path is configured (package always sets one).
 */
export function renderCostInclude(config, globalTokens) {
  const includePath = config.cost?.includePath;
  if (!includePath) return null;
  const src = path.join(SRC_DIR, 'includes', 'cost.md');
  if (!fs.existsSync(src)) {
    throw new Error('cost include selected but agent-src/includes/cost.md not found');
  }
  const fragment = normalizeLF(fs.readFileSync(src, 'utf8'));
  let content = substituteTokens(fragment, globalTokens, null, 'includes/cost.md');
  content = '<!-- DO NOT EDIT — generated from agent-src/includes/cost.md; run `node agent-src/generate.mjs` -->\n\n' + content;
  if (!content.endsWith('\n')) content += '\n';
  return { path: includePath, content, plain: true };
}
