import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildLaunchPlan, configureRuntime } from './launch-agent.mjs';

const scriptPath = fileURLToPath(new URL('./launch-agent.mjs', import.meta.url));

// Bare workspace with NO ai-project.json / .mcp.json / .codex — proves tool-stack-only reads none of them.
function bareWorkspace(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-toolstack-'));
  const workspace = path.join(root, 'workspace');
  const home = path.join(root, 'home');
  mkdirSync(workspace, { recursive: true });
  mkdirSync(home);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, workspace, home };
}

function fixture(t, backend = 'azure-devops') {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-launcher-'));
  const workspace = path.join(root, 'workspace');
  const home = path.join(root, 'home');
  mkdirSync(path.join(workspace, '.codex'), { recursive: true });
  mkdirSync(home);
  writeFileSync(path.join(workspace, 'ai-project.json'), JSON.stringify({
    ticketing: backend === 'azure-devops'
      ? { backend, azureDevOps: { organization: 'fixture-org' } }
      : { backend },
  }));
  writeFileSync(path.join(workspace, '.mcp.json'), JSON.stringify({ mcpServers: {
    ado: { type: 'stdio', command: 'npx', args: ['-y', '@azure-devops/mcp@2', 'fixture-org'] },
    dxdocs: { type: 'http', url: 'https://docs.example/mcp' },
  }, inputs: [{ id: 'keep-me' }] }));
  writeFileSync(path.join(workspace, '.codex/config.toml'),
    '[mcp_servers.ado]\ncommand = "npx"\nargs = ["-y", "@azure-devops/mcp@2"]\n' +
    '[mcp_servers.dxdocs]\nurl = "https://docs.example/mcp"\n');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, workspace, home };
}

test('configures only runtime home, preserves settings, and is idempotent', t => {
  const { root, workspace, home } = fixture(t, 'github');
  const serenaConfigFile = path.join(root, 'serena_config.yml');
  writeFileSync(serenaConfigFile, 'projects: []\n');
  writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ theme: 'dark' }));
  mkdirSync(path.join(home, '.config/opencode'), { recursive: true });
  writeFileSync(path.join(home, '.config/opencode/opencode.json'), '{ // retained\n "model": "local"\n}\n');
  mkdirSync(path.join(home, '.codex'));
  writeFileSync(path.join(home, '.codex/config.toml'), 'model = "gpt-test"\n[notice]\nhide = true\n');
  const projectBefore = readFileSync(path.join(workspace, '.codex/config.toml'));

  configureRuntime({ workspace, home, superpowersRoot: '/opt/superpowers', serenaConfigFile, registerCodexPlugin: false });
  const once = readFileSync(path.join(home, '.codex/config.toml'), 'utf8');
  configureRuntime({ workspace, home, superpowersRoot: '/opt/superpowers', serenaConfigFile, registerCodexPlugin: false });

  assert.equal(readFileSync(path.join(home, '.codex/config.toml'), 'utf8'), once);
  assert.match(once, /model = "gpt-test"/);
  assert.match(once, /hide = true/);
  assert.match(once, /cli_auth_credentials_store = "file"/);
  assert.match(once, /trust_level = "trusted"/);
  assert.match(once, /superpowers@agent-runtime/);
  assert.equal(JSON.parse(readFileSync(path.join(home, '.claude.json'))).theme, 'dark');
  assert.match(readFileSync(path.join(home, '.config/opencode/opencode.json'), 'utf8'), /retained/);
  assert.equal(readFileSync(path.join(home, '.cache/ai-dev-workflow/serena/serena_config.yml'), 'utf8'), 'projects: []\n');
  assert.deepEqual(readFileSync(path.join(workspace, '.codex/config.toml')), projectBefore);
});

test('invalid existing runtime configuration fails instead of being replaced', t => {
  const { workspace, home } = fixture(t, 'github');
  mkdirSync(path.join(home, '.codex'));
  writeFileSync(path.join(home, '.codex/config.toml'), 'broken = [');
  assert.throws(() => configureRuntime({ workspace, home }), /config\.toml/);
  assert.equal(readFileSync(path.join(home, '.codex/config.toml'), 'utf8'), 'broken = [');
});

test('Codex receives installed MCP overrides before the forwarded argument vector', t => {
  const { workspace, home } = fixture(t);
  const plan = buildLaunchPlan('codex', ['--yolo', 'keep spaces'], {
    workspace, home, checkAzureAuth: () => true,
  });
  assert.equal(plan.command, '/opt/agent-tools/node_modules/.bin/codex');
  assert.deepEqual(plan.args.slice(-2), ['--yolo', 'keep spaces']);
  assert.ok(plan.args.includes('mcp_servers.ado.command="mcp-server-azuredevops"'));
  assert.ok(plan.args.includes('mcp_servers.ado.args=["fixture-org","-d","core","work","work-items","--authentication","azcli"]'));
  assert.ok(plan.args.includes('mcp_servers.playwright.args=["--headless","--browser","chromium","--isolated"]'));
  assert.ok(plan.args.includes('mcp_servers.playwright.env.PLAYWRIGHT_BROWSERS_PATH="/opt/ms-playwright"'));
  assert.ok(plan.args.includes(`mcp_servers.serena.env.SERENA_HOME=${JSON.stringify(path.posix.join(home, '.cache', 'ai-dev-workflow', 'serena'))}`));
  assert.ok(!plan.args.join(' ').includes('@azure-devops/mcp@2'));
});

