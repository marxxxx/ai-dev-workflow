import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyDockerProxyConfig, withProxies } from '../docker-proxy-config.mjs';

test('sets the default proxies from the environment, uppercase first', () => {
  const config = withProxies({}, { HTTPS_PROXY: 'http://proxy:3128', http_proxy: 'http://lower:3128', NO_PROXY: 'localhost,127.0.0.1' });
  assert.deepEqual(config, {
    proxies: { default: { httpProxy: 'http://lower:3128', httpsProxy: 'http://proxy:3128', noProxy: 'localhost,127.0.0.1' } },
  });
});

test('keeps everything else and removes only the default proxies when none is set', () => {
  const current = { auths: { 'ghcr.io': { auth: 'x' } }, proxies: { default: { httpProxy: 'http://old' }, 'other:2375': { httpProxy: 'http://keep' } } };
  assert.deepEqual(withProxies(current, { HTTP_PROXY: '' }), {
    auths: { 'ghcr.io': { auth: 'x' } }, proxies: { 'other:2375': { httpProxy: 'http://keep' } },
  });
  assert.deepEqual(withProxies({ auths: {}, proxies: { default: { httpProxy: 'http://old' } } }, {}), { auths: {} });
  assert.equal(current.proxies.default.httpProxy, 'http://old', 'input is not mutated');
});

test('writes the config file only when it changes', t => {
  const home = mkdtempSync(path.join(tmpdir(), 'agent-docker-config-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const file = path.join(home, '.docker', 'config.json');
  assert.equal(applyDockerProxyConfig(home, {}), false);
  assert.equal(existsSync(file), false, 'no proxy and no file: nothing is created');
  assert.equal(applyDockerProxyConfig(home, { HTTPS_PROXY: 'http://proxy:3128' }), true);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { proxies: { default: { httpsProxy: 'http://proxy:3128' } } });
  assert.equal(applyDockerProxyConfig(home, { HTTPS_PROXY: 'http://proxy:3128' }), false);
  assert.equal(applyDockerProxyConfig(home, {}), true);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {});
});

test('fails on a config file that is not JSON instead of overwriting it', t => {
  const home = mkdtempSync(path.join(tmpdir(), 'agent-docker-config-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(path.join(home, '.docker'));
  writeFileSync(path.join(home, '.docker', 'config.json'), '{ broken');
  assert.throws(() => applyDockerProxyConfig(home, { HTTPS_PROXY: 'http://proxy:3128' }), /config\.json/);
  assert.equal(readFileSync(path.join(home, '.docker', 'config.json'), 'utf8'), '{ broken');
});
