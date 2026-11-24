import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from './config.mjs';

const TOKEN = 'a'.repeat(32);

test('requires a token', () => {
  assert.throws(() => loadConfig({}), { message: 'ADW_MCP_TOKEN is not set' });
  assert.throws(() => loadConfig({ ADW_MCP_TOKEN: '' }), { message: 'ADW_MCP_TOKEN is not set' });
});

test('token length boundary is 32 characters', () => {
  assert.throws(() => loadConfig({ ADW_MCP_TOKEN: 'a'.repeat(31) }), {
    message: 'ADW_MCP_TOKEN must be at least 32 characters',
  });
  assert.equal(loadConfig({ ADW_MCP_TOKEN: TOKEN }).token, TOKEN);
});

test('error messages never contain the token', () => {
  const short = 'secret-short-token';
  try {
    loadConfig({ ADW_MCP_TOKEN: short });
    assert.fail('should throw');
  } catch (err) {
    assert.ok(!err.message.includes(short));
  }
  try {
    loadConfig({ ADW_MCP_TOKEN: TOKEN, ADW_MCP_PORT: '0' });
    assert.fail('should throw');
  } catch (err) {
    assert.ok(!err.message.includes(TOKEN));
  }
});

test('defaults', () => {
  assert.deepEqual(loadConfig({ ADW_MCP_TOKEN: TOKEN }), {
    token: TOKEN, host: '0.0.0.0', port: 8787, tls: null, home: '/home/dev', workspace: '/workspace', turnTimeoutSec: 14400,
  });
});

test('overrides', () => {
  const cfg = loadConfig({
    ADW_MCP_TOKEN: TOKEN, ADW_MCP_HOST: '127.0.0.1', ADW_MCP_PORT: '9000',
    HOME: '/root', ADW_MCP_WORKSPACE: '/w',
  });
  assert.equal(cfg.host, '127.0.0.1');
  assert.equal(cfg.port, 9000);
  assert.equal(cfg.home, '/root');
  assert.equal(cfg.workspace, '/w');
});

test('port must be an integer from 1 to 65535', () => {
  for (const port of ['0', '65536', 'abc', '80.5', '', '-1']) {
    assert.throws(() => loadConfig({ ADW_MCP_TOKEN: TOKEN, ADW_MCP_PORT: port }), {
      message: 'ADW_MCP_PORT must be an integer from 1 to 65535',
    }, port);
  }
  assert.equal(loadConfig({ ADW_MCP_TOKEN: TOKEN, ADW_MCP_PORT: '65535' }).port, 65535);
});

test('turn timeout must be an integer from 60 to 86400; empty is the default', () => {
  for (const value of ['59', '86401', 'abc', '600.5', '-60', ' 600', '1e3']) {
    assert.throws(() => loadConfig({ ADW_MCP_TOKEN: TOKEN, ADW_MCP_TURN_TIMEOUT_SEC: value }), {
      message: 'ADW_MCP_TURN_TIMEOUT_SEC must be an integer from 60 to 86400',
    }, value);
  }
  for (const [value, expected] of [['60', 60], ['86400', 86400], ['7200', 7200], ['', 14400], [undefined, 14400]]) {
    assert.equal(loadConfig({ ADW_MCP_TOKEN: TOKEN, ADW_MCP_TURN_TIMEOUT_SEC: value }).turnTimeoutSec, expected, String(value));
  }
});

test('TLS cert and key must be set together', () => {
  const message = 'ADW_MCP_TLS_CERT and ADW_MCP_TLS_KEY must be set together';
  assert.throws(() => loadConfig({ ADW_MCP_TOKEN: TOKEN, ADW_MCP_TLS_CERT: '/c' }), { message });
  assert.throws(() => loadConfig({ ADW_MCP_TOKEN: TOKEN, ADW_MCP_TLS_KEY: '/k' }), { message });
  assert.deepEqual(
    loadConfig({ ADW_MCP_TOKEN: TOKEN, ADW_MCP_TLS_CERT: '/c', ADW_MCP_TLS_KEY: '/k' }).tls,
    { cert: '/c', key: '/k' },
  );
});
