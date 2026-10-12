import { execFileSync, spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';
import { harnessVersion } from './config.mjs';
import { taskDir } from './tasks.mjs';

export function buildHarborArgs({ config, task, harness, jobName, jobsDir }) {
  const h = config.harnesses[harness];
  const u = config.simulatedUser;
  const dir = taskDir(config, task);
  return ['run', '-p', dir, '-a', h.agent, '-m', h.model,
    '--ak', `version=${harnessVersion(config, harness)}`,
    ...Object.entries(h.agentKwargs).flatMap(([k, v]) => ['--ak', `${k}=${v}`]),
    '--user-agent', u.agent, '--user-model', u.model,
    '--uk', `disallowed_tools=${u.disallowedTools}`, '--uk', `append_system_prompt=${u.appendSystemPrompt}`,
    '--user-persona-path', path.join(dir, 'persona.md'),
    '--bridge', 'acp', '--bridge-prompt-path', path.join(dir, 'bridge-prompt.md'),
    '-o', jobsDir, '--job-name', jobName];
}

export function runHarbor({ args, env, cwd, spawn = nodeSpawn, logStream, timeoutMs, killGraceMs = 10_000 }) {
  return new Promise((resolve) => {
    const child = spawn('harbor', args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.pipe(logStream ?? process.stdout, { end: false });
    child.stderr?.pipe(logStream ?? process.stderr, { end: false });
    let killTimer;
    const timer = timeoutMs ? setTimeout(() => {
      // Stop feeding the log first: the caller ends it as soon as we resolve.
      child.stdout?.unpipe?.(logStream ?? process.stdout);
      child.stderr?.unpipe?.(logStream ?? process.stderr);
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
      resolve(124);
    }, timeoutMs) : null;
    child.on('error', () => { clearTimeout(timer); clearTimeout(killTimer); resolve(1); });
    child.on('close', (code) => { clearTimeout(timer); clearTimeout(killTimer); resolve(code ?? 1); });
  });
}

// Harbor names a trial's compose project `<task>__<trial>`: the double underscore keeps `demo-todo`
// from matching `demo-todo-dotnet`.
export function cleanupCompose({ prefixes, exec = (c, a) => execFileSync(c, a, { encoding: 'utf8' }) }) {
  const projects = new Set(exec('docker', ['ps', '-a', '--format', '{{.Label "com.docker.compose.project"}}'])
    .split('\n').filter((p) => prefixes.some((t) => p.startsWith(`${t}__`))));
  for (const p of projects) {
    try { exec('docker', ['compose', '-p', p, 'down', '-v', '--remove-orphans']); } catch { /* already gone */ }
  }
  return [...projects];
}
