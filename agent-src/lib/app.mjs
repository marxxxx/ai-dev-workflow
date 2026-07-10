// E2E runtime output: the resolved app-startup include the qa-engineer reads at runtime.

import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR } from './constants.mjs';
import { normalizeLF } from './serialize.mjs';
import { substituteTokens } from './tokens.mjs';

/**
 * Render the resolved e2e-runtime include — the single-source-of-truth the qa-engineer reads for
 * how to start the app end-to-end. There is one variant: it points the agent at the project's
 * `AGENTS.md` e2e-setup section (translate its prose to OS-appropriate commands), and if AGENTS.md
 * describes no e2e setup, skip browser e2e and leave it to the human. Mirrors renderTicketingInclude.
 * Returns null when no include path is configured (package always sets one).
 */
export function renderE2eInclude(config, globalTokens) {
  const includePath = config.app?.includePath;
  if (!includePath) return null;
  const src = path.join(SRC_DIR, 'includes', 'e2e-runtime.md');
  if (!fs.existsSync(src)) {
    throw new Error('e2e-runtime include selected but agent-src/includes/e2e-runtime.md not found');
  }
  const fragment = normalizeLF(fs.readFileSync(src, 'utf8'));
  let content = substituteTokens(fragment, globalTokens, null, 'includes/e2e-runtime.md');
  content = '<!-- DO NOT EDIT — generated from agent-src/includes/e2e-runtime.md; run `node agent-src/generate.mjs` -->\n\n' + content;
  if (!content.endsWith('\n')) content += '\n';
  return { path: includePath, content, plain: true };
}
