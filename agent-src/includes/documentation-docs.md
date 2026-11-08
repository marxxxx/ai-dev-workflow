
## Documentation

Keep the project's technical documentation current as part of the change: it goes on the same
branch and into the same pull request as the code. Business documentation is out of scope.

**Where.** Match the existing convention first. If the project already has architecture docs or
ADRs (a `docs/adr/` folder, an `.adr-dir` file, arc42, a numbering scheme, its own headings),
continue them and never introduce a second scheme; if the evidence conflicts, say so instead of
picking one. Only without a convention use:

```
docs/architecture/
  architecture.md        entry point, current state only
  <topic>.md             only when a section outgrows architecture.md; linked from it
  decisions/
    0001-<title>.md      ADRs
```

**Architecture** (`docs/architecture/architecture.md` by default). Create it when it is missing;
afterwards update the sections the change touches. Default sections, only those that say something
for this project: Overview (what the system does, context, neighbouring systems) · Building blocks
(modules or components, responsibilities, dependencies) · Key flows · Data (model, storage) ·
Interfaces (APIs, external integrations) · Operations (build, deploy, configuration) ·
Cross-cutting (auth, error handling, logging, conventions) · Decisions (links to the ADRs in force).
Diagrams as Mermaid. It describes the current state only: rewrite what changed, delete what is no
longer true, link ADRs for the why. No history.

**ADRs** (`docs/architecture/decisions/` by default). Only for a fundamental technical decision whose
reasoning stays relevant: a framework, database or major dependency, a data model, an auth
strategy, an API style, anything expensive to reverse. Routine implementation choices get none. The
agreed spec is the usual source; status `Accepted`. Never delete an ADR: supersede it with a new one
that references it.

**README and changelog.** Update them when the change is visible to users or developers (how to
run, configure or use it); follow the existing changelog format, if there is one.

For the ADR template, the README and changelog structure and a verification checklist, read
`.agents/skills/documentation-and-adrs/SKILL.md`. If it is missing, say once that adw's `upgrade`
command installs it, then continue with this file alone.
