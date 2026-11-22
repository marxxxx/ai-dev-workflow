const SUPPORTED_VERSIONS = ['2025-03-26', '2025-06-18'];
const LATEST_VERSION = '2025-06-18';

const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const failure = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

// One JSON-RPC message in, the response out; null when nothing is to be sent back (a notification or a client response).
// Stateless: no session between calls, so batches (arrays) are not supported.
export async function handleMessage(message, { tools, serverInfo, log = (line) => console.error(line) }) {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return failure(null, -32600, 'invalid request');
  const { id, method, params } = message;
  if (typeof method !== 'string') {
    return id !== undefined && ('result' in message || 'error' in message) ? null : failure(id, -32600, 'invalid request');
  }
  if (id === undefined) return null;

  switch (method) {
    case 'initialize': {
      const wanted = params?.protocolVersion;
      const protocolVersion = SUPPORTED_VERSIONS.includes(wanted) ? wanted : LATEST_VERSION;
      return reply(id, { protocolVersion, capabilities: { tools: {} }, serverInfo });
    }
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      if (params === null || typeof params !== 'object' || typeof params.name !== 'string') return failure(id, -32602, 'invalid params');
      const tool = tools.find((candidate) => candidate.name === params.name);
      if (!tool) return failure(id, -32602, `unknown tool ${params.name}`);
      try {
        return reply(id, await tool.handler(params.arguments));
      } catch (error) {
        // Tool handlers report their own failures as results; reaching this is a bug. Only the error's name and code are
        // logged: its message and the arguments may carry task text.
        log(`adw-mcp: ${tool.name} threw: ${error?.name ?? 'Error'}${error?.code ? ` ${error.code}` : ''}`);
        return failure(id, -32603, 'internal error');
      }
    }
    default:
      return failure(id, -32601, 'method not found');
  }
}
