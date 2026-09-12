# Design: Container/Host Build-Artefakt-Isolation

**Date:** 2026-09-12
**Status:** Approved (pending spec review)

## Problem

Der Agent-Container bindet das komplette Projekt einmal auf `/workspace`
([docker/docker-compose.yml](../../../docker/docker-compose.yml)). Alles, was unter `$HOME`
liegt, ist dadurch bereits isoliert — NuGet-Paket-Cache, npm-Cache, uv und Azure-CLI-State
liegen im `agent-home`-Volume, die Playwright-Browser im Image. **Nicht** isoliert sind
Artefakte, die per Konvention *im Projektbaum* liegen:

- `node_modules/` mit plattformspezifischen Binaries (`@esbuild/win32-x64`,
  `@rollup/rollup-win32-x64-msvc`, `@next/swc-win32-x64-msvc`, `.bin/*.cmd`-Shims)
- `bin/` und `obj/` von .NET, inklusive `obj/project.assets.json`, dessen `packageFolders`
  auf Host-Pfade wie `C:\Users\<user>\.nuget\packages` zeigen

Die Kontamination läuft in **beide** Richtungen: Host-Artefakte lassen Builds im Container
fehlschlagen, und der Container überschreibt `obj/`/`bin/` mit Linux-Pfaden und -RIDs, was
danach den Host-Build zerlegt. Node-Monorepos verschärfen das durch mehrere `node_modules`
auf verschiedenen Ebenen.

## Ziel

Container- und Host-Abhängigkeiten trennen, ohne die tragenden Eigenschaften des Setups
aufzugeben: ein Bind-Mount, Edits bleiben live im Host-Editor sichtbar, `cap_drop: ALL`
bleibt, das Projekt wird nie rekursiv gechownt.

## Nicht-Ziele (bewusst ausgeschlossen)

| Verworfen | Grund |
|---|---|
| `container.isolatedPaths` in `ai-project.json` + generierte Compose-Datei | Die Compose-Datei muss projekteigen und handeditierbar bleiben: Projekte fahren zusätzliche Entwicklungs-Services (z.B. Datenbanken) hoch und geben Credentials über Env-Variablen weiter. Ein generiertes, nicht-handeditierbares Artefakt stünde dem entgegen. |
| Overlayfs über `/workspace` | Braucht `CAP_SYS_ADMIN`, bricht die dokumentierte Capability-Grenze; der Host sähe die Änderungen nicht mehr. |
| Container-private Arbeitskopie (`git clone` nach `/home/dev/work`) | Vollständige Isolation, aber die Agent-Edits erscheinen nicht mehr live im Editor des Menschen; verlangt Umbau von Mount-Modell und `validate-workspace.mjs`. Später als Opt-in denkbar. |
| Ausgabepfade für Node umbiegen | Existiert nicht: npm hat kein verlässliches Äquivalent zu `ArtifactsPath` (`NODE_PATH` ist deprecated). |

## Verantwortungsteilung

- **Image/Entrypoint (dieses Repo):** biegt .NET-Ausgaben um und repariert Eigentümer an
  genesteten Volumes. Kennt **keine** Projektpfade — es entdeckt zur Laufzeit, was gemountet ist.
- **`compose.ai-dev.yml` (konsumierendes Projekt, handgepflegt):** deklariert die
  Node-Dependency-Volumes, zusätzliche Services, Ports und Credentials. Tragend sind nur
  `PROJECT_ROOT → /workspace` und `agent-home`; alles andere darf das Projekt frei erweitern.
- **Doku:** das Rezept, die Erstlauf-Kosten und die Caveats.

### Dateien

| Datei | Änderung |
|---|---|
| `docker/Dockerfile.dotnet` | **Neu:** `ENV ArtifactsPath`, explizites `NUGET_PACKAGES`; Build-Zeit-Assertion |
| `docker/tools/verify-artifacts.mjs` | **Neu** — scheitert beim Image-Build, wenn ein Build in-tree `bin`/`obj` erzeugt |
| `docker/workspace-mounts.mjs` | **Neu** — parst `/proc/self/mountinfo`, liefert die Mounts unterhalb `/workspace` |
| `docker/check-host-artifacts.mjs` | **Neu** — Preflight-Warnung über nicht maskierte Host-Artefakte |
| `docker/entrypoint.sh` | Root-Phase repariert Eigentümer genesteter Volumes; Dev-Phase ruft den Preflight |
| `docker/Dockerfile` | Kopiert die zwei neuen Runtime-Module nach `/usr/local/lib/agent-runtime/` |
| `docker/docker-compose.yml` | Kommentierter Beispielblock für maskierende Dependency-Volumes |
| `docker/README.md` | Neuer Abschnitt; Verweis von der bestehenden Integrationsnotiz |
| `docker/tests/workspace-mounts.test.mjs`, `docker/tests/host-artifacts.test.mjs` | **Neu** — Unit-Tests |
| `docker/tests/runtime-smoke.sh` | Fall: Schreiben in ein genestetes Volume als `dev` |

