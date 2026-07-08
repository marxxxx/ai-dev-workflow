// E2E runtime output: the resolved app-startup include the qa-engineer reads at runtime.

import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR } from './constants.mjs';
import { normalizeLF } from './serialize.mjs';
import { substituteTokens } from './tokens.mjs';

/**
 * Render the resolved e2e-runtime include — the single-source-of-truth the qa-engineer reads
 * for whether/how to start the app end-to-end. Selects the `configured` variant when the project
 * declared an `e2e` block in ai-project.json, otherwise the `unconfigured` variant (skip browser
 * e2e, run the suite only, defer UI criteria to a human). Mirrors renderTicketingInclude.
 * Returns null when no include path is configured (package always sets one).
 */
export function renderE2eInclude(config, globalTokens) {
  const includePath = config.app?.includePath;
  if (!includePath) return null;
  const variant = config.e2e ? 'configured' : 'unconfigured';
  const src = path.join(SRC_DIR, 'includes', `e2e-runtime-${variant}.md`);
  if (!fs.existsSync(src)) {
    throw new Error(`e2e-runtime "${variant}" selected but agent-src/includes/e2e-runtime-${variant}.md not found`);
  }
  const fragment = normalizeLF(fs.readFileSync(src, 'utf8'));
  let content = substituteTokens(fragment, globalTokens, null, `includes/e2e-runtime-${variant}.md`);
  content = `<!-- DO NOT EDIT — generated from agent-src/includes/e2e-runtime-${variant}.md; run \`node agent-src/generate.mjs\` -->\n\n` + content;
  if (!content.endsWith('\n')) content += '\n';
  return { path: includePath, content, plain: true };
}
