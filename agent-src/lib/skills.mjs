// Third-party agent skills (show-me) that `init` and `upgrade` install into the project with
// `npx skills add`, pinned by config/skills.json (derived from docker/tools/inventory.json).
//
// The installed files (.agents/skills/<name>/, .claude/skills/<name>, skills-lock.json) are
// project-owned: never rendered, checked or deleted by the pipeline. ai-project.json records the
// opt-in as `skills.<name>`: a missing key means yes, `false` is an opt-out that is respected.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SRC_DIR } from './constants.mjs';
import { readJson } from './config.mjs';

const AGENTS = ['claude-code', 'codex', 'opencode'];
const LOCK_FILE = 'skills-lock.json';

export function loadSkillPins() {
  return readJson(path.join(SRC_DIR, 'config', 'skills.json'), 'config/skills.json', true);
}

/** `npx` arguments that install `name` at its pinned commit for all three harnesses. */
export function installArgs(pins, name) {
  const { repository, path: skillPath, revision } = pins.skills[name];
  return [
    '--yes', `skills@${pins.cli}`, 'add',
    `https://github.com/${repository}/tree/${revision}/${skillPath}`,
    '-y', '-a', ...AGENTS,
  ];
}

export function manualCommand(pins, name) {
  return `npx ${installArgs(pins, name).join(' ')}`;
}

/** npx is a .cmd shim on Windows and needs a shell there. ADW_NPX replaces it in tests. */
function runNpx(args, cwd) {
  const result = spawnSync(process.env.ADW_NPX || 'npx', args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env, DISABLE_TELEMETRY: '1' },
  });
  if (result.error) return { ok: false, message: result.error.message };
  if (result.status !== 0) return { ok: false, message: (result.stderr || result.stdout || `exit ${result.status}`).trim() };
  return { ok: true };
}

const wanted = (project, name) => project?.skills?.[name] !== false;

/** The commit the project's skills-lock.json records for `name`, or null. */
function installedRevision(projectRoot, name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, LOCK_FILE), 'utf8')).skills?.[name]?.ref ?? null;
  } catch {
    return null;
  }
}

/** Install `names` at their pins. Returns { installed, failed: [{ name, message, command }] }. */
export function installSkills(projectRoot, names, { pins = loadSkillPins(), run = runNpx, dryRun = false } = {}) {
  const installed = [];
  const failed = [];
  for (const name of names) {
    const result = dryRun ? { ok: true } : run(installArgs(pins, name), projectRoot);
    if (result.ok) installed.push(name);
    else failed.push({ name, message: result.message, command: manualCommand(pins, name) });
  }
  return { installed, failed };
}

/**
 * Bring the project's pinned skills up to date: record a missing opt-in as `true` in
 * ai-project.json, then install each wanted skill that is missing or at another commit.
 */
export function syncSkills(projectRoot, { pins = loadSkillPins(), run = runNpx, dryRun = false } = {}) {
  const file = path.join(projectRoot, 'ai-project.json');
  const project = readJson(file, 'ai-project.json', true);
  const recorded = Object.keys(pins.skills).filter((name) => project.skills?.[name] === undefined);
  if (recorded.length > 0 && !dryRun) {
    project.skills = { ...project.skills, ...Object.fromEntries(recorded.map((name) => [name, true])) };
    fs.writeFileSync(file, JSON.stringify(project, null, 2) + '\n');
  }
  const skipped = [];
  const current = [];
  const due = [];
  for (const [name, { revision }] of Object.entries(pins.skills)) {
    if (!wanted(project, name)) skipped.push(name);
    else if (installedRevision(projectRoot, name) === revision) current.push(name);
    else due.push(name);
  }
  return { recorded, skipped, current, ...installSkills(projectRoot, due, { pins, run, dryRun }) };
}

/** One line per wanted skill that is missing or not at its pin; for `generate` and `check`. */
export function skillWarnings(projectRoot, project, pins = loadSkillPins()) {
  const warnings = [];
  for (const [name, { revision }] of Object.entries(pins.skills)) {
    if (!wanted(project, name)) continue;
    const installed = installedRevision(projectRoot, name);
    if (installed === revision) continue;
    const state = installed
      ? `${name} is installed at ${installed.slice(0, 7)}, this adw version pins ${revision.slice(0, 7)}`
      : `${name} is not installed`;
    warnings.push(`Note: ${state}. Run adw's \`upgrade\` command (or set "skills": { "${name}": false } in ai-project.json to opt out).`);
  }
  return warnings;
}

/** Print what syncSkills did; a failed install is a warning with the manual command, never an error. */
export function reportSkills({ recorded = [], installed, failed }, { dryRun = false } = {}) {
  for (const name of recorded) {
    console.log(`${dryRun ? 'Would record' : 'Recorded'} "skills": { "${name}": true } in ai-project.json (set it to false to opt out).`);
  }
  for (const name of installed) console.log(`${dryRun ? 'Would install' : 'Installed'} ${name} (pinned) into .agents/skills/ and .claude/skills/.`);
  for (const { name, message, command } of failed) {
    console.warn(`Warning: ${name} could not be installed: ${message}\nInstall it yourself with:\n  ${command}`);
  }
}
