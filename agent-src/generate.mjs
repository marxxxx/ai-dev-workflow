#!/usr/bin/env node
// Generator for single-source agent & skill definitions.
//
// Reads the canonical units under agent-src/{agents,skills}/<name>/ (body.md +
// manifest.json, optional overlays/<platform>.md) and renders each platform's files.
//
// Invoke directly during in-repo dev, or via the `ai-dev-workflow` bin once installed:
//   ai-dev-workflow generate                    write all platform files (default command)
//   ai-dev-workflow check                        render in-memory, diff against disk, exit 1 on drift
//   ai-dev-workflow init                          interactive onboarding → ai-project.json
//   ai-dev-workflow init --answers <file.json>    non-interactive onboarding from a JSON answers file
//   ai-dev-workflow upgrade [--dry-run]           delete ≤0.22 generated files + obsolete config keys, generate,
//                                                 then install/update the pinned third-party skills (show-me)
//                                                 and name fixes the project-owned compose.ai-dev.yml needs
//   ai-dev-workflow e2e <base-commit|.> <ticket> [harness] [--repetitions n] [--model m] [--ticket-file f] [--baseline runDir]
//                                                 [--no-input] [--answers file] [--reconfigure]
//                                                 replayable E2E run of agent-dev on a ticket (e2e/local/cli.mjs)
//   ai-dev-workflow <cmd> --root <dir>            target a project root other than cwd
//
// `--check` is still accepted as a legacy alias for the `check` command.
//
// Config is split across two files:
//   - config/ai-workflow.json  (package-owned, under agent-src/config/): workflow states/artifacts
//                        + ticketing.includePath. Travels and updates with the package.
//   - ai-project.json          (project-owned, at the project root): project/repository/git identity
//                        and the ticketing backend choice (file | github | gitea | azure-devops).
//
// This file is a thin orchestrator: it parses argv, dispatches to the pieces below, and
// re-exports the public API for back-compat with in-process tests and external importers.
// The implementation lives in the feature modules under agent-src/lib/:
//   constants · serialize · identity · config · tokens · units · ticketing · renderers ·
//   onboard · pipeline · upgrade · skills
//
// Zero dependencies: node builtins only. Writes LF line endings on every platform.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { argValue } from './lib/constants.mjs';
import { cmdInit } from './lib/onboard.mjs';
import { renderAll, writeAll, checkAll } from './lib/pipeline.mjs';
import { removeObsoleteOutputs, cleanProjectConfig, findCustomLeftovers } from './lib/upgrade.mjs';
import { syncSkills, skillWarnings, reportSkills } from './lib/skills.mjs';
import { readJson } from './lib/config.mjs';
import { containerWarnings } from './lib/container.mjs';

// ---------------------------------------------------------------------------
// Aggregated public API — re-exported so importers keep using `generate.mjs`.
// ---------------------------------------------------------------------------
export { buildGlobalTokens, loadConfig, azureMapping, buildProjectConfig } from './lib/config.mjs';
export { kebabCase, parseOriginSlug } from './lib/identity.mjs';
export { cmdScaffold, cmdInit, createScriptedPrompter, runInterview } from './lib/onboard.mjs';
export { renderAll } from './lib/pipeline.mjs';

/** Resolve the project root: `--root <dir>` if given, else the current working directory. */
function resolveProjectRoot(argv) {
  return argValue(argv, '--root') ? path.resolve(argValue(argv, '--root')) : process.cwd();
}

// Flags that take a value: the value is never the command.
const VALUE_FLAGS = ['--root', '--answers', '--repetitions', '--model', '--ticket-file', '--baseline'];

/** The first non-flag argument is the command; value flags and their values are skipped. */
function parseCommand(argv) {
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (VALUE_FLAGS.includes(a)) { i++; continue; } // skip the value that follows the flag
    if (a.startsWith('-')) continue;
    return a;
  }
  return args.includes('--check') ? 'check' : 'generate';
}

function main() {
  const command = parseCommand(process.argv);

  if (command === 'e2e') {
    // Everything after the command word goes to the e2e CLI, which resolves --root itself.
    const args = process.argv.slice(2);
    args.splice(args.indexOf('e2e'), 1);
    import('../e2e/local/cli.mjs')
      .then((cli) => cli.main(args))
      .then((code) => process.exit(code))
      .catch((err) => { console.error(`e2e failed: ${err.message}`); process.exit(1); });
    return;
  }

  const projectRoot = resolveProjectRoot(process.argv);

  if (command === 'init') {
    cmdInit(projectRoot)
      .then((code) => process.exit(code))
      .catch((err) => { console.error(`init failed: ${err.message}`); process.exit(1); });
    return;
  }

  if (command !== 'generate' && command !== 'check' && command !== 'upgrade') {
    console.error(`Unknown command "${command}". Use: generate | check | init | upgrade | e2e`);
    process.exit(1);
  }

  let outputs;
  try {
    outputs = renderAll(projectRoot);
  } catch (err) {
    console.error(`Generation failed: ${err.message}`);
    process.exit(1);
  }
  if (command === 'upgrade') process.exit(upgrade(outputs, projectRoot, process.argv.includes('--dry-run')));
  const status = command === 'check' ? checkAll(outputs, projectRoot) : (writeAll(outputs, projectRoot), 0);
  // Missing skills and container fixes are not drift: point at them, keep the exit status.
  const project = readJson(path.join(projectRoot, 'ai-project.json'), 'ai-project.json', false);
  for (const line of skillWarnings(projectRoot, project)) console.warn(line);
  for (const line of containerWarnings(projectRoot)) console.warn(line);
  process.exit(status);
}

/**
 * Remove what the ≤0.22 workflow left behind, write the current outputs, then bring the pinned
 * third-party skills up to date (see lib/skills.mjs). Runs after
 * renderAll succeeded, so a config the generator rejects aborts before anything is deleted.
 */
function upgrade(outputs, projectRoot, dryRun) {
  const { deleted, kept } = removeObsoleteOutputs(projectRoot, { dryRun });
  for (const rel of deleted) console.log(`${dryRun ? 'Would delete' : 'Deleted'} ${rel}`);
  for (const rel of kept) console.warn(`Kept ${rel}: not generated by adw, left in place.`);
  const { removed } = cleanProjectConfig(projectRoot, { dryRun });
  for (const key of removed) console.log(`${dryRun ? 'Would remove' : 'Removed'} ai-project.json key ${key}`);
  for (const rel of findCustomLeftovers(projectRoot)) {
    console.warn(`Note: ${rel} belongs to the removed workflow; it is project-owned, so review and delete it yourself.`);
  }
  if (deleted.length === 0 && removed.length === 0) console.log('Nothing obsolete found.');
  if (!dryRun) writeAll(outputs, projectRoot);
  reportSkills(syncSkills(projectRoot, { dryRun }), { dryRun });
  // The container files are project-owned: name the fixes, never apply them.
  for (const line of containerWarnings(projectRoot)) console.warn(line);
  if (dryRun) console.log(`Dry run: would generate ${outputs.length} file(s); nothing was written.`);
  return 0;
}

// Realpath argv[1] before comparing: when this file is invoked through a symlinked bin
// (as npm creates for globally-installed or `npx`-run CLIs on Linux/macOS), Node resolves
// import.meta.url to the symlink target, but process.argv[1] stays the unresolved symlink
// path — an unqualified comparison would silently skip main() and exit 0 with no output.
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main();
}
