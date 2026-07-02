// Per-platform renderers — each returns { path, content } outputs — plus the RENDERERS
// dispatch table and the deterministic smokeCheck over the field sets we emit.

import path from 'node:path';
import { dq, yamlScalar } from './serialize.mjs';

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

export const RENDERERS = {
  agent: { claude: renderClaudeAgent, codex: renderCodexAgent, opencode: renderOpenCodeAgent },
  skill: { claude: renderClaudeSkill, codex: renderCodexSkill, opencode: renderOpenCodeSkill },
};

/** Deterministic smoke checks over the known field sets we emit. */
export function smokeCheck(out, platform, unit) {
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
