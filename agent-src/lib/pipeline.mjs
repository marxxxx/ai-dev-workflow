// Orchestration: renderAll (config → tokens → units → outputs), plus writeAll / checkAll.

import fs from 'node:fs';
import path from 'node:path';
import { KNOWN_PLATFORMS, TICKETING_AGENTS, ADO_MCP_TOOLS } from './constants.mjs';
import { loadConfig, buildGlobalTokens } from './config.mjs';
import { loadUnits } from './units.mjs';
import { substituteManifestStrings, resolveBody } from './tokens.mjs';
import { renderTicketingInclude, renderMcpJson } from './ticketing.mjs';
import { renderE2eInclude } from './app.mjs';
import { RENDERERS, smokeCheck } from './renderers.mjs';

export function renderAll(projectRoot) {
  const config = loadConfig(projectRoot);
  if (config.ticketing?.backend === 'azure-devops' && !config.ticketing?.azureDevOps?.organization) {
    throw new Error('ticketing.azureDevOps.organization is required for the azure-devops backend');
  }
  const globalTokens = buildGlobalTokens(config);
  const units = loadUnits();
  for (const unit of units) substituteManifestStrings(unit, globalTokens);

  const outputs = []; // { path, content }
  const seenPaths = new Set();

  // The resolved ticketing include — referenced at runtime by every body.
  const ticketing = renderTicketingInclude(config, globalTokens);
  if (ticketing) {
    if (/\{\{.*?\}\}/.test(ticketing.content)) {
      throw new Error(`Ticketing include: unresolved placeholder in ${ticketing.path}`);
    }
    seenPaths.add(ticketing.path);
    outputs.push(ticketing);
  }

  // The resolved e2e-runtime include — the qa-engineer's single source of truth for app startup.
  const e2e = renderE2eInclude(config, globalTokens);
  if (e2e) {
    if (/\{\{.*?\}\}/.test(e2e.content)) {
      throw new Error(`E2E include: unresolved placeholder in ${e2e.path}`);
    }
    seenPaths.add(e2e.path);
    outputs.push(e2e);
  }

  // The azure-devops backend also owns the `ado` entry in .mcp.json (non-destructive merge).
  const mcp = renderMcpJson(config, projectRoot);
  if (mcp) {
    seenPaths.add(mcp.path);
    outputs.push(mcp);
  }

  // azure-devops backend: give ticketing agents access to the `ado` MCP tools on Claude.
  if (config.ticketing?.backend === 'azure-devops') {
    for (const unit of units) {
      if (unit.kind !== 'agent' || !TICKETING_AGENTS.includes(unit.name)) continue;
      const claude = unit.manifest.platforms?.claude;
      if (!claude || !Array.isArray(claude.tools)) continue;
      for (const tool of ADO_MCP_TOOLS) {
        if (!claude.tools.includes(tool)) claude.tools.push(tool);
      }
    }
  }

  for (const unit of units) {
    const platforms = unit.manifest.platforms || {};
    for (const platform of Object.keys(platforms)) {
      if (!KNOWN_PLATFORMS.includes(platform)) {
        throw new Error(`Unit ${unit.kind}/${unit.name}: unknown platform "${platform}"`);
      }
    }
    // Validate declared overlays exist (every overlay file under overlays/ keys a known platform).
    for (const overlayPlatform of Object.keys(unit.overlays)) {
      if (!KNOWN_PLATFORMS.includes(overlayPlatform)) {
        throw new Error(`Unit ${unit.kind}/${unit.name}: overlay for unknown platform "${overlayPlatform}"`);
      }
    }

    for (const platform of Object.keys(platforms)) {
      const render = RENDERERS[unit.kind][platform];
      if (!render) throw new Error(`No renderer for ${unit.kind}/${platform}`);
      const body = resolveBody(unit, platform, globalTokens);
      for (const out of render(unit, body)) {
        if (/\{\{.*?\}\}/.test(out.content)) {
          throw new Error(`Unit ${unit.kind}/${unit.name} (${platform}): unresolved placeholder in ${out.path}`);
        }
        if (seenPaths.has(out.path)) {
          throw new Error(`Duplicate output path declared: ${out.path}`);
        }
        seenPaths.add(out.path);
        smokeCheck(out, platform, unit);
        outputs.push(out);
      }
    }
  }
  return outputs;
}

export function writeAll(outputs, projectRoot) {
  for (const out of outputs) {
    const abs = path.join(projectRoot, out.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, out.content);
  }
  console.log(`Generated ${outputs.length} file(s) from agent-src/.`);
}

export function checkAll(outputs, projectRoot) {
  const stale = [];
  for (const out of outputs) {
    const abs = path.join(projectRoot, out.path);
    const onDisk = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    if (onDisk !== out.content) {
      stale.push({ path: out.path, missing: onDisk === null });
    }
  }
  if (stale.length === 0) {
    console.log(`--check: ${outputs.length} file(s) up to date.`);
    return 0;
  }
  console.error(`--check: ${stale.length} file(s) stale or missing:`);
  for (const s of stale) console.error(`  ${s.missing ? '[missing]' : '[stale]  '} ${s.path}`);
  console.error('Run `node agent-src/generate.mjs` to regenerate.');
  return 1;
}
