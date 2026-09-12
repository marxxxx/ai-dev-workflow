# Container/Host Build-Artefakt-Isolation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build-Artefakte des Linux-Containers (node_modules, .NET `bin`/`obj`) von denen des Hosts trennen, ohne den einen Bind-Mount auf `/workspace`, die Live-Sichtbarkeit der Edits im Host-Editor oder `cap_drop: ALL` aufzugeben.

**Architecture:** .NET-Ausgaben werden per `ArtifactsPath`-Umgebungsvariable im Image aus dem Projektbaum heraus umgebogen (keine Pfadliste nötig). Node-`node_modules` werden von projekteigenen Named Volumes verdeckt, die das konsumierende Projekt in seiner handgepflegten `compose.ai-dev.yml` deklariert; der Entrypoint findet diese Mounts über `/proc/self/mountinfo` selbst und repariert deren Eigentümer. Ein rein lesender Preflight warnt vor nicht maskierten Host-Artefakten, bricht aber nie ab.

**Tech Stack:** Node 24 (nur Builtins), `node:test`, Bash, Docker/Docker Compose, .NET SDK 10.0.401 (MSBuild `ArtifactsPath`).

**Spec:** [docs/superpowers/specs/2026-09-12-container-dependency-isolation-design.md](../specs/2026-09-12-container-dependency-isolation-design.md)

## Global Constraints

- **Zero runtime dependencies:** nur Node-Builtins, keine npm-Pakete hinzufügen.
- **Node `>=24`**; Tests laufen unter `node --test`.
- **LF-Zeilenenden** in allen Dateien, auch unter Windows.
- **Sprache:** Code, Kommentare, Warntexte, `docker/README.md` und Commit-Messages **englisch**. Nur dieser Plan und die Spec sind deutsch.
- **`docker/tools/inventory.json` wird nicht angefasst:** es ist die Quelle für *Versions-Pins*; dieser Plan fügt keine Pins hinzu (`ArtifactsPath` ist keine Version). `node docker/tools/inventory.mjs check` muss unverändert passen.
- **`package.json` `files`-Allowlist wird nicht angefasst:** `docker/` wird nicht über npm publiziert.
- **Neue Unit-Tests gehören nach `docker/tests/*.test.mjs`** — `docker/verify-runtime.sh` nimmt sie per Glob automatisch mit.
- **Entrypoint-Warnungen** benutzen das bestehende Präfix `agent runtime: `.
- **Portabilität der Module:** die neuen Node-Module laufen im Container (POSIX) *und* in Tests auf dem Windows-Host. Pfadvergleiche deshalb über eine Normalisierung auf `/`, nie über rohes String-Matching mit `path.sep`.
- **Das Projekt wird nie rekursiv gechownt.** Jeder `find`-Aufruf mit `chown` benutzt `-xdev` und startet innerhalb eines Volumes.

**Commits:** jede Task endet mit genau einem Commit auf dem Branch `container-dependency-isolation`. Commit-Message-Footer:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

## Dateistruktur

| Datei | Verantwortung |
|---|---|
| `docker/workspace-mounts.mjs` (neu) | **Einzige** Definition von „was ist unterhalb `/workspace` gemountet". Parst `/proc/self/mountinfo`; CLI-Modus für die Shell, Export für den Preflight. |
| `docker/check-host-artifacts.mjs` (neu) | Rein lesende Preflight-Heuristik: nicht maskierte `node_modules` mit Host-Binaries, in-tree `bin`/`obj` ohne Redirect. Liefert Warnstrings, entscheidet nichts. |
| `docker/tools/verify-artifacts.mjs` (neu) | Build-Zeit-Assertion des .NET-Images: ein Build landet unter `ArtifactsPath`, nicht im Projektverzeichnis. |
| `docker/entrypoint.sh` (ändern) | Root-Phase: Eigentümer genesteter Volumes reparieren. Dev-Phase: Preflight aufrufen. Keine eigene Parsing-Logik. |
| `docker/Dockerfile` (ändern) | Kopiert die zwei neuen Runtime-Module nach `/usr/local/lib/agent-runtime/`. |
| `docker/Dockerfile.dotnet` (ändern) | `ENV ArtifactsPath` + `NUGET_PACKAGES`; ruft `verify-artifacts.mjs` im Build. |
| `docker/docker-compose.yml` (ändern) | Kommentierter Beispielblock für maskierende Dependency-Volumes. |
| `docker/tests/workspace-mounts.test.mjs`, `docker/tests/host-artifacts.test.mjs` (neu) | Unit-Tests der beiden Module, ohne Container. |
| `docker/tests/runtime-smoke.mjs` (ändern) | Compose-Helper akzeptiert mehrere `-f`-Dateien; zwei neue Fälle (genestetes Volume, Preflight-Warnung). |
| `docker/README.md` (ändern) | Neuer Abschnitt „Separating host and container dependencies"; Verweis aus der bestehenden Integrationsnotiz. |

---

### Task 1: Mount-Discovery (`workspace-mounts.mjs`)

Diese Task ist reine Node-Logik ohne Docker und lässt sich vollständig auf dem Windows-Host testen.

**Files:**
- Create: `docker/workspace-mounts.mjs`
- Test: `docker/tests/workspace-mounts.test.mjs`

