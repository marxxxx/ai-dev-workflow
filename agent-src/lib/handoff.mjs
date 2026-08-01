// Handoff output: the resolved developer-handoff include the workflow reads at runtime.

import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR } from './constants.mjs';
import { normalizeLF } from './serialize.mjs';
import { substituteTokens } from './tokens.mjs';

/**
 * Render the resolved handoff include — the single-source-of-truth for how a developer that cannot
 * finish a ticket in one context window stops at an acceptance-criterion boundary, records its
 * progress in a per-ticket journal, and posts the durable handoff comment a fresh developer resumes
 * from. Platform-neutral. Mirrors renderCostInclude.
 * Returns null when no include path is configured (package always sets one).
 */
export function renderHandoffInclude(config, globalTokens) {
  const includePath = config.handoff?.includePath;
  if (!includePath) return null;
  const src = path.join(SRC_DIR, 'includes', 'handoff.md');
  if (!fs.existsSync(src)) {
    throw new Error('handoff include selected but agent-src/includes/handoff.md not found');
  }
  const fragment = normalizeLF(fs.readFileSync(src, 'utf8'));
  let content = substituteTokens(fragment, globalTokens, null, 'includes/handoff.md');
  content = '<!-- DO NOT EDIT — generated from agent-src/includes/handoff.md; run `node agent-src/generate.mjs` -->\n\n' + content;
  if (!content.endsWith('\n')) content += '\n';
  return { path: includePath, content, plain: true };
}
