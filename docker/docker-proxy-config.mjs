// Mirrors the container's proxy variables into the Docker CLI config, which injects them into
// image builds and containers (the dind overlay's nested workloads). Only proxies.default is
// managed: set from the environment on every start, removed when no proxy is set.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

const FIELDS = { httpProxy: 'HTTP_PROXY', httpsProxy: 'HTTPS_PROXY', noProxy: 'NO_PROXY' };

export function withProxies(config, env) {
  const next = structuredClone(config);
  const proxy = {};
  for (const [field, name] of Object.entries(FIELDS)) {
    const value = env[name] || env[name.toLowerCase()];
    if (value) proxy[field] = value;
  }
  if (Object.keys(proxy).length) {
    next.proxies = { ...next.proxies, default: proxy };
  } else if (next.proxies) {
    delete next.proxies.default;
    if (!Object.keys(next.proxies).length) delete next.proxies;
  }
  return next;
}

// Returns whether the file was written.
export function applyDockerProxyConfig(home, env) {
  const file = path.join(home, '.docker', 'config.json');
  let current = {};
  if (existsSync(file)) {
    try {
      current = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      throw new Error(`${file} is not valid JSON: ${error.message}`);
    }
  }
  const next = withProxies(current, env);
  if (isDeepStrictEqual(next, current)) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    applyDockerProxyConfig(process.env.HOME, process.env);
  } catch (error) {
    console.error(`agent runtime: ${error.message}`);
    process.exit(1);
  }
}
