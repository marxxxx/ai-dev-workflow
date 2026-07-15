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
//   ai-dev-workflow <cmd> --root <dir>            target a project root other than cwd
//
// `--check` is still accepted as a legacy alias for the `check` command.
//
// Config is split across two files:
//   - config/ai-workflow.json  (package-owned, under agent-src/config/): workflow states/artifacts
//                        + ticketing.includePath. Travels and updates with the package.
//   - ai-project.json          (project-owned, at the project root): project/repository/git identity
//                        and the ticketing backend choice (file | github | azure-devops).
//
// This file is a thin orchestrator: it parses argv, dispatches to the pieces below, and
// re-exports the public API for back-compat with in-process tests and external importers.
// The implementation lives in the feature modules under agent-src/lib/:
//   constants · serialize · identity · config · tokens · units · ticketing · renderers ·
//   onboard · pipeline
//
// Zero dependencies: node builtins only. Writes LF line endings on every platform.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { argValue } from './lib/constants.mjs';
import { cmdInit } from './lib/onboard.mjs';
import { renderAll, writeAll, checkAll } from './lib/pipeline.mjs';

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

/** The first non-flag argument is the command; `--root`/`--answers` and their values are skipped. */
function parseCommand(argv) {
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--root' || a === '--answers') { i++; continue; } // skip the value that follows the flag
    if (a.startsWith('-')) continue;
    return a;
  }
  return args.includes('--check') ? 'check' : 'generate';
}

function main() {
  const command = parseCommand(process.argv);
  const projectRoot = resolveProjectRoot(process.argv);

  if (command === 'init') {
    cmdInit(projectRoot)
      .then((code) => process.exit(code))
      .catch((err) => { console.error(`init failed: ${err.message}`); process.exit(1); });
    return;
  }

  if (command !== 'generate' && command !== 'check') {
    console.error(`Unknown command "${command}". Use: generate | check | init`);
    process.exit(1);
  }

  let outputs;
  try {
    outputs = renderAll(projectRoot);
  } catch (err) {
    console.error(`Generation failed: ${err.message}`);
    process.exit(1);
  }
  process.exit(command === 'check' ? checkAll(outputs, projectRoot) : (writeAll(outputs, projectRoot), 0));
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
