import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// No tsserver path: Serena pins tsserver itself for untrusted projects, to the TypeScript that
// serena-typescript.mjs links into its home, and custom initializationOptions would override that pin.
const managedLsSettings = [
  'ls_specific_settings:',
  '  typescript:',
  '    ls_path: /opt/agent-tools/node_modules/.bin/typescript-language-server',
].join('\n');

// Replaces the one line matching `pattern`; a template that lost or duplicated it fails the build.
function replaceOnce(input, pattern, replacement, name) {
  const matches = input.match(new RegExp(pattern.source, 'gm')) ?? [];
  if (matches.length !== 1) throw new Error(`expected exactly one ${name} line in the Serena config template`);
  return input.replace(new RegExp(pattern.source, 'm'), replacement);
}

// The image's serena_config.yml from Serena's template. Serena >= 2.1 defaults to the REPL interface, which
// offers only serena_repl; the agents and verify-mcp rely on the classic per-operation MCP tools.
export function prepareSerenaConfig(template) {
  const tools = replaceOnce(template, /^agent_interface:.*$/, 'agent_interface: tools', 'agent_interface');
  return replaceOnce(tools, /^ls_specific_settings: \{\}$/, managedLsSettings, 'ls_specific_settings: {}');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) throw new Error('usage: prepare-serena-config.mjs <source> <destination>');
  writeFileSync(destination, prepareSerenaConfig(readFileSync(source, 'utf8')));
}
