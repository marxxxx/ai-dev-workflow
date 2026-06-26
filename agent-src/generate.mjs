#!/usr/bin/env node
// Generator for single-source agent & skill definitions.
//
// Reads the canonical units under agent-src/{agents,skills}/<name>/ (body.md +
// manifest.json, optional overlays/<platform>.md) and renders each platform's files.
//
//   node agent-src/generate.mjs          write all platform files
//   node agent-src/generate.mjs --check  render in-memory, diff against disk, exit 1 on drift
//
// Zero dependencies: node:fs + node:path only. Writes LF line endings on every platform.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(SRC_DIR);
const KNOWN_PLATFORMS = ['claude', 'codex', 'opencode'];

// ---------------------------------------------------------------------------
// Small serializers (we WRITE known field sets; we never parse YAML/TOML).
// ---------------------------------------------------------------------------

/** Double-quote and escape a string for YAML/TOML basic strings. */
function dq(s) {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}

/** Emit a YAML scalar plain when safe, double-quoted otherwise. */
function yamlScalar(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const s = String(value);
  const needsQuote =
    s === '' ||
    /^\s|\s$/.test(s) ||              // leading/trailing whitespace
    /[:#]\s/.test(s) ||              // "key: val" or " # comment" ambiguity
    /\s#/.test(s) ||
    /:$/.test(s) ||                  // trailing colon
    /[\n"\\]/.test(s) ||
    /^[-?!&*|>%@`'"#,\[\]{}]/.test(s); // leading indicator char
  return needsQuote ? dq(s) : s;
}

// ---------------------------------------------------------------------------
// Unit loading
// ---------------------------------------------------------------------------

function normalizeLF(text) {
  return text.replace(/\r\n/g, '\n');
}

function loadUnits() {
  const units = [];
  for (const type of ['agents', 'skills']) {
    const dir = path.join(SRC_DIR, type);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      const unitDir = path.join(dir, name);
      if (!fs.statSync(unitDir).isDirectory()) continue;
      const bodyPath = path.join(unitDir, 'body.md');
      const manifestPath = path.join(unitDir, 'manifest.json');
      if (!fs.existsSync(bodyPath) || !fs.existsSync(manifestPath)) {
        throw new Error(`Unit ${type}/${name} is missing body.md or manifest.json`);
      }
      const body = normalizeLF(fs.readFileSync(bodyPath, 'utf8'));
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const overlays = {};
      const overlayDir = path.join(unitDir, 'overlays');
      if (fs.existsSync(overlayDir)) {
        for (const f of fs.readdirSync(overlayDir)) {
          if (f.endsWith('.md')) {
            overlays[f.replace(/\.md$/, '')] = normalizeLF(fs.readFileSync(path.join(overlayDir, f), 'utf8'));
          }
        }
      }
      units.push({ kind: type === 'agents' ? 'agent' : 'skill', name, unitDir, body, manifest, overlays });
    }
  }
  return units;
}

// ---------------------------------------------------------------------------
// Central project config → global tokens
// ---------------------------------------------------------------------------

/**
 * Read the single source of truth for project identity + ticketing.
 * Returns {} when absent so the generator still runs on a fresh/unmigrated repo.
 */
function loadConfig() {
  const p = path.join(SRC_DIR, 'project.json');
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`agent-src/project.json is not valid JSON: ${e.message}`);
  }
}

/**
 * Flatten the structured config into the dotted `{{token}}` namespace shared by
 * every unit body and manifest string. Status tokens resolve to the GitHub label
 * or the file-frontmatter value depending on the selected backend.
 */
function buildGlobalTokens(config) {
  const c = config || {};
  const t = {};
  const put = (k, v) => { if (v != null) t[k] = String(v); };

  put('project.name', c.project?.name);
  put('project.slug', c.project?.slug);
  put('project.serena', c.project?.serenaProject);
  put('project.description', c.project?.description);

  put('repo.slug', c.repository?.slug);
  put('repo.defaultBranch', c.repository?.defaultBranch);

  const backend = c.ticketing?.backend || 'github';
  put('ticketing.backend', backend);
  put('ticketing.include', c.ticketing?.includePath);
  put('ticketing.itemNoun', c.ticketing?.itemNoun || 'issue');
    put('ticketing.dir', c.ticketing?.file?.dir);
  put('ticketing.metadataFile', c.ticketing?.file?.metadataFile);

  put('git.branchPattern', c.git?.branchPattern);
  put('git.prTarget', c.git?.prTarget);

  for (const [k, v] of Object.entries(c.workflow?.artifacts || {})) put(`artifact.${k}`, v);
  for (const s of c.workflow?.states || []) {
    put(`status.${s.id}`, backend === 'github' ? s.label : s.frontmatter);
  }

  // Free-form escape hatch: config.tokens overrides any derived token.
  for (const [k, v] of Object.entries(c.tokens || {})) put(k, v);

  return t;
}

// ---------------------------------------------------------------------------
// Token substitution + body assembly
// ---------------------------------------------------------------------------

/** Global tokens are the base; per-unit manifest.tokens override by key. */
function mergeTokens(globalTokens, unitTokens) {
  return { ...globalTokens, ...(unitTokens || {}) };
}

/**
 * Substitute {{token}} occurrences in `text`. A token value may be a string or a
 * per-platform map (resolved with `platform`). Throws on any undefined token or a
 * per-platform map that lacks the active platform.
 */
function substituteTokens(text, tokens, platform, where) {
  for (const m of text.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) {
    if (!(m[1] in tokens)) {
      throw new Error(`${where}: uses {{${m[1]}}} with no matching token (global or unit)`);
    }
  }
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, token) => {
    const def = tokens[token];
    const val = def && typeof def === 'object' ? def[platform] : def;
    if (val == null) {
      throw new Error(`${where}: token {{${token}}} has no value for ${platform}`);
    }
    return String(val);
  });
}

/** Resolve tokens in a platform-neutral string (manifest description / interface). */
function substituteNeutral(text, tokens, where) {
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, token) => {
    if (!(token in tokens)) {
      throw new Error(`${where}: uses {{${token}}} with no matching token`);
    }
    const def = tokens[token];
    if (def && typeof def === 'object') {
      throw new Error(`${where}: token {{${token}}} is per-platform; manifest strings must be neutral`);
    }
    return String(def);
  });
}

/**
 * Resolve tokens in the manifest's platform-neutral strings (description and, for
 * skills, the interface descriptor) once per unit, before any renderer reads them.
 * Mutates the in-memory manifest.
 */
function substituteManifestStrings(unit, globalTokens) {
  const tokens = mergeTokens(globalTokens, unit.manifest.tokens);
  if (typeof unit.manifest.description === 'string') {
    unit.manifest.description = substituteNeutral(
      unit.manifest.description, tokens, `${unit.kind}/${unit.name} manifest.description`);
  }
  const iface = unit.manifest.interface;
  if (iface) {
    for (const k of ['display_name', 'short_description', 'default_prompt']) {
      if (typeof iface[k] === 'string') {
        iface[k] = substituteNeutral(iface[k], tokens, `${unit.kind}/${unit.name} interface.${k}`);
      }
    }
  }
}

function resolveBody(unit, platform, globalTokens) {
  const tokens = mergeTokens(globalTokens, unit.manifest.tokens);
  let body = substituteTokens(unit.body, tokens, platform, `${unit.kind}/${unit.name} body`);

  // Append the platform overlay if present (overlays get the same token treatment).
  if (unit.overlays[platform]) {
    const ov = substituteTokens(
      unit.overlays[platform], tokens, platform, `${unit.kind}/${unit.name} overlay:${platform}`);
    body = body.replace(/\n+$/, '\n') + '\n' + ov;
  }
  if (!body.endsWith('\n')) body += '\n';
  return body;
}

/**
 * Render the resolved ticketing include — the runtime single-source-of-truth that
 * every agent/skill body points at. Selects the github/file variant per config and
 * substitutes global tokens. Returns null when no ticketing backend is configured.
 */
function renderTicketingInclude(config, globalTokens) {
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

// ---------------------------------------------------------------------------
// Renderers — return { path, content } per platform
// ---------------------------------------------------------------------------

function banner(unit, commentStyle) {
  const text = `DO NOT EDIT — generated from agent-src/${unit.kind === 'agent' ? 'agents' : 'skills'}/${unit.name}; run \`node agent-src/generate.mjs\``;
  if (commentStyle === 'toml' || commentStyle === 'yaml') return `# ${text}`;
  return `<!-- ${text} -->`;
}

function frontmatterDoc(unit, fields, body) {
  const lines = ['---'];
  for (const [key, value] of fields) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${yamlScalar(item)}`);
    } else {
      lines.push(`${key}: ${yamlScalar(value)}`);
    }
  }
  lines.push('---');
  return lines.join('\n') + '\n' + banner(unit, 'html') + '\n\n' + body;
}

function renderClaudeAgent(unit, body) {
  const cfg = unit.manifest.platforms.claude;
  const fields = [
    ['name', unit.manifest.name],
    ['description', unit.manifest.description],
    ['model', cfg.model],
    ['tools', cfg.tools],
  ];
  return [{ path: path.join('.claude', 'agents', `${unit.name}.md`), content: frontmatterDoc(unit, fields, body) }];
}

function renderClaudeSkill(unit, body) {
  const fields = [
    ['name', unit.manifest.name],
    ['description', unit.manifest.description],
  ];
  return [{ path: path.join('.claude', 'skills', unit.name, 'SKILL.md'), content: frontmatterDoc(unit, fields, body) }];
}

function renderCodexAgent(unit, body) {
  const cfg = unit.manifest.platforms.codex;
  const lines = [banner(unit, 'toml')];
  lines.push(`name = ${dq(unit.manifest.name)}`);
  lines.push(`description = ${dq(unit.manifest.description)}`);
  if (cfg.nickname_candidates) {
    lines.push(`nickname_candidates = [${cfg.nickname_candidates.map(dq).join(', ')}]`);
  }
  lines.push(`model = ${dq(cfg.model)}`);
  if (cfg.model_reasoning_effort) {
    lines.push(`model_reasoning_effort = ${dq(cfg.model_reasoning_effort)}`);
  }
  lines.push('');
  lines.push('developer_instructions = """');
  const content = lines.join('\n') + '\n' + body + '"""\n';
  return [{ path: path.join('.codex', 'agents', `${unit.name}.toml`), content }];
}

function renderOpenCodeAgent(unit, body) {
  const cfg = unit.manifest.platforms.opencode;
  const fields = [
    ['description', unit.manifest.description],
    ['mode', cfg.mode],
    ['model', cfg.model],
    ['temperature', cfg.temperature],
  ];
  return [{ path: path.join('.opencode', 'agents', `${unit.name}.md`), content: frontmatterDoc(unit, fields, body) }];
}

function renderOpenCodeSkill(unit, body) {
  const fields = [
    ['name', unit.manifest.name],
    ['description', unit.manifest.description],
  ];
  return [{ path: path.join('.opencode', 'skills', unit.name, 'SKILL.md'), content: frontmatterDoc(unit, fields, body) }];
}

function renderCodexSkill(unit, body) {
  const fields = [
    ['name', unit.manifest.name],
    ['description', unit.manifest.description],
  ];
  const outputs = [
    { path: path.join('.agents', 'skills', unit.name, 'SKILL.md'), content: frontmatterDoc(unit, fields, body) },
  ];
  const iface = unit.manifest.interface;
  if (!iface) {
    throw new Error(`Skill ${unit.name}: codex platform requires an "interface" descriptor in manifest.json`);
  }
  const yamlLines = [
    banner(unit, 'yaml'),
    'interface:',
    `  display_name: ${dq(iface.display_name)}`,
    `  short_description: ${dq(iface.short_description)}`,
    `  default_prompt: ${dq(iface.default_prompt)}`,
  ];
  outputs.push({
    path: path.join('.agents', 'skills', unit.name, 'agents', 'openai.yaml'),
    content: yamlLines.join('\n') + '\n',
  });
  return outputs;
}

const RENDERERS = {
  agent: { claude: renderClaudeAgent, codex: renderCodexAgent, opencode: renderOpenCodeAgent },
  skill: { claude: renderClaudeSkill, codex: renderCodexSkill, opencode: renderOpenCodeSkill },
};

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function renderAll() {
  const config = loadConfig();
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

/** Deterministic smoke checks over the known field sets we emit. */
function smokeCheck(out, platform, unit) {
  if (out.path.endsWith('.toml')) {
    if (!out.content.split('\n').some((l) => l.startsWith('name = '))) {
      throw new Error(`TOML ${out.path}: missing name field`);
    }
    if (!out.content.includes('developer_instructions = """')) {
      throw new Error(`TOML ${out.path}: missing developer_instructions block`);
    }
  } else if (out.path.endsWith('openai.yaml')) {
    if (!out.content.includes('interface:')) throw new Error(`${out.path}: missing interface block`);
  } else if (out.path.endsWith('.md')) {
    if (!out.content.startsWith('---\n')) {
      throw new Error(`Markdown ${out.path}: frontmatter must start at byte 1`);
    }
  }
}

function writeAll(outputs) {
  for (const out of outputs) {
    const abs = path.join(REPO_ROOT, out.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, out.content);
  }
  console.log(`Generated ${outputs.length} file(s) from agent-src/.`);
}

function checkAll(outputs) {
  const stale = [];
  for (const out of outputs) {
    const abs = path.join(REPO_ROOT, out.path);
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

function main() {
  const check = process.argv.includes('--check');
  let outputs;
  try {
    outputs = renderAll();
  } catch (err) {
    console.error(`Generation failed: ${err.message}`);
    process.exit(1);
  }
  process.exit(check ? checkAll(outputs) : (writeAll(outputs), 0));
}

main();