Die `files`-Allowlist in `package.json` ist **nicht** betroffen: `docker/` wird nicht über npm
publiziert.

## 1. .NET — Redirect per Umgebungsvariable

MSBuild übernimmt Umgebungsvariablen als globale Properties, also genügt eine Variable im Image
für jeden Build im Container — ohne Pfadliste und ohne eine Projektdatei anzufassen:

```dockerfile
ENV ArtifactsPath=/home/dev/artifacts \
    NUGET_PACKAGES=/home/dev/.nuget/packages
```

Beide Ziele liegen im `agent-home`-Volume, sind also pro Compose-Projekt getrennt und überleben
`run --rm`. `NUGET_PACKAGES` entspricht dem Linux-Default, wird aber explizit gesetzt, damit die
Zusage nicht von `$HOME`-Ableitung abhängt. Aus der Compose-Datei überschreibbar.

`ArtifactsPath` ist der richtige Knopf, weil es pro Projekt namespaced
(`<ArtifactsPath>/{bin,obj}/<Projekt>/<config>/`). `BaseOutputPath`/`BaseIntermediateOutputPath`
global zu setzen ließe alle Projekte einer Solution in dasselbe Verzeichnis schreiben.

**Gemessen** (SDK 10.0.401, Wegwerf-Konsolenprojekt): mit gesetzter Variable bleibt das
Projektverzeichnis nach einem Clean-Build vollständig unberührt — kein `bin/`, kein `obj/`;
`project.assets.json` liegt unter `<ArtifactsPath>/obj/<Projekt>/`. Der Container liest damit nie
das Windows-`project.assets.json` und schreibt nie in den Projektbaum: Isolation in beide
Richtungen.

### Regressionsschutz zur Build-Zeit

`tools/verify-artifacts.mjs` (Muster der bestehenden `verify-*.mjs`) erzeugt während des
Image-Builds ein minimales `.csproj` in einem temporären Verzeichnis, baut es und schlägt fehl,
falls danach in-tree `bin`/`obj` existiert oder die Ausgabe nicht unter `ArtifactsPath` liegt.
Aufruf in `Dockerfile.dotnet` neben `verify-versions.mjs dotnet`. Kosten ~2 s pro Build; es
schützt genau die gemessene Eigenschaft gegen eine SDK- oder Env-Änderung.

### Caveats (Doku)

- Ein projekteigenes `Directory.Build.props`, das `ArtifactsPath` oder `BaseOutputPath` selbst
  setzt, gewinnt gegen die Umgebungsvariable — Projektzuweisungen überschreiben aus der Umgebung
  abgeleitete Properties. Solche Projekte brauchen Regel (b) des Preflights bzw. maskierende
  Volumes.
- Skripte mit hartcodierten Pfaden wie `bin/Debug/net10.0/App.dll` brechen im Container.
- `ArtifactsPath` verlangt ein SDK-Projekt ab .NET 8; Nicht-SDK-Projekte sind nicht abgedeckt.

## 2. Node — maskierende Named Volumes

Ein Named Volume, das auf einen Pfad *unterhalb* des Bind-Mounts gemountet wird, verdeckt den
Host-Inhalt an dieser Stelle. Die Host-Installation bleibt darunter unberührt, der Windows- oder
macOS-Workflow des Menschen läuft unverändert weiter, und der Container hat seinen eigenen
Linux-Baum. Auf Docker Desktop ist das zusätzlich deutlich schneller, weil `node_modules` nicht
über den Bind läuft.

Die Vorlage `docker/docker-compose.yml` bekommt einen kommentierten Block, ein Eintrag pro
`node_modules`-Verzeichnis des Projekts:

```yaml
    volumes:
      # … bestehender Bind auf /workspace und agent-home …
      # Container-eigene Abhängigkeitsbäume. Jeder Eintrag verdeckt das
      # darunterliegende Host-Verzeichnis; die Host-Installation bleibt intakt.
      # Ein Eintrag pro node_modules des Projekts:
      # - type: volume
      #   source: deps-apps-web
      #   target: /workspace/apps/web/node_modules

volumes:
  agent-home:
  # deps-apps-web:
```

