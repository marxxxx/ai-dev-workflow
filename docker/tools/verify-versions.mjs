// Verifies that an image contains exactly the versions recorded in inventory.json.
// Runs inside the image: node verify-versions.mjs [base|node|dotnet]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const TOOLS = '/opt/agent-tools';
const BIN = `${TOOLS}/node_modules/.bin`;
const SERENA_RECEIPT = '/opt/uv/tools/serena-agent/uv-receipt.toml';
const VARIANTS = ['base', 'node', 'dotnet'];

// "npm:typescript@5.9.3" -> "5.9.3"; plain versions are returned unchanged.
export function versionOf(spec) {
  return spec.slice(spec.lastIndexOf('@') + 1);
}

export function outputHasVersion(output, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^0-9A-Za-z.])v?${escaped}($|[^0-9A-Za-z.])`).test(output);
}

export function versionChecks(inventory, variant) {
  if (!VARIANTS.includes(variant)) throw new Error(`unknown image variant: ${variant}`);
  const npm = name => versionOf(inventory.npmPackages[name]);
  const checks = [
    { label: 'node', expected: inventory.baseImage.node, command: ['node', '--version'] },
    { label: 'claude', expected: npm('@anthropic-ai/claude-code'), command: [`${BIN}/claude`, '--version'] },
    { label: 'codex', expected: npm('@openai/codex'), command: [`${BIN}/codex`, '--version'] },
    { label: 'opencode', expected: npm('opencode-ai'), command: [`${BIN}/opencode`, '--version'] },
    { label: 'uv', expected: inventory.systemTools.uv, command: ['uv', '--version'] },
    { label: 'az', expected: inventory.systemTools.azureCliDebianPackage.split('-')[0], command: ['az', 'version', '--output', 'json'] },
    { label: 'serena', expected: `rev=${inventory.sourceRevisions.serena}`, file: SERENA_RECEIPT },
    ...Object.keys(inventory.npmPackages).map(name => ({
      label: `package ${name}`, expected: npm(name), file: `${TOOLS}/node_modules/${name}/package.json`, jsonField: 'version',
    })),
  ];
  if (variant === 'node') {
    checks.push(
      { label: 'pnpm', expected: npm('pnpm'), command: [`${BIN}/pnpm`, '--version'] },
      { label: 'yarn', expected: npm('yarn'), command: [`${BIN}/yarn`, '--version'] },
      { label: 'tsc', expected: npm('typescript'), command: [`${BIN}/tsc`, '--version'] },
      { label: 'typescript-language-server', expected: npm('typescript-language-server'), command: [`${BIN}/typescript-language-server`, '--version'] },
    );
  }
  if (variant === 'dotnet') {
    checks.push({ label: 'dotnet', expected: inventory.derivedImages.dotnetSdk, command: ['dotnet', '--version'] });
  }
  return checks;
}

function execCommand([command, ...args]) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
}

export function runChecks(checks, { exec = execCommand, readFile = file => readFileSync(file, 'utf8') } = {}) {
  const failures = [];
  for (const check of checks) {
    try {
      if (check.command) {
        const output = exec(check.command);
        if (!outputHasVersion(output, check.expected)) {
          failures.push(`${check.label}: expected ${check.expected}, got "${output.trim().split('\n')[0]}"`);
        }
      } else if (check.jsonField) {
        const actual = JSON.parse(readFile(check.file))[check.jsonField];
        if (actual !== check.expected) failures.push(`${check.label}: expected ${check.expected}, installed ${actual}`);
      } else if (!readFile(check.file).includes(check.expected)) {
        failures.push(`${check.label}: ${check.file} does not record ${check.expected}`);
      }
    } catch (error) {
      failures.push(`${check.label}: ${error.message.split('\n')[0]}`);
    }
  }
  return failures;
}

function main() {
  const variant = process.argv[2] ?? process.env.IMAGE_VARIANT ?? 'base';
  const inventory = JSON.parse(readFileSync(`${TOOLS}/inventory.json`, 'utf8'));
  const checks = versionChecks(inventory, variant);
  const failures = runChecks(checks);
  if (failures.length) {
    for (const failure of failures) console.error(`version mismatch: ${failure}`);
    process.exit(1);
  }
  console.log(`Version verification (${variant}): ${checks.length} checks ok`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
