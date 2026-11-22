const MIN_TOKEN_LENGTH = 32;

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

  return {
    token,
    host: env.ADW_MCP_HOST ?? '0.0.0.0',
    port,
    tls: cert ? { cert, key } : null,
    home: env.HOME ?? '/home/dev',
    workspace: env.ADW_MCP_WORKSPACE ?? '/workspace',
  };
}
