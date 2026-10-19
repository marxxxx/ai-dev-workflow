---
name: e2e-run
description: Use when asked to run the ai-dev-workflow E2E self-test (Harbor, e2e/run.mjs) for one or more harnesses — claude-code, codex, opencode — and report how the result compares with the previous run.
---

# E2E run

## Overview

Runs `node e2e/run.mjs run` for the given harnesses, then presents one short overview against
the previous run that links to the detailed documents. Details stay in the documents; the
overview says only what changed and what needs a look. Reference: `docs/adw-e2e/README.md`.

## Before the run

- Live runs use the user's subscription quota (Claude for the simulated user, verifier and
  review; ChatGPT for codex). The skill being invoked is the go-ahead for the named harnesses
  only. A full run of one harness takes about 1–2 h.
- One harness per 5-hour limit window. For several harnesses, run the first and ask before the
  next one.
- `git status` clean: the run records the commit, and only results whose commit is on `main` are
  baselines.

## Commands

From the repo root, one harness at a time:

```bash
node e2e/run.mjs preflight --harness <h>                 # foreground; stop if it fails
node e2e/run.mjs run --harness <h>                       # background, wait for the exit notification
node e2e/run.mjs run --harness <h> --task demo-todo --repetitions 1   # only when the user asks for a quick run
```

If the permission classifier blocks `run`, give the user the line to type: `! node e2e/run.mjs run --harness <h>`.

The run prints `results: docs/adw-e2e/<ts>` and writes `compare.md` per task when a baseline
exists. No `compare.md`: find the newest earlier non-aborted `docs/adw-e2e/*/<task>/<h>/` and run
`node e2e/run.mjs compare <thatDir> <newDir>`; label that baseline "not on main".

## After the run

Read `summary.md`, then per task `compare.md` and `report.md`. For every failed check or failed
criterion, open the trial's evidence, and for a short or failed trial also
`e2e/jobs/<ts>/<task>/<trial>/*/user-agent/claude-code.txt`: a simulated-user (bridge) defect is
not an agent failure. A baseline is not comparable when it is `aborted`, uncalibrated, or an
opencode run older than commit 576ccfb (ran without MCP and superpowers).

## Overview report

Present exactly these parts, in this order, and nothing else:

1. **Heading:** `E2E <ts> · <harnesses> vs <baseline ts>`
2. **Table**, one row per task × harness:
   `| Task | Harness | Reward (base → now) | Verdict | Changed signals | MCP calls | Errors |`
   Verdict from `compare.md`; changed signals are at most three from its Signals table, as
   `name base → now`; MCP calls from the new `report.md` (`serena 0 · playwright 44 · context7 0`),
   `—` when the report has no MCP usage section.
3. **Bottom line:** one sentence: better, worse or unchanged, and what drove the verdict.
4. **Worth a look:** at most three bullets, each with the trial id and a link to its evidence:
   failed checks or criteria, bridge defects, aborted or uncalibrated runs, a non-comparable
   baseline. Write `none` when nothing needs a look.
5. **Details:** `[summary](docs/adw-e2e/<ts>/summary.md)` and per row
   `[report](…/report.md) · [compare](…/compare.md)`, as full repo-relative links.

Then ask whether to commit `docs/adw-e2e/<ts>/` and whether to run the next harness.

## Common mistakes

| Mistake | Fix |
|---|---|
| Treating `worse` as a regression of the workflow | Read which signals drove it; 3 trials are noisy, compare rates and medians |
| Shortened paths (`.../report.md`) | Full repo-relative links, so they open |
| Deleting an `aborted` result silently | Say so in "Worth a look"; rerun after the limit resets |
