#!/usr/bin/env node
// Generator for single-source agent & skill definitions.
//
// Reads the canonical units under agent-src/{agents,skills}/<name>/ (body.md +
// manifest.json, optional overlays/<platform>.md) and renders each platform's files.
//
// Invoke directly during in-repo dev, or via the `ai-dev-workflow` bin once installed:
//   ai-dev-workflow generate            write all platform files (default command)
//   ai-dev-workflow check               render in-memory, diff against disk, exit 1 on drift
//   ai-dev-workflow init                scaffold ai-project.json from the template (never overwrites)
//   ai-dev-workflow <cmd> --root <dir>  target a project root other than cwd
//
// `--check` is still accepted as a legacy alias for the `check` command.
//
// Config is split across two files:
//   - ai-workflow.json  (package-owned, next to this script): workflow states/artifacts +
//                        ticketing.includePath. Travels and updates with the package.
//   - ai-project.json   (project-owned, at the project root): project/repository/git identity
//                        and the ticketing backend choice (file | github).
//
// Zero dependencies: node:fs + node:path only. Writes LF line endings on every platform.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// SRC_DIR is where the package payload lives (this script + its sources). PROJECT_ROOT is the
// consuming project: where ai-project.json is read from and where generated files are written.
// They coincide during in-repo dev; they diverge once the package is installed under node_modules.
const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const KNOWN_PLATFORMS = ['claude', 'codex', 'opencode'];

// Agents that perform ticketing operations and therefore need the azure-devops MCP tools
// added to their Claude allowlist when that backend is selected.
const TICKETING_AGENTS = ['developer', 'code-reviewer', 'qa-engineer'];
const ADO_MCP_TOOLS = [
  'mcp__ado__wit_query_by_wiql',
  'mcp__ado__wit_get_work_item',
  'mcp__ado__wit_list_work_item_comments',
  'mcp__ado__wit_create_work_item',
  'mcp__ado__wit_update_work_item',
  'mcp__ado__wit_add_work_item_comment',
];

/** Resolve the project root: `--root <dir>` if given, else the current working directory. */
function resolveProjectRoot(argv) {
  const i = argv.indexOf('--root');
  if (i !== -1 && argv[i + 1]) return path.resolve(argv[i + 1]);
  return process.cwd();
}

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
// Onboarding helpers (pure)
// ---------------------------------------------------------------------------

