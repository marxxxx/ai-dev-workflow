const MIN_TOKEN_LENGTH = 32;
export const DEFAULT_TURN_TIMEOUT_SEC = 4 * 60 * 60;

// How long one turn may run (acpx --timeout). The server and its workers both read it from the environment: it is part
// of the acpx argv prefix, which must be the same for every call of a session. Empty is the default.
export function turnTimeoutSec(env = process.env) {
  const value = env.ADW_MCP_TURN_TIMEOUT_SEC;
  if (value === undefined || value === '') return DEFAULT_TURN_TIMEOUT_SEC;
  const sec = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(sec) || sec < 60 || sec > 86400) throw new Error('ADW_MCP_TURN_TIMEOUT_SEC must be an integer from 60 to 86400');
  return sec;
}

export function loadConfig(env = process.env) {
  const token = env.ADW_MCP_TOKEN;
  if (!token) throw new Error('ADW_MCP_TOKEN is not set');
  if (token.length < MIN_TOKEN_LENGTH) throw new Error(`ADW_MCP_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);

  let port = 8787;
  if (env.ADW_MCP_PORT !== undefined) {
    port = /^\d+$/.test(env.ADW_MCP_PORT) ? Number(env.ADW_MCP_PORT) : NaN;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('ADW_MCP_PORT must be an integer from 1 to 65535');
    }
  }

  const cert = env.ADW_MCP_TLS_CERT || undefined;
  const key = env.ADW_MCP_TLS_KEY || undefined;
  if (Boolean(cert) !== Boolean(key)) {
    throw new Error('ADW_MCP_TLS_CERT and ADW_MCP_TLS_KEY must be set together');
  }
  const timeout = turnTimeoutSec(env);

  return {
    token,
    host: env.ADW_MCP_HOST ?? '0.0.0.0',
    port,
    tls: cert ? { cert, key } : null,
    home: env.HOME ?? '/home/dev',
    workspace: env.ADW_MCP_WORKSPACE ?? '/workspace',
    turnTimeoutSec: timeout,
  };
}