**Named**, nicht anonym: anonyme Volumes verschwinden mit `run --rm`, benannte überleben wie
`agent-home` und binden an den Compose-Projektnamen (`-p`).

Zwei Konsequenzen für die Doku:

- Das Volume ist beim ersten Start leer; der erste Container-Start braucht ein `npm ci` (bzw.
  das Äquivalent des Projekts) im Container.
- Fehlt der Mountpoint auf dem Host, legt Docker ihn als leeres Verzeichnis an — es erscheint
  also ggf. ein leeres `node_modules` auf dem Host. Harmlos und in der Regel gitignoriert.

## 3. Entrypoint — Eigentümer der genesteten Volumes

Ein frisches Volume unterhalb des Binds hat kein Vorbild im Image, aus dem Docker Inhalt und
Eigentümer kopieren könnte: das Verzeichnis entsteht als `root:root` und `dev` (`HOST_UID`)
könnte nicht hineinschreiben — `npm ci` scheitert mit `EACCES`.

Die bestehende Root-Phase in `entrypoint.sh` repariert das nach demselben Muster wie das
Home-Volume. Die Mountpoints werden **nicht** konfiguriert, sondern entdeckt:

```bash
while IFS= read -r -d '' mount; do
  owner="$(stat -c '%u:%g' "$mount")"
  if [[ "$owner" != "$HOST_UID:$HOST_GID" ]]; then
    find "$mount" -xdev \( ! -uid "$HOST_UID" -o ! -gid "$HOST_GID" \) \
      -exec chown -h "$HOST_UID:$HOST_GID" {} + ||
      printf 'agent runtime: warning: could not adjust ownership of %s\n' "$mount" >&2
  fi
done < <(node /usr/local/lib/agent-runtime/workspace-mounts.mjs)
```

Eigenschaften:

- Die Reparatur läuft nur, wenn die **Wurzel** des Mounts nicht `HOST_UID:HOST_GID` gehört — also
  beim ersten Start (leeres Verzeichnis, billig) und nach einem Wechsel der Host-IDs. Im
  Normalbetrieb entstehen keine Startkosten, auch nicht bei 100k Dateien.
- `-xdev` hält `find` innerhalb des Volumes. Das bind-gemountete Projekt wird nie angefasst; die
  README-Zusage „It does not recursively chown the project" bleibt wörtlich gültig.
- Schlägt der `chown` fehl (z.B. bewusst read-only gemountet), wird **gewarnt, nicht
  abgebrochen** — anders als beim Home-Volume, das zum Start zwingend beschreibbar sein muss.

`docker/workspace-mounts.mjs` hält das Parsing aus der Shell heraus und macht es testbar:

- Signatur `nestedMounts(mountinfoText, root = '/workspace')`
- Mountpoint ist Feld 5 von `/proc/self/mountinfo`; die oktalen Escapes `\040 \011 \012 \134`
  werden aufgelöst (Projektunterverzeichnisse dürfen Leerzeichen enthalten — das Repo unterstützt
  Pfade mit Leerzeichen ausdrücklich).
- Zurückgegeben werden nur Pfade **strikt unterhalb** von `root`, dedupliziert (ein Pfad kann
  mehrfach überlagert sein), in Mount-Reihenfolge. `root` selbst und alles außerhalb fällt weg.
- Im CLI-Modus NUL-separierte Ausgabe für die `read -d ''`-Schleife.

## 4. Preflight-Warnung (kein Abbruch)

`docker/check-host-artifacts.mjs` läuft in der Dev-Phase, nur lesend, und endet **immer** mit
Status 0. Platzierung: unmittelbar vor dem finalen `exec`, damit die Warnung das Letzte ist, was
der Mensch vor dem Agentenstart sieht — nach `configure-agents.sh` und den `startup.d`-Hooks.

Zwei Regeln:

**(a) Nicht maskiertes `node_modules` mit Host-Plattform-Spuren.** Ein `node_modules` gilt als
maskiert, wenn es selbst oder einer seiner Vorfahren in der Mount-Liste aus
`workspace-mounts.mjs` steht. Andernfalls wird auf Host-Marker geprüft: ein Eintrag in `.bin/`
mit Endung `.cmd` oder `.ps1`, oder ein Paketverzeichnis, dessen Name auf
`/(^|-)(win32|darwin|windows)(-|$)|msvc/i` passt (bei `@scope/`-Einträgen eine Ebene tiefer).
Die Meldung nennt den Pfad **und** den fehlenden Compose-Eintrag wörtlich, damit das Kopieren in
die eigene Compose-Datei trivial ist.