**Interfaces:**
- Consumes: nichts.
- Produces:
  - `nestedMounts(mountinfo: string, root = '/workspace'): string[]` — Mountpoints strikt unterhalb `root`, dedupliziert, in Mount-Reihenfolge.
  - `workspaceMounts(root = '/workspace'): string[]` — dasselbe, liest `/proc/self/mountinfo`.
  - CLI-Modus: NUL-separierte Mountpoints auf stdout.

- [ ] **Step 1: Write the failing test**

Create `docker/tests/workspace-mounts.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { nestedMounts } from '../workspace-mounts.mjs';

// Field 5 (index 4) of /proc/self/mountinfo is the mount point.
function line(id, mountPoint) {
  return `${id} 30 0:${id} / ${mountPoint} rw,relatime shared:1 - ext4 /dev/sda1 rw`;
}

test('returns mounts strictly below the workspace', () => {
  const mountinfo = [
    line(31, '/'),
    line(32, '/workspace'),
    line(33, '/workspace/apps/web/node_modules'),
    line(34, '/home/dev'),
    line(35, '/workspace-other/node_modules'),
    line(36, '/etc/hosts'),
  ].join('\n');
  assert.deepEqual(nestedMounts(mountinfo), ['/workspace/apps/web/node_modules']);
});

test('resolves octal escapes in mount points', () => {
  const mountinfo = [
    line(32, '/workspace'),
    line(33, '/workspace/my\\040project/node_modules'),
    line(34, '/workspace/tab\\011dir/node_modules'),
  ].join('\n');
  assert.deepEqual(nestedMounts(mountinfo), [
    '/workspace/my project/node_modules',
    '/workspace/tab\tdir/node_modules',
  ]);
});

test('reports an overlaid mount point once', () => {
  const mountinfo = [
    line(33, '/workspace/node_modules'),
    line(34, '/workspace/node_modules'),
  ].join('\n');
  assert.deepEqual(nestedMounts(mountinfo), ['/workspace/node_modules']);
});

test('honours an alternative root and tolerates malformed input', () => {
  assert.deepEqual(nestedMounts(line(33, '/srv/app/deps'), '/srv/app'), ['/srv/app/deps']);
  assert.deepEqual(nestedMounts(''), []);
  assert.deepEqual(nestedMounts('garbage\n33 30 0:33\n'), []);
  assert.deepEqual(nestedMounts(undefined), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test docker/tests/workspace-mounts.test.mjs`
Expected: FAIL — `Cannot find module … workspace-mounts.mjs`

- [ ] **Step 3: Write minimal implementation**

Create `docker/workspace-mounts.mjs`:

```javascript
// Discovers the container's own mounts inside the workspace. Compose may mask project
// subdirectories (a container-only node_modules, for example) with volumes; the runtime
// finds them here instead of being told where they are.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ESCAPES = { '040': ' ', '011': '\t', '012': '\n', '134': '\\' };

export function nestedMounts(mountinfo, root = '/workspace') {
  if (typeof mountinfo !== 'string') return [];
  const prefix = `${root.replace(/\/+$/, '')}/`;
  const mounts = [];
  for (const entry of mountinfo.split('\n')) {
    const fields = entry.split(' ');
    if (fields.length < 5) continue;
    const target = fields[4].replace(/\\(040|011|012|134)/g, (_, code) => ESCAPES[code]);
    if (!target.startsWith(prefix) || target.includes('\0')) continue;
    if (!mounts.includes(target)) mounts.push(target);
  }
  return mounts;
}

export function workspaceMounts(root = '/workspace') {
  return nestedMounts(readFileSync('/proc/self/mountinfo', 'utf8'), root);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  // NUL-separated so the entrypoint can read mount points containing spaces.
  process.stdout.write(workspaceMounts().map(mount => `${mount}\0`).join(''));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test docker/tests/workspace-mounts.test.mjs`
Expected: PASS — 4 Tests, keine Fehler.

- [ ] **Step 5: Commit**

