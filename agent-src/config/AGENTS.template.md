# AGENTS.md

Project-specific context the AI workflow agents (dev-cycle, developer, code-reviewer,
qa-engineer) read before touching code. This is a **starter** scaffolded by
`ai-dev-workflow init` — fill it in for your project. It is hand-owned and never regenerated.

## Tech stack

<!-- TODO: languages, frameworks, package managers, runtime versions. -->

## Ports & URLs

<!-- TODO: the port(s) the app listens on locally, and the base URL to drive in a browser. -->

## Commands

- **Install:** <!-- TODO: e.g. `npm ci`, `dotnet restore` -->
- **Build:** <!-- TODO: e.g. `npm run build`, `dotnet build` -->
- **Run (dev):** <!-- TODO: e.g. `npm run dev`, `dotnet run --project <web>` -->
- **Test:** <!-- TODO: e.g. `npm test`, `dotnet test` -->

## Conventions

<!-- TODO: code style, directory layout, naming, anything a contributor must follow. -->

## Test-locator attribute

<!-- TODO: the attribute the qa-engineer uses to select elements in end-to-end tests
     (e.g. `data-testid`, or an existing convention already in the codebase). Being explicit
     here makes Playwright-based e2e tests reliable. -->

## End-to-end testing

The `qa-engineer` starts the app via the project-owned contract in `scripts/e2e-up` /
`scripts/e2e-down`. `e2e-up` must start services + the app, block until reachable, print a
`BASE_URL=<url>` line, and exit 0; `e2e-down` idempotently tears it down. See
`docs/ai-workflow-setup.md` and fill in those two scripts.
