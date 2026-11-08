// Documentation output: the include agent-dev reads when it writes code or updates documentation.

import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR } from './constants.mjs';
import { normalizeLF } from './serialize.mjs';
import { substituteTokens } from './tokens.mjs';

const SKILL = 'documentation-and-adrs';

/** The documentation rules are on unless the project opted out of the skill that carries them. */
export function documentationEnabled(config) {
  return config.skills?.[SKILL] !== false;
}

function fragment(name, globalTokens) {
  const src = path.join(SRC_DIR, 'includes', name);
  if (!fs.existsSync(src)) throw new Error(`documentation include selected but agent-src/includes/${name} not found`);
  return substituteTokens(normalizeLF(fs.readFileSync(src, 'utf8')), globalTokens, null, `includes/${name}`);
}

/**
 * Render the documentation include: the comment rules always, then the documentation rules (architecture
 * docs, ADRs, README/changelog) when documentationEnabled, otherwise the note that this project documents
 * elsewhere. Returns null without an include path.
 */
export function renderDocumentationInclude(config, globalTokens) {
  const includePath = config.documentation?.includePath;
  if (!includePath) return null;
  const parts = [fragment('documentation-comments.md', globalTokens)];
  parts.push(fragment(documentationEnabled(config) ? 'documentation-docs.md' : 'documentation-off.md', globalTokens));
  let content = '<!-- DO NOT EDIT — generated from agent-src/includes/documentation-*.md; run `node agent-src/generate.mjs` -->\n\n'
    + parts.join('');
  if (!content.endsWith('\n')) content += '\n';
  return { path: includePath, content, plain: true };
}
