import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { pathToFileURL } from 'node:url';
import { acpxSettings } from './acpx.mjs';
import { isAuthorized } from './auth.mjs';
import { loadConfig } from './config.mjs';
import { handleMessage } from './mcp.mjs';
import { cancelTurn, isAlive, startTurn } from './runner.mjs';
import { createSessions } from './sessions.mjs';
import { createStore } from './store.mjs';
import { buildTools } from './tools.mjs';

export const SERVER_INFO = { name: 'adw-mcp', version: '1.0.0' };
const MCP_PATH = '/mcp';
const MAX_BODY_BYTES = 1024 * 1024;

class BodyTooLarge extends Error {}

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers });
  res.end(payload);
}

const rpcError = (code, message) => ({ jsonrpc: '2.0', id: null, error: { code, message } });

// Reads at most `limit` bytes, counted as they arrive: an oversized body is abandoned, never buffered whole.
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > limit) {
      reject(new BodyTooLarge());
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        chunks.length = 0;
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!settled) resolve(Buffer.concat(chunks)); });
    req.on('error', (error) => { if (!settled) reject(error); });
  });
}

function requestHandler({ config, tools, serverInfo, log }) {
  async function handle(req, res) {
    const path = (req.url ?? '').split('?')[0];
    if (path !== MCP_PATH) return send(res, 404, { error: 'not found' });
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }, { allow: 'POST' });
    // Before anything is read from the body.
    if (!isAuthorized(req.headers, config.token)) {
      return send(res, 401, { error: 'unauthorized' }, { 'www-authenticate': 'Bearer' });
    }

    let raw;
    try {
      raw = await readBody(req, MAX_BODY_BYTES);
    } catch (error) {
      if (!(error instanceof BodyTooLarge)) throw error;
      res.on('finish', () => req.destroy());
      return send(res, 413, { error: 'payload too large' }, { connection: 'close' });
    }

    let message;
    try {
      message = JSON.parse(raw.toString('utf8'));
    } catch {
      return send(res, 400, rpcError(-32700, 'parse error'));
    }
    const response = await handleMessage(message, { tools, serverInfo });
    if (response === null) return send(res, 202);
    return send(res, response.error?.code === -32600 ? 400 : 200, response);
  }

  // Never logs the request, its headers or the error's stack: only that something failed.
  return (req, res) => {
    handle(req, res).catch((error) => {
      log(`adw-mcp: request failed: ${error?.name ?? 'Error'}${error?.code ? ` ${error.code}` : ''}`);
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
      else res.destroy();
    });
  };
}

// `factories` is injectable so that the choice of transport can be tested without a certificate.
export function createServer({ config, tools, serverInfo = SERVER_INFO, log = (line) => console.error(line), factories = { http: http.createServer, https: https.createServer } }) {
  const handler = requestHandler({ config, tools, serverInfo, log });
  if (!config.tls) return factories.http(handler);
  return factories.https({ cert: readFileSync(config.tls.cert), key: readFileSync(config.tls.key) }, handler);
}

// The runner and the worker read HOME and ADW_MCP_WORKSPACE from the environment, and a worker inherits ours: both must
// say what the config says, or the server and its workers would look at different stores and workspaces.
export function alignEnv(config, env = process.env) {
  if (env.HOME !== config.home) env.HOME = config.home;
  if (env.ADW_MCP_WORKSPACE !== config.workspace) env.ADW_MCP_WORKSPACE = config.workspace;
}

export function createRuntime(config, env = process.env) {
  alignEnv(config, env);
  const store = createStore(acpxSettings(env).storeDir);
  const sessions = createSessions({
    store,
    startTurn,
    cancel: cancelTurn,
    isAlive,
    now: () => new Date().toISOString(),
    newId: randomUUID,
  });
  sessions.reconcile();
  return { store, sessions, tools: buildTools(sessions) };
}

export function main(env = process.env) {
  let config;
  try {
    config = loadConfig(env);
  } catch (error) {
    console.error(`adw-mcp: ${error.message}`);
    process.exit(1);
  }
  const { tools } = createRuntime(config);
  const server = createServer({ config, tools });
  server.on('error', (error) => {
    console.error(`adw-mcp: cannot listen on ${config.host}:${config.port}: ${error.code ?? error.message}`);
    process.exit(1);
  });
  server.listen(config.port, config.host, () => {
    console.log(`adw-mcp: listening on ${config.host}:${config.port} (${config.tls ? 'https' : 'http'})`);
  });
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
