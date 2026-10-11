import { execFileSync, spawnSync } from 'node:child_process';
import { harnessVersion } from './config.mjs';

const defaultExec = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// One-line model probe through the host CLI of each harness; returns an error string or null.
export function defaultProbe(harness, config) {
  const h = config.harnesses[harness];
  const [cmd, args] = harness === 'claude-code' ? ['claude', ['-p', '--model', h.model, 'Antworte nur mit OK']]
    : harness === 'codex' ? ['codex', ['exec', '--skip-git-repo-check', '-m', h.model.split('/').pop(), 'Antworte nur mit OK']]
      : ['opencode', ['run', '-m', h.model, 'Antworte nur mit OK']];
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 180000 });
  if (r.error) return r.error.message;
  const out = `${r.stdout}${r.stderr}`;
  return r.status === 0 && /OK/.test(out) && !/not supported|error/i.test(out.split('OK')[1] ?? '') ? null
    : (out.match(/"message":"([^"]+)"/)?.[1] ?? out.trim().split('\n').at(-1) ?? `exit ${r.status}`);
}

export function runPreflight({ config, harnesses, exec = defaultExec, probe = (h) => defaultProbe(h, config), authPresent,
  platform = process.platform, root = config.root }) {
  if (platform === 'win32') {
    return { ok: false, problems: ['native Windows is not supported: run the E2E self-test inside WSL2 (see docs/adw-e2e/README.md)'], warnings: [] };
  }
  const problems = [];
  const warnings = [];
  const drive = root.match(/^\/mnt\/[a-z](\/|$)/i)?.[0];
  if (drive) warnings.push(`repo lives on a Windows drive (${drive.replace(/\/$/, '')}): clone it inside the WSL filesystem — file modes and CRLF line endings break the task`);
  const tryExec = (cmd, args) => {
    try { return exec(cmd, args).trim(); } catch (e) { problems.push(`${cmd} ${args[0]}: ${e.message.split('\n')[0]}`); return null; }
  };
  const harborOut = tryExec('harbor', ['--version']);
  const harbor = harborOut?.match(/\d+\.\d+\.\d+/)?.[0] ?? harborOut;
  if (harborOut && harbor !== config.harbor.version) problems.push(`harbor ${harbor} installed, ${config.harbor.version} required (uv tool install harbor==${config.harbor.version})`);
  tryExec('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (tryExec('docker', ['image', 'inspect', '--format', '{{.Id}}', config.image])) {
    const out = tryExec('docker', ['run', '--rm', '-e', 'AGENT_TOOLSTACK_ONLY=1', '--entrypoint', 'bash', config.image, '-lc',
      'claude --version; codex --version; opencode --version']) ?? '';
    for (const h of harnesses) {
      const v = harnessVersion(config, h);
      if (!out.includes(v)) problems.push(`${h}: image does not carry pinned ${v} (rebuild with node docker/build.mjs)`);
    }
  }
  for (const h of harnesses) {
    if (!authPresent(h)) { problems.push(`${h}: login missing`); continue; }
    const err = probe(h);
    if (err) problems.push(`${h}: model probe failed: ${err}`);
  }
  return { ok: problems.length === 0, problems, warnings };
}
