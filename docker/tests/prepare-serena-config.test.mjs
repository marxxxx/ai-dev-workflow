import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSerenaConfig } from '../tools/prepare-serena-config.mjs';

// Excerpt of serena/resources/serena_config.template.yml.
const template = `# agent interface
agent_interface: REPL

web_dashboard_open_on_launch:

ls_specific_settings: {}
`;

test('pins the classic tool interface, whatever the template defaults to', () => {
  const out = prepareSerenaConfig(template);
  assert.match(out, /^agent_interface: tools$/m);
  assert.doesNotMatch(out, /REPL/);
  assert.equal(prepareSerenaConfig(template.replace('REPL', 'tools')), out);
});

test('points the TypeScript language server at the image tools', () => {
  const out = prepareSerenaConfig(template);
  assert.match(out, /^ls_specific_settings:\n {2}typescript:\n {4}ls_path: \/opt\/agent-tools\/node_modules\/\.bin\/typescript-language-server$/m);
  assert.doesNotMatch(out, /ls_specific_settings: \{\}/);
});

test('leaves the tsserver pin to Serena', () => {
  assert.doesNotMatch(prepareSerenaConfig(template), /tsserver|initializationOptions/);
});

test('fails when the template no longer has a setting it rewrites', () => {
  assert.throws(() => prepareSerenaConfig(template.replace('agent_interface: REPL\n', '')), /agent_interface/);
  assert.throws(() => prepareSerenaConfig(template.replace('ls_specific_settings: {}\n', '')), /ls_specific_settings/);
});
