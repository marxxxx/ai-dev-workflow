// Config I/O + the two config sources merged into the flat {{token}} namespace.

import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR } from './constants.mjs';

/** Read and parse a JSON file. Returns null when absent unless `required`. */
export function readJson(absPath, label, required) {
  if (!fs.existsSync(absPath)) {
    if (required) throw new Error(`${label} not found at ${absPath}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (e) {
    throw new Error(`${label} is not valid JSON: ${e.message}`);
  }
}

/**
 * Merge the two config sources into the single object the token builder consumes:
 *   - workflow states/artifacts and ticketing.includePath come from the package
 *     (ai-workflow.json) — they are skill-coupled and must not be reconfigured per project.
 *   - project/repository/git identity and the ticketing backend choice come from the
 *     project (ai-project.json).
 * The package wins on `workflow` and on `ticketing.includePath`; the project owns the rest of
 * `ticketing` (backend, github/file sub-configs). ai-project.json may be absent on a
 * fresh/unmigrated repo, in which case only the package-owned config is returned.
 */
export function loadConfig(projectRoot) {
  const pkg = readJson(path.join(SRC_DIR, 'config', 'ai-workflow.json'), 'agent-src/config/ai-workflow.json', true);
  const project = readJson(path.join(projectRoot, 'ai-project.json'), 'ai-project.json', false) || {};
  return {
    ...project,
    workflow: pkg.workflow,
    ticketing: { ...(project.ticketing || {}), includePath: pkg.ticketing?.includePath },
    app: { ...(project.app || {}), includePath: pkg.app?.includePath },
    cost: { ...(project.cost || {}), includePath: pkg.cost?.includePath },
  };
}

/** Azure DevOps process template → work-item types + workflow-state→board-state map. */
const AZURE_TEMPLATES = {
  basic: {
    featureType: 'Issue',
    bugType: 'Issue',
    stateMapping: {
      'new': 'To Do', 'in-progress': 'Doing', 'review': 'Doing',
      'test': 'Doing', 'failed': 'Doing', 'acceptance-test': 'Doing',
    },
  },
  scrum: {
    featureType: 'Product Backlog Item',
    bugType: 'Bug',
    stateMapping: {
      'new': 'New', 'in-progress': 'Committed', 'review': 'Committed',
      'test': 'Committed', 'failed': 'Committed', 'acceptance-test': 'Committed',
    },
  },
};

export function azureMapping(template) {
  const m = AZURE_TEMPLATES[template];
  if (!m) throw new Error(`unknown Azure process template "${template}" (expected basic|scrum)`);
  return structuredClone(m);
}

/** Assemble the project-owned ai-project.json object from flat interview answers. */
export function buildProjectConfig(a) {
  const ticketing = { backend: a.backend };
  if (a.backend === 'file') {
    ticketing.file = { dir: a.file.dir, metadataFile: a.file.metadataFile };
  } else if (a.backend === 'azure-devops') {
    const m = azureMapping(a.azure.processTemplate);
    ticketing.azureDevOps = {
      organization: a.azure.organization,
      project: a.azure.project,
      featureType: m.featureType,
      bugType: m.bugType,
      processTemplate: a.azure.processTemplate,
      stateMapping: m.stateMapping,
    };
  }
  return {
    project: { name: a.name, slug: a.slug, serenaProject: a.serena, description: a.description },
    repository: { slug: a.repoSlug, defaultBranch: a.defaultBranch },
    ticketing,
    git: { branchPattern: a.branchPattern, prTarget: a.prTarget },
  };
}

/**
 * Flatten the structured config into the dotted `{{token}}` namespace shared by
 * every unit body and manifest string. Status tokens resolve to the GitHub label
 * or the file-frontmatter value depending on the selected backend.
 */
export function buildGlobalTokens(config) {
  const c = config || {};
  const t = {};
  const put = (k, v) => { if (v != null) t[k] = String(v); };

  put('project.name', c.project?.name);
  put('project.slug', c.project?.slug);
  put('project.serena', c.project?.serenaProject);
  put('project.description', c.project?.description);

  put('repo.slug', c.repository?.slug);
  put('repo.defaultBranch', c.repository?.defaultBranch);

  const backend = c.ticketing?.backend || 'github';
  put('ticketing.backend', backend);
  put('ticketing.include', c.ticketing?.includePath);
  put('ticketing.dir', c.ticketing?.file?.dir);
  put('ticketing.metadataFile', c.ticketing?.file?.metadataFile);
  put('ticketing.azure.organization', c.ticketing?.azureDevOps?.organization);
  put('ticketing.azure.project', c.ticketing?.azureDevOps?.project);
  put('ticketing.azure.featureType', c.ticketing?.azureDevOps?.featureType || 'Issue');
  put('ticketing.azure.bugType', c.ticketing?.azureDevOps?.bugType || 'Issue');

  put('git.branchPattern', c.git?.branchPattern);
  put('git.prTarget', c.git?.prTarget);

  // E2E runtime: the include path is package-owned (always present). The include itself points the
  // qa-engineer at the project's AGENTS.md e2e-setup section — no per-project command tokens.
  put('app.include', c.app?.includePath);

  // Cost accounting: the include path is package-owned (always present). The include tells the
  // workflow how to record ccusage session cost and post the per-ticket summary at acceptance-test.
  put('cost.include', c.cost?.includePath);

  for (const [k, v] of Object.entries(c.workflow?.artifacts || {})) put(`artifact.${k}`, v);
  const usesTagLabels = backend === 'github' || backend === 'azure-devops';
  const azMap = c.ticketing?.azureDevOps?.stateMapping || {};
  for (const s of c.workflow?.states || []) {
    put(`status.${s.id}`, usesTagLabels ? s.label : s.frontmatter);
    put(`azureState.${s.id}`, azMap[s.id] || s.azureState);
  }

  // Free-form escape hatch: config.tokens overrides any derived token.
  for (const [k, v] of Object.entries(c.tokens || {})) put(k, v);

  return t;
}
