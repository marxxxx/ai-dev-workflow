// Ticketing outputs: the resolved include fragment + the azure-devops .mcp.json merge.

import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR } from './constants.mjs';
import { normalizeLF, dq } from './serialize.mjs';
import { substituteTokens } from './tokens.mjs';

/**
 * Render the resolved ticketing include — the runtime single-source-of-truth that
 * every agent/skill body points at. Selects the github/file variant per config and
 * substitutes global tokens. Returns null when no ticketing backend is configured.
 */
export function renderTicketingInclude(config, globalTokens) {
  const includePath = config.ticketing?.includePath;
  const backend = config.ticketing?.backend;
  if (!includePath || !backend) return null;
  const src = path.join(SRC_DIR, 'includes', `ticketing-${backend}.md`);
  if (!fs.existsSync(src)) {
    throw new Error(`ticketing backend "${backend}" selected but agent-src/includes/ticketing-${backend}.md not found`);
  }
  const fragment = normalizeLF(fs.readFileSync(src, 'utf8'));
  let content = substituteTokens(fragment, globalTokens, null, `includes/ticketing-${backend}.md`);
  content = `<!-- DO NOT EDIT — generated from agent-src/includes/ticketing-${backend}.md; run \`node agent-src/generate.mjs\` -->\n\n` + content;
  if (!content.endsWith('\n')) content += '\n';
  return { path: includePath, content, plain: true };
}

/**
 * For the azure-devops backend, merge the `ado` MCP server entry into the project's
 * .mcp.json, preserving any other servers and `inputs`. Returns null for other backends.
 * Reads current disk so `check` can re-merge and diff. Not banner-stamped — .mcp.json is
 * partly user-owned; the merge is keyed on the `ado` server name only.
 */
export function renderMcpJson(config, projectRoot) {
  if (config.ticketing?.backend !== 'azure-devops') return null;
  const org = config.ticketing?.azureDevOps?.organization;
  if (!org) {
    throw new Error('ticketing.azureDevOps.organization is required for the azure-devops backend');
  }
  const mcpPath = path.join(projectRoot, '.mcp.json');
  let doc = { mcpServers: {}, inputs: [] };
  if (fs.existsSync(mcpPath)) {
    try {
      doc = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    } catch (e) {
      throw new Error(`.mcp.json is not valid JSON: ${e.message}`);
    }
    if (!doc.mcpServers || typeof doc.mcpServers !== 'object') doc.mcpServers = {};
  }
  doc.mcpServers.ado = {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@azure-devops/mcp', org, '-d', 'core', 'work', 'work-items'],
  };
  return { path: '.mcp.json', content: JSON.stringify(doc, null, 2) + '\n' };
}

const CODEX_ADO_BEGIN = '# BEGIN ai-dev-workflow managed mcp_servers.ado';
const CODEX_ADO_END = '# END ai-dev-workflow managed mcp_servers.ado';

export function renderCodexAdoMcpBlock(org) {
  return [
    CODEX_ADO_BEGIN,
    '[mcp_servers.ado]',
    'command = "npx"',
    `args = [${['-y', '@azure-devops/mcp', org, '-d', 'core', 'work', 'work-items'].map(dq).join(', ')}]`,
    CODEX_ADO_END,
  ].join('\n');
}

export function mergeCodexAdoMcpBlock(existingContent, org) {
  const lines = normalizeLF(existingContent || '').split('\n');
  const kept = [];
  let skippingManaged = false;
  let skippingAdoTable = false;

  for (const line of lines) {
    if (line.trim() === CODEX_ADO_BEGIN) {
      skippingManaged = true;
      skippingAdoTable = false;
      continue;
    }
    if (skippingManaged) {
      if (line.trim() === CODEX_ADO_END) skippingManaged = false;
      continue;
    }
    if (/^\s*\[mcp_servers\.ado\]\s*(?:#.*)?$/.test(line)) {
      skippingAdoTable = true;
      continue;
    }
    if (skippingAdoTable && /^\s*\[/.test(line)) {
      skippingAdoTable = false;
    }
    if (skippingAdoTable) continue;
    kept.push(line);
  }

  let prefix = kept.join('\n').replace(/\s+$/u, '');
  const block = renderCodexAdoMcpBlock(org);
  if (prefix.length > 0) prefix += '\n\n';
  return `${prefix}${block}\n`;
}

export function renderCodexAdoMcpToml(config, projectRoot) {
  if (config.ticketing?.backend !== 'azure-devops') return null;
  const org = config.ticketing?.azureDevOps?.organization;
  if (!org) {
    throw new Error('ticketing.azureDevOps.organization is required for the azure-devops backend');
  }
  const configPath = path.join(projectRoot, '.codex', 'config.toml');
  const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  return {
    path: path.join('.codex', 'config.toml'),
    content: mergeCodexAdoMcpBlock(existing, org),
  };
}
