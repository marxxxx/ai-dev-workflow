import { spawn } from 'node:child_process';

const definitions = [
  {
    name: 'serena',
    command: '/opt/uv/bin/serena',
    args: ['start-mcp-server', '--context', 'codex', '--project', '/tmp', '--enable-web-dashboard', 'false'],
    expected: ['get_symbols_overview'],
  },
  {
    name: 'playwright',
    command: 'playwright-mcp',
    args: ['--headless', '--browser', 'chromium', '--isolated'],
    expected: ['browser_navigate'],
  },
  {
    name: 'context7',
    command: 'context7-mcp',
    args: [],
    expected: ['resolve-library-id', 'query-docs'],
  },
  {
    name: 'ado',
    command: 'mcp-server-azuredevops',
    args: [process.env.ADO_LIVE_ORGANIZATION || 'fixture-org', '-d', 'core', 'work', 'work-items', '--authentication', 'azcli'],
    expected: [
      'wit_query', 'wit_work_item', 'wit_work_item_write',
      'wit_work_item_comment_write', 'wit_work_item_link_write', 'wit_work_item_attachment',
    ],
  },
];

async function probe(definition) {
  const child = spawn(definition.command, definition.args, {
    env: { ...process.env, HOME: '/tmp/mcp-probe-home', NO_COLOR: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let id = 1;
  const pending = new Map();
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    stdout += chunk;
    for (;;) {
      const newline = stdout.indexOf('\n');
      if (newline < 0) break;
      const line = stdout.slice(0, newline).trim();
      stdout = stdout.slice(newline + 1);
      if (!line.startsWith('{')) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
        else waiter.resolve(message.result);
      }
    }
  });
  const send = (method, params = {}) => {
    const requestId = id++;
    const result = new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params })}\n`);
    return result;
  };
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(
      `${definition.name} MCP startup timed out. stderr: ${stderr.slice(-2000)}`,
    )), 45_000);
  });
  try {
    await Promise.race([send('initialize', {
      protocolVersion: '2025-06-18', capabilities: {},
      clientInfo: { name: 'agent-runtime-verifier', version: '1.0.0' },
    }), timeout]);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
    const listed = await Promise.race([send('tools/list'), timeout]);
    const names = new Set(listed.tools.map(tool => tool.name));
    const missing = definition.expected.filter(name => !names.has(name));
    if (missing.length) throw new Error(`${definition.name} omitted required tools: ${missing.join(', ')}`);
    console.log(`${definition.name} MCP startup: ok (${listed.tools.length} tools)`);
    if (definition.name === 'playwright') {
      const result = await Promise.race([send('tools/call', {
        name: 'browser_navigate', arguments: { url: 'about:blank' },
      }), timeout]);
      if (result?.isError) {
        const diagnostic = result.content?.find(item => item.type === 'text')?.text ?? 'unknown Playwright MCP error';
        throw new Error(diagnostic);
      }
      console.log('playwright browser navigation: ok');
    }
    if (definition.name === 'ado' && process.env.ADO_LIVE_PROJECT) {
      const result = await Promise.race([send('tools/call', {
        name: 'wit_query',
        arguments: {
          action: 'wiql',
          project: process.env.ADO_LIVE_PROJECT,
          top: 1,
          wiql: 'SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project',
        },
      }), timeout]);
      if (result?.isError) {
        const diagnostic = result.content?.find(item => item.type === 'text')?.text ?? 'unknown ADO MCP error';
        throw new Error(diagnostic);
      }
      console.log('ado authenticated read: ok');
    }
  } finally {
    clearTimeout(timeoutId);
    child.stdin.end();
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 1_000).unref();
  }
}

for (const definition of definitions) await probe(definition);