```bash
git add docker/workspace-mounts.mjs docker/tests/workspace-mounts.test.mjs
git commit -m "Discover container mounts below the workspace

The runtime must know which project subdirectories Compose masked with a
volume, without being configured with those paths. Parse field 5 of
/proc/self/mountinfo, resolve its octal escapes so paths with spaces work,
and expose the list to both the shell (NUL-separated) and the preflight.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Eigentümer genesteter Volumes reparieren

Ein frisches Named Volume unterhalb des Bind-Mounts hat kein Vorbild im Image: es entsteht als `root:root`, und `dev` (`HOST_UID`) könnte nicht hineinschreiben — `npm ci` scheitert mit `EACCES`. Diese Task macht solche Volumes benutzbar und beweist es im Smoke-Test.

**Files:**
- Modify: `docker/entrypoint.sh` (Root-Phase, nach dem Home-Volume-Block, vor `exec gosu`)
- Modify: `docker/Dockerfile` (Zeile mit `COPY launch-agent.mjs validate-workspace.mjs …`)
- Modify: `docker/docker-compose.yml` (`volumes:`-Block des Service und Top-Level-`volumes:`)
- Modify: `docker/tests/runtime-smoke.mjs`

**Interfaces:**
- Consumes: `node /usr/local/lib/agent-runtime/workspace-mounts.mjs` (CLI-Modus aus Task 1, NUL-separiert).
- Produces: jedes Volume unterhalb `/workspace` gehört beim Start `HOST_UID:HOST_GID`. `docker/tests/runtime-smoke.mjs` hat einen `compose()`-Helper, dessen `file`-Option auch ein Array von Compose-Dateien akzeptiert (von Task 3 weiterbenutzt).

- [ ] **Step 1: Write the failing test**

In `docker/tests/runtime-smoke.mjs` vier Änderungen.

(a) `readdirSync` zum bestehenden `node:fs`-Import in Zeile 3 hinzufügen:

```javascript
import { mkdtempSync, mkdirSync, chmodSync, readFileSync, readdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
```

(b) Nach dem bestehenden `writeFileSync(path.join(project, '.agents/skills/example/SKILL.md'), …)` die Fixture für das genestete Volume und die Override-Compose-Datei anlegen:

```javascript
// A project-declared volume must mask this host node_modules without touching it.
const nested = path.join(project, 'apps', 'web', 'node_modules');
mkdirSync(nested, { recursive: true });
for (const directory of [path.join(project, 'apps'), path.join(project, 'apps', 'web'), nested]) {
  chmodSync(directory, 0o777);
}
writeFileSync(path.join(nested, 'host-marker'), 'host\n');
const override = path.join(temporary, 'deps-override.yml');
writeFileSync(override, [
  'services:',
  '  ai-dev-workflow:',
  '    volumes:',
  '      - type: volume',
  '        source: deps-apps-web',
  '        target: /workspace/apps/web/node_modules',
  'volumes:',
  '  deps-apps-web:',
  '',
].join('\n'));
```

(c) Die `projects`-Zeile um einen dritten Compose-Projektnamen erweitern und den `compose()`-Helper auf mehrere `-f`-Dateien umstellen:

```javascript
const projects = [id, `${id}-other`, `${id}-deps`];
```

```javascript
function compose(args, options = {}) {
  const { name = id, file = template, ...execution } = options;
  const files = (Array.isArray(file) ? file : [file]).flatMap(entry => ['-f', entry]);
  return docker(['compose', '-p', name, ...files, ...args], execution);
}
```

Und im `finally`-Block beide Dateien mitgeben, damit `down --volumes` auch das Override-Volume kennt:

```javascript
  for (const name of projects) compose(['down', '--volumes', '--remove-orphans'], { name, file: [template, override] });
```

(d) Der neue Fall, eingefügt direkt vor der Zeile `const configHash = ok(run(['sha256sum', …`:

```javascript
  // A volume mounted below the bind is container-only: writable by the runtime user,
  // and invisible to the host directory it masks.
  const deps = { name: projects[2], file: [template, override] };
  ok(run(['bash', '-c', [
    'test "$(stat -c %u /workspace/apps/web/node_modules)" = 12345',
    'test ! -e /workspace/apps/web/node_modules/host-marker',
    'echo container > /workspace/apps/web/node_modules/container-marker',
  ].join(' && ')], deps));
  assert.deepEqual(readdirSync(nested), ['host-marker'], 'The container volume must not reach the host node_modules');
  ok(run(['bash', '-c', 'test -e /workspace/apps/web/node_modules/container-marker'], deps));
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker build -f docker/Dockerfile -t ai-dev-workflow docker
node docker/tests/runtime-smoke.mjs
```

Expected: FAIL. Das Volume gehört `root` (`stat -c %u` liefert `0`, nicht `12345`), der Assertion-Text des `ok()`-Helpers zeigt den `bash`-Fehlschlag.

- [ ] **Step 3: Write minimal implementation**

(a) In `docker/entrypoint.sh` in der Root-Phase, unmittelbar **nach** dem bestehenden `find "$APP_HOME" … || fail 'Could not initialize home volume ownership.'` und **vor** `exec gosu`:

```bash
  # Compose may mask project subdirectories with volumes (a container-only node_modules).
  # A fresh volume below the bind mount has no template in the image and starts out
  # root-owned. Repair only when the mount root itself has foreign ownership, and keep
  # find inside the volume with -xdev: the project is never chowned recursively.
  while IFS= read -r -d '' mount; do
    owner="$(stat -c '%u:%g' "$mount" 2>/dev/null || true)"
    if [[ "$owner" != "$HOST_UID:$HOST_GID" ]]; then
      find "$mount" -xdev \( ! -uid "$HOST_UID" -o ! -gid "$HOST_GID" \) \
        -exec chown -h "$HOST_UID:$HOST_GID" {} + ||
        printf 'agent runtime: warning: could not adjust ownership of %s\n' "$mount" >&2
    fi
  done < <(node /usr/local/lib/agent-runtime/workspace-mounts.mjs)
```

(b) In `docker/Dockerfile` die bestehende `COPY`-Zeile der Runtime-Module um das neue Modul erweitern:

```dockerfile
COPY launch-agent.mjs validate-workspace.mjs workspace-mounts.mjs tools/verify-browser.mjs tools/verify-mcp.mjs tools/verify-semantic.mjs tools/verify-versions.mjs /usr/local/lib/agent-runtime/
```

(c) In `docker/docker-compose.yml` den kommentierten Beispielblock ergänzen — im `volumes:`-Block des Service nach dem `agent-home`-Eintrag:

```yaml
      # Container-only dependency trees. Each entry masks the host directory below it,
      # so the host install stays intact and Linux binaries never reach it. Add one per
      # node_modules of your project, and declare the volume at the bottom of this file.
      # - type: volume
      #   source: deps-apps-web
      #   target: /workspace/apps/web/node_modules
```

und im Top-Level-`volumes:`-Block:

```yaml
volumes:
  agent-home:
  # deps-apps-web:
```

- [ ] **Step 4: Run test to verify it passes**

```bash
docker build -f docker/Dockerfile -t ai-dev-workflow docker
node docker/tests/runtime-smoke.mjs
```

Expected: PASS — Abschlusszeile `Runtime smoke passed: …`. Prüfe zusätzlich, dass die bestehende Assertion `service.volumes.length === 2` weiterhin hält (kommentierte YAML-Einträge zählen nicht mit).

- [ ] **Step 5: Commit**

```bash
git add docker/entrypoint.sh docker/Dockerfile docker/docker-compose.yml docker/tests/runtime-smoke.mjs
git commit -m "Make project-declared dependency volumes writable

A named volume mounted below the bind mount masks the host directory, which
is how a Linux node_modules stays out of a Windows or macOS install. Such a
volume has no template in the image and starts out root-owned, so the
runtime user could not install into it.

Repair ownership in the existing root phase, driven by discovered mounts
rather than configuration, and only when the mount root has foreign IDs:
-xdev keeps find inside the volume, so the project is still never chowned.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Preflight-Warnung über Host-Artefakte

Warnt beim Start über Artefakte, die *nicht* maskiert sind — inklusive des Compose-Eintrags, der fehlt. Rein lesend, Exit-Status immer 0.

**Files:**
- Create: `docker/check-host-artifacts.mjs`
- Test: `docker/tests/host-artifacts.test.mjs`
- Modify: `docker/entrypoint.sh` (Dev-Phase, vor dem finalen `exec`)
- Modify: `docker/Dockerfile` (`COPY`-Zeile der Runtime-Module)
- Modify: `docker/tests/runtime-smoke.mjs`

**Interfaces:**
- Consumes: `workspaceMounts()` aus `docker/workspace-mounts.mjs` (Task 1).
- Produces: `findHostArtifacts({ root, mounts = [], artifactsPath = '' }): string[]` — Warnstrings, leer wenn nichts zu melden ist. CLI-Modus schreibt sie nach stderr und endet mit 0.

- [ ] **Step 1: Write the failing test**

Create `docker/tests/host-artifacts.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findHostArtifacts } from '../check-host-artifacts.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'host artifacts '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function tree(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

test('warns about an unmasked node_modules holding host packages', t => {
  const root = fixture(t);
  tree(root, {
    'package.json': '{}',
    'apps/web/node_modules/@rollup/rollup-win32-x64-msvc/index.js': '',
    'apps/web/node_modules/react/index.js': '',
  });
  const [warning, ...rest] = findHostArtifacts({ root });
  assert.deepEqual(rest, []);
  assert.match(warning, /apps\/web\/node_modules/);
  assert.match(warning, /@rollup\/rollup-win32-x64-msvc/);
  assert.match(warning, /target: \/workspace\/apps\/web\/node_modules/);
  assert.match(warning, /source: deps-apps-web/);
});

test('stays silent once the node_modules is masked by a mount', t => {
  const root = fixture(t);
  tree(root, { 'apps/web/node_modules/@esbuild/win32-x64/pkg.json': '' });
  const mounts = [path.join(root, 'apps', 'web', 'node_modules')];
  assert.deepEqual(findHostArtifacts({ root, mounts }), []);
});

test('treats Windows command shims as host traces and Linux trees as clean', t => {
  const shims = fixture(t);
  tree(shims, { 'node_modules/.bin/tsc.cmd': '', 'node_modules/typescript/index.js': '' });
  assert.match(findHostArtifacts({ root: shims })[0], /\.bin[\\/]tsc\.cmd/);
  assert.match(findHostArtifacts({ root: shims })[0], /source: deps-root/);

  const linux = fixture(t);
  tree(linux, {
    'node_modules/.bin/tsc': '',
    'node_modules/@esbuild/linux-x64/pkg.json': '',
    'node_modules/darwinia/index.js': '',
  });
  assert.deepEqual(findHostArtifacts({ root: linux }), []);
});

test('warns about in-tree .NET output only without a redirect', t => {
  const root = fixture(t);
  tree(root, {
    'src/App/App.csproj': '<Project />',
    'src/App/obj/project.assets.json': '{}',
    'src/App/bin/Debug/App.dll': '',
  });
  const [warning] = findHostArtifacts({ root });
  assert.match(warning, /src[\\/]App[\\/]obj/);
  assert.match(warning, /ArtifactsPath/);
  assert.deepEqual(findHostArtifacts({ root, artifactsPath: '/home/dev/artifacts' }), []);
});

test('ignores bin directories without a .NET project', t => {
  const root = fixture(t);
  tree(root, { 'package.json': '{}', 'bin/cli.js': '' });
  assert.deepEqual(findHostArtifacts({ root }), []);
});

test('does not descend into node_modules, .git or build output', t => {
  const root = fixture(t);
  tree(root, {
    'node_modules/pkg/node_modules/@esbuild/win32-x64/pkg.json': '',
    '.git/modules/x/node_modules/@esbuild/win32-x64/pkg.json': '',
    'obj/node_modules/@esbuild/win32-x64/pkg.json': '',
  });
  // The outer node_modules is clean; nothing below it or below .git/obj is reported.
  assert.deepEqual(findHostArtifacts({ root }), []);
});

test('tolerates a missing root', () => {
  assert.deepEqual(findHostArtifacts({ root: path.join(tmpdir(), 'does-not-exist-91237') }), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test docker/tests/host-artifacts.test.mjs`
Expected: FAIL — `Cannot find module … check-host-artifacts.mjs`

- [ ] **Step 3: Write minimal implementation**

Create `docker/check-host-artifacts.mjs`:

```javascript
// Warns when the mounted project carries build artifacts of the host platform that no
// container volume masks, and when in-tree .NET output is shared without a redirect.
// Advisory only: host and container installs overwrite each other, but the agents still
// start. Read-only, and it never descends into a dependency tree.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { workspaceMounts } from './workspace-mounts.mjs';

const MAX_DEPTH = 5;
const SKIP = new Set(['.git', '.vs', '.hg', '.svn']);
const HOST_PACKAGE = /(^|-)(win32|windows|darwin)(-|$)|msvc/i;
const HOST_SHIM = /\.(cmd|ps1)$/i;
const PROJECT_FILE = /\.(csproj|fsproj|sln|slnx)$/i;
const OUTPUT = new Set(['bin', 'obj']);

const slashes = target => target.split(path.sep).join('/');

function entries(directory) {
  try { return readdirSync(directory, { withFileTypes: true }); } catch { return []; }
}

function masked(directory, mounts) {
  const target = slashes(directory);
  return mounts.some(mount => target === slashes(mount) || target.startsWith(`${slashes(mount)}/`));
}

// apps/web/node_modules -> deps-apps-web; a root node_modules -> deps-root.
function volumeName(relative) {
  const parent = path.posix.dirname(slashes(relative));
  const slug = parent === '.' ? 'root' : parent.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `deps-${slug || 'root'}`;
}

function hostTrace(nodeModules) {
  for (const entry of entries(path.join(nodeModules, '.bin'))) {
    if (!entry.isDirectory() && HOST_SHIM.test(entry.name)) return path.join('.bin', entry.name);
  }
  for (const entry of entries(nodeModules)) {
    if (!entry.isDirectory()) continue;
    if (HOST_PACKAGE.test(entry.name)) return entry.name;
    if (!entry.name.startsWith('@')) continue;
    for (const scoped of entries(path.join(nodeModules, entry.name))) {
      if (scoped.isDirectory() && HOST_PACKAGE.test(scoped.name)) return `${entry.name}/${scoped.name}`;
    }
  }
  return null;
}

export function findHostArtifacts({ root, mounts = [], artifactsPath = '' }) {
  const warnings = [];
  const output = [];
  let project = false;
  const queue = [{ directory: root, depth: 0 }];
  while (queue.length) {
    const { directory, depth } = queue.shift();
    for (const entry of entries(directory)) {
      const full = path.join(directory, entry.name);
      if (!entry.isDirectory()) {
        if (entry.isFile() && PROJECT_FILE.test(entry.name)) project = true;
        continue;
      }
      if (entry.name === 'node_modules') {
        if (masked(full, mounts)) continue;
        const trace = hostTrace(full);
        if (trace) {
          const relative = path.relative(root, full);
          const volume = volumeName(relative);
          warnings.push([
            `agent runtime: warning: ${slashes(relative)} holds host-platform files (${slashes(trace)})`,
            '  and no container volume masks it, so host and container installs overwrite each other.',
            '  Add to your compose.ai-dev.yml, under services.ai-dev-workflow.volumes:',
            '      - type: volume',
            `        source: ${volume}`,
            `        target: /workspace/${slashes(relative)}`,
            `  and declare the volume at the bottom of the file: ${volume}:`,
          ].join('\n'));
        }
        continue;
      }
      if (OUTPUT.has(entry.name)) { output.push(path.relative(root, full)); continue; }
      if (SKIP.has(entry.name)) continue;
      if (depth + 1 < MAX_DEPTH) queue.push({ directory: full, depth: depth + 1 });
    }
  }
  if (!artifactsPath && project && output.length) {
    const listed = output.slice(0, 3).map(slashes).join(', ');
    warnings.push([
      `agent runtime: warning: in-tree .NET build output (${listed}${output.length > 3 ? ', …' : ''}) is shared with the host`,
      '  and ArtifactsPath is not set, so host and container builds overwrite each other, including',
      '  obj/project.assets.json and its package paths. Use the .NET image, or set ArtifactsPath in',
      '  the service environment of your compose.ai-dev.yml.',
    ].join('\n'));
  }
  return warnings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const warnings = findHostArtifacts({
      root: '/workspace',
      mounts: workspaceMounts(),
      artifactsPath: process.env.ArtifactsPath ?? '',
    });
    for (const warning of warnings) console.warn(warning);
  } catch (error) {
    // Advisory check: a failure here must never keep the agents from starting.
    console.warn(`agent runtime: warning: could not inspect the project for host build artifacts (${error.message})`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test docker/tests/host-artifacts.test.mjs`
Expected: PASS — 7 Tests, keine Fehler.

- [ ] **Step 5: Wire it into the runtime**

(a) In `docker/entrypoint.sh` in der Dev-Phase, direkt **vor** `if [[ $# == 0 ]]; then set -- bash; fi`:

```bash
# Advisory: host build artifacts the project shares with the container. Never fatal.
node /usr/local/lib/agent-runtime/check-host-artifacts.mjs || true
```

(b) In `docker/Dockerfile` die `COPY`-Zeile der Runtime-Module erweitern:

```dockerfile
COPY launch-agent.mjs validate-workspace.mjs workspace-mounts.mjs check-host-artifacts.mjs tools/verify-browser.mjs tools/verify-mcp.mjs tools/verify-semantic.mjs tools/verify-versions.mjs /usr/local/lib/agent-runtime/
```

(c) In `docker/tests/runtime-smoke.mjs` eine unmaskierte Host-Fixture anlegen — direkt nach dem `override`-Block aus Task 2:

```javascript
// Unmasked and full of host binaries: the preflight must say so without failing.
mkdirSync(path.join(project, 'pkg', 'node_modules', '@rollup', 'rollup-win32-x64-msvc'), { recursive: true });
```

und den Fall direkt nach dem genesteten-Volume-Fall aus Task 2:

```javascript
  const preflight = run(['true']);
  assert.equal(preflight.status, 0, preflight.stderr);
  assert.match(preflight.stderr, /pkg\/node_modules holds host-platform files/);
  assert.match(preflight.stderr, /source: deps-pkg/);
```

- [ ] **Step 6: Run the runtime test to verify the wiring**

```bash
docker build -f docker/Dockerfile -t ai-dev-workflow docker
node docker/tests/runtime-smoke.mjs
```

Expected: PASS — `Runtime smoke passed: …`, und die Warnung erscheint auf stderr, ohne den Start zu verhindern.

- [ ] **Step 7: Commit**

```bash
git add docker/check-host-artifacts.mjs docker/tests/host-artifacts.test.mjs docker/entrypoint.sh docker/Dockerfile docker/tests/runtime-smoke.mjs
git commit -m "Warn about host build artifacts the container shares

Mounting the project shares in-tree artifacts both ways: Windows binaries
confuse the container, and the container overwrites bin/obj with Linux
paths. The isolation mechanisms only help if you notice one is missing.

Check the workspace for an unmasked node_modules holding host-platform
packages or Windows command shims, and for in-tree .NET output without a
redirect. The message names the exact compose entry to add. Advisory: the
check is read-only and always exits 0.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: .NET-Ausgaben aus dem Projektbaum umbiegen

MSBuild übernimmt Umgebungsvariablen als globale Properties. Eine Variable im Image biegt damit jeden Build im Container um — ohne Pfadliste, ohne Projektdatei anzufassen. Gemessen mit SDK 10.0.401: das Projektverzeichnis bleibt nach einem Clean-Build unberührt.

**Files:**
- Create: `docker/tools/verify-artifacts.mjs`
- Modify: `docker/Dockerfile.dotnet` (`ENV`-Block; `COPY`/`RUN` am Ende)

**Interfaces:**
- Consumes: nichts aus vorherigen Tasks.
- Produces: Image-Vertrag `ArtifactsPath=/home/dev/artifacts` und `NUGET_PACKAGES=/home/dev/.nuget/packages` — beide im `agent-home`-Volume, also pro Compose-Projekt getrennt, und aus der Compose-Datei überschreibbar. `check-host-artifacts.mjs` (Task 3) liest `ArtifactsPath` und schweigt, wenn es gesetzt ist.

- [ ] **Step 1: Write the failing check**

Create `docker/tools/verify-artifacts.mjs`:

```javascript
// Proves that the .NET image keeps build output out of the mounted project: MSBuild picks
// up the image's ArtifactsPath as a global property, so bin/ and obj/ never land in the
// project directory and the host's obj/project.assets.json is never read or overwritten.
// Runs at image build time. The build below redirects into a temporary home of its own,
// so it leaves nothing behind in /home/dev (a fresh home volume is seeded from the image).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ARTIFACTS = '/home/dev/artifacts';
const PACKAGES = '/home/dev/.nuget/packages';
assert.equal(process.env.ArtifactsPath, ARTIFACTS, `The image must set ArtifactsPath=${ARTIFACTS}`);
assert.equal(process.env.NUGET_PACKAGES, PACKAGES, `The image must set NUGET_PACKAGES=${PACKAGES}`);

const home = mkdtempSync(path.join(tmpdir(), 'verify-artifacts-'));
try {
  const artifacts = path.join(home, 'artifacts');
  const project = path.join(home, 'App');
  mkdirSync(project);
  const framework = `net${execFileSync('dotnet', ['--version'], { encoding: 'utf8' }).trim().split('.')[0]}.0`;
  writeFileSync(path.join(project, 'App.csproj'), [
    '<Project Sdk="Microsoft.NET.Sdk">',
    '  <PropertyGroup>',
    `    <TargetFramework>${framework}</TargetFramework>`,
    '  </PropertyGroup>',
    '</Project>',
    '',
  ].join('\n'));
  writeFileSync(path.join(project, 'Class1.cs'), 'public class Class1 { }\n');
  execFileSync('dotnet', ['build', '--nologo', '-v:q'], {
    cwd: project,
    stdio: 'inherit',
    env: { ...process.env, HOME: home, ArtifactsPath: artifacts, NUGET_PACKAGES: path.join(home, 'nuget') },
  });
  for (const leaked of ['bin', 'obj']) {
    assert.equal(existsSync(path.join(project, leaked)),
      false, `dotnet build wrote ${leaked}/ into the project directory`);
  }
  assert.ok(existsSync(path.join(artifacts, 'bin', 'App')), 'Build output did not land under ArtifactsPath');
  assert.ok(existsSync(path.join(artifacts, 'obj', 'App', 'project.assets.json')),
    'Restore assets did not land under ArtifactsPath');
} finally {
  rmSync(home, { recursive: true, force: true });
}

console.log(`dotnet build keeps bin/obj out of the project directory (ArtifactsPath=${ARTIFACTS}): ok`);
```

- [ ] **Step 2: Run it against the current image to verify it fails**

```bash
docker build -f docker/Dockerfile -t ai-dev-workflow docker
docker build -f docker/Dockerfile.dotnet --build-arg BASE_IMAGE=ai-dev-workflow -t ai-dev-workflow-dotnet docker
docker run --rm -v "$(pwd)/docker/tools/verify-artifacts.mjs:/tmp/verify-artifacts.mjs:ro" \
  --entrypoint node ai-dev-workflow-dotnet /tmp/verify-artifacts.mjs
```

Expected: FAIL — `The image must set ArtifactsPath=/home/dev/artifacts` (die Variable existiert noch nicht).

- [ ] **Step 3: Set the image contract and run the check during the build**

In `docker/Dockerfile.dotnet` den `ENV`-Block um die zwei Variablen erweitern (die übrigen Zeilen unverändert lassen):

```dockerfile
ENV DEBIAN_FRONTEND=noninteractive \
    DOTNET_ROOT=/usr/share/dotnet \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 \
    DOTNET_NOLOGO=1 \
    IMAGE_VARIANT=dotnet \
    ArtifactsPath=/home/dev/artifacts \
    NUGET_PACKAGES=/home/dev/.nuget/packages \
    SSL_CERT_DIR=/home/dev/.aspnet/dev-certs/trust:/etc/ssl/certs \
    PATH=/usr/share/dotnet:/usr/local/bin:/opt/uv/bin:/opt/agent-tools/node_modules/.bin:/usr/sbin:/usr/bin:/sbin:/bin
```

Und am Ende der Datei, neben der bestehenden `COPY tools/verify-dev-cert.mjs …`-Zeile:

```dockerfile
COPY tools/verify-artifacts.mjs tools/verify-dev-cert.mjs /usr/local/lib/agent-runtime/
RUN node /usr/local/lib/agent-runtime/verify-artifacts.mjs
```

(Die bisherige eigenständige `COPY tools/verify-dev-cert.mjs /usr/local/lib/agent-runtime/`-Zeile entfällt dadurch.)

- [ ] **Step 4: Build to verify the check passes**

```bash
docker build -f docker/Dockerfile.dotnet --build-arg BASE_IMAGE=ai-dev-workflow -t ai-dev-workflow-dotnet docker
```

Expected: Der Build läuft durch und zeigt `dotnet build keeps bin/obj out of the project directory (ArtifactsPath=/home/dev/artifacts): ok`.

Gegenprobe im laufenden Container — der Projektbaum bleibt unberührt:

```bash
docker run --rm --entrypoint bash ai-dev-workflow-dotnet -c \
  'cd /tmp && dotnet new classlib -o p >/dev/null && cd p && rm -rf bin obj && dotnet build -v:q --nologo >/dev/null && ls -a'
```

Expected: nur `.`, `..`, `Class1.cs`, `p.csproj` — kein `bin`, kein `obj`.

- [ ] **Step 5: Commit**

```bash
git add docker/tools/verify-artifacts.mjs docker/Dockerfile.dotnet
git commit -m "Redirect .NET build output out of the mounted project

Sharing bin/obj with the host breaks both sides: the container reads an
obj/project.assets.json whose package paths point at the host NuGet cache,
and the host then reads one full of Linux paths and RIDs.

MSBuild takes environment variables as global properties, so one ArtifactsPath
in the image redirects every build in the container -- no path list, no
project file touched, and it namespaces per project the way BaseOutputPath
does not. Both targets live in the home volume, so they are per Compose
project. A build-time check fails the image if an SDK or environment change
ever puts bin/obj back into the project directory.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Dokumentation und Gesamtverifikation

**Files:**
- Modify: `docker/README.md` (neuer Abschnitt nach „Filesystem and process boundary"; Verweis in der Integrationsnotiz)

**Interfaces:**
- Consumes: das Verhalten aus Task 2–4.
- Produces: nichts, worauf Code sich stützt.

- [ ] **Step 1: Add the documentation section**

In `docker/README.md` direkt **nach** dem Abschnitt „Filesystem and process boundary" (vor „Consuming-project E2E integration") einfügen:

```markdown
## Separating host and container dependencies

Everything below `$HOME` is already isolated: the NuGet package cache, the npm cache, uv
and Azure CLI state live in the `agent-home` volume, the Playwright browsers in the image.
What the bind mount shares are the artifacts that sit *inside* the project tree, and it
shares them both ways: a `node_modules` full of `win32` binaries breaks builds in the
container, and the container overwrites `bin`/`obj` with Linux paths and RIDs, which then
breaks the build on the host.

**.NET needs no configuration.** The .NET image sets `ArtifactsPath=/home/dev/artifacts`
and `NUGET_PACKAGES=/home/dev/.nuget/packages`; MSBuild takes both as global properties, so
every build in the container writes below the home volume and the project tree stays
untouched — no `bin`, no `obj`, and the host's `obj/project.assets.json` is never read.
Output is namespaced per project (`artifacts/{bin,obj}/<project>/<configuration>/`). Three
caveats: a `Directory.Build.props` that sets `ArtifactsPath` or `BaseOutputPath` itself wins
over the environment; scripts with hardcoded paths such as `bin/Debug/net10.0/App.dll` break
in the container; and non-SDK projects are not covered.

**Node needs one volume per dependency tree.** npm has no equivalent redirect, so declare a
named volume for each `node_modules` of your project. Mounted below the bind, it masks the
host directory: the host install stays intact and usable, the container gets its own Linux
tree, and on Docker Desktop it is markedly faster than going through the bind mount.

```yaml
services:
  ai-dev-workflow:
    volumes:
      # … the existing bind on /workspace and the agent-home volume …
      - type: volume
        source: deps-apps-web
        target: /workspace/apps/web/node_modules

volumes:
  agent-home:
  deps-apps-web:
```

Use **named** volumes, not anonymous ones: anonymous volumes disappear with `run --rm`,
named ones persist per Compose project name (`-p`) like `agent-home`. Two consequences: the
volume starts out empty, so the first container start needs an `npm ci` (or your project's
equivalent) inside the container; and where the mount point does not exist on the host,
Docker creates it as an empty directory — harmless, and usually gitignored.

The runtime does the rest on its own. It discovers these mounts through
`/proc/self/mountinfo` rather than configuration, and gives each one to the runtime user, so
installing into a fresh volume works without a recursive chown of the project. On every
start it also checks the project for artifacts that *no* volume masks — an unmasked
`node_modules` holding host-platform packages, or in-tree `bin`/`obj` without a redirect —
and prints the compose entry that is missing. That check is advisory and never fails the
start.

The copied `compose.ai-dev.yml` is yours to edit: add the database or other services your
development setup needs, publish ports, pass credentials through `environment`. Only the
`PROJECT_ROOT` bind on `/workspace` and the `agent-home` volume are load-bearing.
```

Außerdem in der bestehenden Notiz im Abschnitt „Consuming-project E2E integration" die Erwähnung der `node_modules`-Volumes auf den neuen Abschnitt verweisen lassen:

```markdown
BomManagerWeb integration is a **separate task**: provide its MongoDB sidecar and
dataset, its `node_modules` volumes (see [Separating host and container
dependencies](#separating-host-and-container-dependencies)), an `.env.ai` profile and a new
`dev:ai` entry point. Keep `dev:max` and other Windows scripts unchanged. This generic
repository adds none of that application's services, ports or settings.
```

- [ ] **Step 2: Verify the whole suite**

```bash
npm test
node docker/tools/inventory.mjs check
node docker/build.mjs --tag "$(date -u +%Y.%m.%d)"
bash docker/verify-runtime.sh
```

Expected: `npm test` grün (auf Windows schlägt bekanntlich der Symlink-Fall in `agent-src/cli.test.mjs` mit `EPERM` fehl — Umgebungslimit, kein Fehler dieses Plans). `inventory.mjs check` ohne Drift. Alle drei Images bauen, inklusive der Zeile `dotnet build keeps bin/obj out of the project directory …: ok`. `verify-runtime.sh` endet mit `Runtime smoke passed: …` für Base und .NET.

- [ ] **Step 3: Commit**

```bash
git add docker/README.md
git commit -m "Document host and container dependency separation

Covers what the bind mount shares and why, the .NET redirect with its three
caveats, the per-tree Node volume recipe, the empty-volume first run, and the
discovery and preflight the runtime does on its own. States explicitly that
the copied compose file is the project's own: extra services, ports and
credentials belong there, and only the workspace bind and agent-home volume
are load-bearing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec-Abdeckung:** Abschnitt 1 (.NET-Redirect + Build-Zeit-Assertion) → Task 4. Abschnitt 2 (maskierende Volumes, Compose-Vorlage) → Task 2. Abschnitt 3 (Eigentümer-Reparatur, `workspace-mounts.mjs`) → Task 1 + 2. Abschnitt 4 (Preflight, beide Regeln, Tiefenlimit, Skip-Verzeichnisse) → Task 3. Abschnitt 5 (Doku, Verweis aus der Integrationsnotiz) → Task 5. Testmatrix der Spec → Task 1 Step 1, Task 2 Step 1, Task 3 Step 1 + 5c, Task 4 Step 1, Task 5 Step 2. Keine Lücke.

**Typkonsistenz:** `nestedMounts`/`workspaceMounts` (Task 1) werden in Task 2 nur über den CLI-Modus und in Task 3 über `workspaceMounts()` konsumiert — Namen und Signaturen stimmen über alle Tasks überein. `findHostArtifacts({ root, mounts, artifactsPath })` wird in Task 3 einmal definiert und nur dort benutzt. Die Volume-Namenskonvention `deps-<pfad-slug>` ist in Task 2 (Fixture `deps-apps-web`), Task 3 (`volumeName`, Tests `deps-apps-web`/`deps-root`/`deps-pkg`) und Task 5 (Doku) identisch.

**Abhängigkeiten zwischen Tasks:** Task 2 setzt Task 1 voraus (CLI-Modul im Image). Task 3 setzt Task 1 (Import) und Task 2 (`compose()`-Helper mit Array-`file`) voraus. Task 4 ist unabhängig. Task 5 setzt 2–4 voraus. Reihenfolge 1 → 2 → 3 → 4 → 5 ist zwingend bis auf Task 4, die vorgezogen werden könnte.
