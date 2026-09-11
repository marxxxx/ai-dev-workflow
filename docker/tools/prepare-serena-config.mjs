import { readFileSync, writeFileSync } from 'node:fs';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error('usage: prepare-serena-config.mjs <source> <destination>');

const marker = 'ls_specific_settings: {}';
const input = readFileSync(source, 'utf8');
if (input.split(marker).length !== 2) throw new Error(`expected exactly one ${marker} marker`);

const managed = [
  'ls_specific_settings:',
  '  typescript:',
  '    ls_path: /opt/agent-tools/node_modules/.bin/typescript-language-server',
  '    initializationOptions:',
  '      tsserver:',
  '        path: /opt/agent-tools/node_modules/typescript-serena/lib/tsserver.js',
].join('\n');

writeFileSync(destination, input.replace(marker, managed));