test('Claude gets one effective strict config with custom and managed servers', t => {
  const { workspace, home } = fixture(t);
  const plan = buildLaunchPlan('claude', ['--dangerously-skip-permissions', 'read only'], {
    workspace, home, checkAzureAuth: () => true,
  });
  const configPath = plan.args[plan.args.indexOf('--mcp-config') + 1];
  const effective = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(effective.mcpServers.dxdocs.url, 'https://docs.example/mcp');
  assert.equal(effective.mcpServers.ado.command, 'mcp-server-azuredevops');
  assert.deepEqual(effective.mcpServers.playwright.args, ['--headless', '--browser', 'chromium', '--isolated']);
  assert.equal(effective.mcpServers.serena.env.SERENA_HOME, path.posix.join(home, '.cache', 'ai-dev-workflow', 'serena'));
  assert.ok(plan.args.includes('--strict-mcp-config'));
  assert.deepEqual(plan.args.slice(-2), ['--dangerously-skip-permissions', 'read only']);
});

test('OpenCode inline config retains custom servers and uses the local plugin', t => {
  const { workspace, home } = fixture(t);
  const plan = buildLaunchPlan('opencode', ['run', 'read only'], {
    workspace, home, checkAzureAuth: () => true,
  });
  const config = JSON.parse(plan.env.OPENCODE_CONFIG_CONTENT);
  assert.equal(config.mcp.dxdocs.url, 'https://docs.example/mcp');
  assert.deepEqual(config.mcp.ado.command.slice(0, 3), ['mcp-server-azuredevops', 'fixture-org', '-d']);
  assert.equal(config.mcp.serena.environment.SERENA_HOME, path.posix.join(home, '.cache', 'ai-dev-workflow', 'serena'));
  assert.ok(config.plugin.includes('/opt/superpowers'));
  assert.deepEqual(plan.args, ['run', 'read only']);
});

test('ADO launch fails with a device-login diagnostic while agent login remains usable', t => {
  const { workspace, home } = fixture(t);
  assert.throws(() => buildLaunchPlan('codex', ['--yolo'], {
    workspace, home, checkAzureAuth: () => false,
  }), /az login --use-device-code --allow-no-subscriptions/);
  const login = buildLaunchPlan('codex', ['login', '--device-auth'], {
    workspace, home, checkAzureAuth: () => false,
  });
  assert.deepEqual(login.args, ['login', '--device-auth']);
});

test('missing ADO organization and unsupported agents fail clearly', t => {
  const { workspace, home } = fixture(t);
  writeFileSync(path.join(workspace, 'ai-project.json'), JSON.stringify({ ticketing: { backend: 'azure-devops' } }));
  assert.throws(() => buildLaunchPlan('codex', [], { workspace, home }), /organization/);
  assert.throws(() => buildLaunchPlan('unknown', [], { workspace, home }), /Unsupported agent/);
});

test('tool-stack-only configureRuntime needs no ai-project.json', t => {
  const { root, workspace, home } = bareWorkspace(t);
  const serenaConfigFile = path.join(root, 'serena_config.yml');
  writeFileSync(serenaConfigFile, 'projects: []\n');

  assert.doesNotThrow(() => configureRuntime({
    workspace, home, superpowersRoot: '/opt/superpowers', serenaConfigFile,
    registerCodexPlugin: false, toolstackOnly: true,
  }));
  const codex = readFileSync(path.join(home, '.codex/config.toml'), 'utf8');
  assert.match(codex, /trust_level = "trusted"/);
  assert.match(codex, /superpowers@agent-runtime/);
  assert.equal(readFileSync(path.join(home, '.cache/ai-dev-workflow/serena/serena_config.yml'), 'utf8'), 'projects: []\n');
});

test('tool-stack-only Codex plan emits only managed servers and never checks Azure', t => {
  const { workspace, home } = bareWorkspace(t);
  let azureChecked = false;
  const plan = buildLaunchPlan('codex', ['--yolo'], {
    workspace, home, toolstackOnly: true,
    checkAzureAuth: () => { azureChecked = true; return false; },
  });
  assert.equal(azureChecked, false);
  const flat = plan.args.join(' ');
  assert.ok(flat.includes('mcp_servers.serena.command'));
  assert.ok(flat.includes('mcp_servers.playwright.args'));
  assert.ok(flat.includes('mcp_servers.context7.command'));
  assert.ok(!flat.includes('mcp_servers.ado'));
  assert.deepEqual(plan.args.slice(-1), ['--yolo']);
});

test('tool-stack-only Claude config has exactly the three managed servers', t => {
  const { workspace, home } = bareWorkspace(t);
  const plan = buildLaunchPlan('claude', ['--dangerously-skip-permissions'], {
    workspace, home, toolstackOnly: true,
  });
  const configPath = plan.args[plan.args.indexOf('--mcp-config') + 1];
  const effective = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.deepEqual(Object.keys(effective.mcpServers).sort(), ['context7', 'playwright', 'serena']);
});

test('CLI honors AGENT_TOOLSTACK_ONLY with no ai-project.json on disk', () => {
  const result = spawnSync(process.execPath, [scriptPath, 'codex', '--yolo'], {
    env: { ...process.env, AGENT_TOOLSTACK_ONLY: '1', AGENT_RUNTIME_PRINT_PLAN: '1' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  const flat = plan.args.join(' ');
  assert.ok(flat.includes('mcp_servers.serena.command'));
  assert.ok(!flat.includes('mcp_servers.ado'));
});