**(b) In-tree `bin`/`obj` ohne Redirect.** Wenn `ArtifactsPath` nicht gesetzt ist (Base- oder
Node-Image, oder aus der Compose-Datei überschrieben), im Workspace aber
`*.csproj`/`*.fsproj`/`*.sln`/`*.slnx` und dazu `bin/` oder `obj/` existieren, wird gewarnt, dass
Host- und Container-Builds sich gegenseitig überschreiben werden. Gemeldet wird ein `bin`/`obj`
nur dann, wenn **dasselbe Verzeichnis** auch die Projektdatei enthält — dort legt MSBuild die
Ausgabe ab; das `bin/` eines Node-CLIs im selben Repo bleibt damit unerwähnt.

Scan-Verhalten: Breitensuche ab `/workspace`, Tiefenlimit 5 Ebenen; `.git`, `.vs`, `bin`, `obj`
und das **Innere** von `node_modules` werden nicht betreten (ein gefundenes `node_modules` wird
gemeldet, aber nicht durchlaufen). Damit bleibt der Scan auch in großen Monorepos im
Millisekundenbereich.

Die Prüflogik ist als Funktion über `{ root, mounts, artifactsPath }` exportiert und damit ohne
Container testbar; der CLI-Modus schreibt die Warnungen nach stderr mit dem bestehenden
`agent runtime: `-Präfix.

## 5. Dokumentation

Neuer `docker/README.md`-Abschnitt „Host- und Container-Abhängigkeiten trennen", unterhalb der
Filesystem-Boundary-Sektion. Inhalt: das Problem in zwei Sätzen, der .NET-Redirect samt Caveats,
das Node-Rezept mit Compose-Snippet, `npm ci` beim Erstlauf, das leere Host-Verzeichnis, und die
ausdrückliche Feststellung, dass die kopierte Compose-Datei projekteigen ist und um Services,
Ports und Credentials erweitert werden darf — tragend sind nur `PROJECT_ROOT → /workspace` und
`agent-home`. Die bestehende Integrationsnotiz („separate Linux `node_modules` volumes") verweist
auf den neuen Abschnitt statt das Thema offen zu lassen.

## Tests

Unit-Tests liegen in `docker/tests/` und werden von `docker/verify-runtime.sh` per Glob
automatisch mitgenommen (`node --test docker/tests/*.test.mjs`).

| Test | Fälle |
|---|---|
| `tests/workspace-mounts.test.mjs` | Mount strikt unterhalb `/workspace` wird erkannt; `/workspace` selbst und `/home/dev` nicht; oktal-escapter Pfad mit Leerzeichen wird aufgelöst; doppelt überlagerter Pfad erscheint einmal; leerer/kaputter `mountinfo`-Text ergibt eine leere Liste |
| `tests/host-artifacts.test.mjs` | `node_modules` mit `@rollup/rollup-win32-x64-msvc` → Warnung, die den Pfad und den Compose-Eintrag nennt; dasselbe `node_modules` als Mount deklariert → still; `.bin/foo.cmd` → Warnung; reines Linux-`node_modules` → still; `.csproj` + `obj/` ohne `artifactsPath` → Warnung, mit `artifactsPath` → still; `node_modules`-Inneres und `.git` werden nicht betreten; Exit-Status immer 0 |
| `tools/verify-artifacts.mjs` (Build-Zeit) | Ein Build im .NET-Image hinterlässt kein in-tree `bin`/`obj` und schreibt unter `ArtifactsPath` |
| `tests/runtime-smoke.sh` | Zusätzlicher Fall: Start mit einem genesteten Named Volume unter `/workspace`; `dev` kann darin eine Datei anlegen (deckt die Eigentümer-Reparatur ab); das Host-Verzeichnis darunter bleibt unverändert |

## Risiken

- **Erstlauf-Überraschung:** ein leeres `node_modules`-Volume sieht wie ein kaputtes Projekt aus.
  Abgedeckt durch Doku und dadurch, dass Regel (a) nur bei *nicht* maskierten Bäumen warnt.
- **Heuristik-Fehlalarme** bei Regel (a): ein Projekt, das absichtlich Windows-Pakete
  mitinstalliert (`optionalDependencies` über Plattformen), würde gewarnt. Akzeptabel, weil die
  Warnung folgenlos ist und der Text auf „prüfen" statt „kaputt" lautet.
- **`ArtifactsPath` pro Home, nicht pro Solution:** zwei Solutions mit gleich benannten Projekten
  im selben Container teilten Unterverzeichnisse. Ein Container bedient ein Projekt; die Variable
  ist überschreibbar, falls es doch auftritt.
