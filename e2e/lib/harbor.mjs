import { execFileSync, spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';
import { harnessVersion } from './config.mjs';

export function buildHarborArgs({ config, harness, jobName, jobsDir }) {
  const h = config.harnesses[harness];
  const u = config.simulatedUser;
  const task = path.join(config.root, 'e2e', config.task);
  return ['run', '-p', task, '-a', h.agent, '-m', h.model,
    '--ak', `version=${harnessVersion(config, harness)}`,
    ...Object.entries(h.agentKwargs).flatMap(([k, v]) => ['--ak', `${k}=${v}`]),
    '--user-agent', u.agent, '--user-model', u.model,
    '--uk', `disallowed_tools=${u.disallowedTools}`, '--uk', `append_system_prompt=${u.appendSystemPrompt}`,
    '--user-persona-path', path.join(task, 'persona.md'),
    '--bridge', 'acp', '--bridge-prompt-path', path.join(task, 'bridge-prompt.md'),
    '-o', jobsDir, '--job-name', jobName];
}

export function runHarbor({ args, env, cwd, spawn = nodeSpawn, logStream }) {
  return new Promise((resolve) => {
    const child = spawn('harbor', args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.pipe(logStream ?? process.stdout, { end: false });
    child.stderr?.pipe(logStream ?? process.stderr, { end: false });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

export function cleanupCompose({ exec = (c, a) => execFileSync(c, a, { encoding: 'utf8' }) } = {}) {
  const projects = new Set(exec('docker', ['ps', '-a', '--format', '{{.Label "com.docker.compose.project"}}'])
    .split('\n').filter((p) => p.startsWith('demo-todo__')));
  for (const p of projects) {
    try { exec('docker', ['compose', '-p', p, 'down', '-v', '--remove-orphans']); } catch { /* already gone */ }
  }
  return [...projects];
}