/** Lower-case, collapse non-alphanumerics to single dashes, trim dashes. */
function kebabCase(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Extract `owner/repo` (or the Azure repo name) from a git remote URL. */
function slugFromRemoteUrl(url) {
  const u = url.trim().replace(/\.git$/, '');
  const ado = u.match(/dev\.azure\.com\/[^/]+\/[^/]+\/_git\/([^/]+)$/);
  if (ado) return ado[1];
  const ssh = u.match(/^[^@\s]+@[^:]+:(.+)$/); // git@host:owner/repo
  if (ssh) return ssh[1];
  const https = u.match(/^https?:\/\/[^/]+\/(.+)$/); // https://host/owner/repo
  if (https) return https[1];
  return '';
}

/** Parse the origin remote's slug from raw .git/config text. '' when absent/unparseable. */
function parseOriginSlug(gitConfigText) {
  if (!gitConfigText) return '';
  let inOrigin = false;
  for (const raw of gitConfigText.split('\n')) {
    const line = raw.trim();
    const sec = line.match(/^\[(.+?)\]$/);
    if (sec) { inOrigin = /^remote\s+"origin"$/.test(sec[1]); continue; }
    if (inOrigin) {
      const m = line.match(/^url\s*=\s*(.+)$/);
      if (m) return slugFromRemoteUrl(m[1]);
    }
  }
  return '';
}

/** Azure DevOps process template → work-item types + workflow-state→board-state map. */
const AZURE_TEMPLATES = {
  basic: {
    featureType: 'Issue',
    bugType: 'Issue',
    stateMapping: {
      'new': 'To Do', 'in-progress': 'Doing', 'review': 'Doing',
      'test': 'Doing', 'failed': 'Doing', 'acceptance-test': 'Doing',
    },
  },
  scrum: {
    featureType: 'Product Backlog Item',
    bugType: 'Bug',
    stateMapping: {
      'new': 'New', 'in-progress': 'Committed', 'review': 'Committed',
      'test': 'Committed', 'failed': 'Committed', 'acceptance-test': 'Committed',
    },
  },
};

function azureMapping(template) {
  const m = AZURE_TEMPLATES[template];
  if (!m) throw new Error(`unknown Azure process template "${template}" (expected basic|scrum)`);
  return m;
}

/** Assemble the project-owned ai-project.json object from flat interview answers. */
function buildProjectConfig(a) {
  const ticketing = { backend: a.backend, itemNoun: a.itemNoun || 'issue' };
  if (a.backend === 'file') {
    ticketing.file = { dir: a.file.dir, metadataFile: a.file.metadataFile };
  } else if (a.backend === 'azure-devops') {
    const m = azureMapping(a.azure.processTemplate);
    ticketing.azureDevOps = {
      organization: a.azure.organization,
      project: a.azure.project,
      featureType: m.featureType,
      bugType: m.bugType,
      processTemplate: a.azure.processTemplate,
      stateMapping: m.stateMapping,
    };
  }
  return {
    project: { name: a.name, slug: a.slug, serenaProject: a.serena, description: a.description },
    repository: { slug: a.repoSlug, defaultBranch: a.defaultBranch },
    ticketing,
    git: { branchPattern: a.branchPattern, prTarget: a.prTarget },
  };
}

/** Render docs/ai-workflow-setup.md: recommended plugins + (for azure) the ado MCP note. */
function renderSetupDoc(config) {
  const azure = config.ticketing?.backend === 'azure-devops';
  const lines = [
    '<!-- DO NOT EDIT — generated by `ai-dev-workflow init`; re-run init to refresh. -->',
    '',
    `# AI Workflow Setup — ${config.project?.name || 'your project'}`,
    '',
    'This workflow is designed for **Claude Code** with three recommended plugins / MCP',
    'servers. Install them once per machine (or per project where noted).',
    '',
    '## superpowers',
    '',
    'Skill library that drives the brainstorm → plan → implement workflow. Install from the',
    'official Claude Code plugin marketplace:',
    '',
    '```',
    '/plugin install superpowers@claude-plugins-official',
    '```',
    '',
    '## context7',
    '',
    'MCP server that fetches up-to-date library/framework documentation on demand. Run the',
    'guided setup and pick **Claude Code** as the target (handles API-key OAuth for you):',
    '',
    '```bash',
    'npx ctx7 setup',
    '```',
    '',
    'Manual alternative: point your MCP client at `https://mcp.context7.com/mcp` and pass your',
    'key via the `CONTEXT7_API_KEY` header.',
    '',
    '## serena',
    '',
    'MCP server providing semantic, symbol-level code navigation and editing. Add it to Claude',
    'Code (per project shown; use `--scope user` for all projects):',
    '',
    '```bash',
    'claude mcp add serena -- serena start-mcp-server --context claude-code --project "$(pwd)"',
    '```',
    '',
    'Install Serena itself first per its docs (`uv tool install -p 3.13 serena-agent`). Do **not**',
    'install Serena through a plugin marketplace — follow the Serena Quick Start.',
    '',
  ];
  if (azure) {
    lines.push(
      '## Azure DevOps `ado` MCP server',
      '',
      'For the `azure-devops` ticketing backend, `ai-dev-workflow generate` automatically merges an',
      '`ado` server entry into `.mcp.json` (the `@azure-devops/mcp` server handles its own auth).',
      'Nothing to install by hand — just run `generate` and reload your MCP servers.',
      '',
    );
  }
  lines.push(
    '## Next steps',
    '',
    '1. `npx github:marxxxx/ai-dev-workflow generate` — render the platform files.',
    '2. Commit `ai-project.json` and the generated `.claude/`, `.codex/`, `.opencode/`, `.agents/` dirs.',
    '',
  );
  return lines.join('\n');
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

/** Read and parse a JSON file. Returns null when absent unless `required`. */
function readJson(absPath, label, required) {
  if (!fs.existsSync(absPath)) {
    if (required) throw new Error(`${label} not found at ${absPath}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (e) {
    throw new Error(`${label} is not valid JSON: ${e.message}`);
  }
}

/**
 * Merge the two config sources into the single object the token builder consumes:
 *   - workflow states/artifacts and ticketing.includePath come from the package
 *     (ai-workflow.json) — they are skill-coupled and must not be reconfigured per project.
 *   - project/repository/git identity and the ticketing backend choice come from the
 *     project (ai-project.json).
 * The package wins on `workflow` and on `ticketing.includePath`; the project owns the rest of
 * `ticketing` (backend, itemNoun, github/file sub-configs). ai-project.json may be absent on a
 * fresh/unmigrated repo, in which case only the package-owned config is returned.
 */
function loadConfig(projectRoot) {
  const pkg = readJson(path.join(SRC_DIR, 'ai-workflow.json'), 'agent-src/ai-workflow.json', true);
  const project = readJson(path.join(projectRoot, 'ai-project.json'), 'ai-project.json', false) || {};
  return {
    ...project,
    workflow: pkg.workflow,
    ticketing: { ...(project.ticketing || {}), includePath: pkg.ticketing?.includePath },
  };
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
  put('ticketing.azure.organization', c.ticketing?.azureDevOps?.organization);
  put('ticketing.azure.project', c.ticketing?.azureDevOps?.project);
  put('ticketing.azure.featureType', c.ticketing?.azureDevOps?.featureType || 'Issue');
  put('ticketing.azure.bugType', c.ticketing?.azureDevOps?.bugType || 'Issue');

  put('git.branchPattern', c.git?.branchPattern);
  put('git.prTarget', c.git?.prTarget);

  for (const [k, v] of Object.entries(c.workflow?.artifacts || {})) put(`artifact.${k}`, v);
  const usesTagLabels = backend === 'github' || backend === 'azure-devops';
  const azMap = c.ticketing?.azureDevOps?.stateMapping || {};
  for (const s of c.workflow?.states || []) {
    put(`status.${s.id}`, usesTagLabels ? s.label : s.frontmatter);
    put(`azureState.${s.id}`, azMap[s.id] || s.azureState);
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

/**
 * For the azure-devops backend, merge the `ado` MCP server entry into the project's
 * .mcp.json, preserving any other servers and `inputs`. Returns null for other backends.
 * Reads current disk so `check` can re-merge and diff. Not banner-stamped — .mcp.json is
 * partly user-owned; the merge is keyed on the `ado` server name only.
 */
function renderMcpJson(config, projectRoot) {
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

function renderAll(projectRoot) {
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

function writeAll(outputs, projectRoot) {
  for (const out of outputs) {
    const abs = path.join(projectRoot, out.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, out.content);
  }
  console.log(`Generated ${outputs.length} file(s) from agent-src/.`);
}

function checkAll(outputs, projectRoot) {
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

/** The first non-flag argument is the command; `--root <dir>` and its value are skipped. */
function parseCommand(argv) {
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--root') { i++; continue; } // skip the value that follows --root
    if (a.startsWith('-')) continue;
    return a;
  }
  return args.includes('--check') ? 'check' : 'generate';
}

/** Scaffold ai-project.json at the project root from the shipped template; never overwrite. */
function cmdInit(projectRoot) {
  const template = path.join(SRC_DIR, 'ai-project.template.json');
  if (!fs.existsSync(template)) throw new Error(`scaffold template missing at ${template}`);
  const dest = path.join(projectRoot, 'ai-project.json');
  if (fs.existsSync(dest)) {
    console.log(`ai-project.json already exists at ${dest} — left untouched.`);
    return 0;
  }
  fs.copyFileSync(template, dest);
  console.log(`Created ${dest}.\nEdit project identity + ticketing.backend, then run \`ai-dev-workflow generate\`.`);
  return 0;
}

function main() {
  const command = parseCommand(process.argv);
  const projectRoot = resolveProjectRoot(process.argv);

  if (command === 'init') {
    try {
      process.exit(cmdInit(projectRoot));
    } catch (err) {
      console.error(`init failed: ${err.message}`);
      process.exit(1);
    }
  }

  if (command !== 'generate' && command !== 'check') {
    console.error(`Unknown command "${command}". Use: generate | check | init`);
    process.exit(1);
  }

  let outputs;
  try {
    outputs = renderAll(projectRoot);
  } catch (err) {
    console.error(`Generation failed: ${err.message}`);
    process.exit(1);
  }
  process.exit(command === 'check' ? checkAll(outputs, projectRoot) : (writeAll(outputs, projectRoot), 0));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { buildGlobalTokens, loadConfig, kebabCase, parseOriginSlug, azureMapping, buildProjectConfig, renderSetupDoc };
