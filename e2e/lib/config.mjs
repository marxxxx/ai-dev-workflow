import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadConfig(file = path.join(ROOT, 'e2e', 'config.json')) {
  return { ...JSON.parse(readFileSync(file, 'utf8')), root: ROOT };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  }
  return value;
}

export function configHash(config) {
  const { root, ...rest } = config;
  return createHash('sha256').update(JSON.stringify(canonical(rest))).digest('hex');
}

export function harnessVersion(config, harnessId, inventory = path.join(ROOT, 'docker', 'tools', 'inventory.json')) {
  const harness = config.harnesses?.[harnessId];
  if (!harness) throw new Error(`unknown harness: ${harnessId}`);
  const version = JSON.parse(readFileSync(inventory, 'utf8')).npmPackages?.[harness.inventoryPackage];
  if (!version) throw new Error(`no inventory pin for ${harness.inventoryPackage}`);
  return version;
}
