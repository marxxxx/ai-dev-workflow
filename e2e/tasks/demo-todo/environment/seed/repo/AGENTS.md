# AGENTS.md

demo-todo: a zero-dependency Node 24 JSON API for todos (in-memory store) with a minimal list page.

## Commands

```bash
npm test     # node --test
npm start    # serves the list page at http://localhost:3000/ (PORT overrides)
```

## Conventions

- Zero dependencies — Node builtins only.
- Validation errors are `ValidationError` from `src/store.mjs` and map to HTTP 400.
- TDD: write a failing test in `test/` first.

## End-to-end testing

- Services: none besides the app itself.
- Start: `PORT=3000 npm start &` from the repo root.
- Readiness: `GET http://localhost:3000/health` returns `{"ok":true}`.
- Base URL: `http://localhost:3000` — the todo list page is `/`; the JSON API is under `/todos`.
- Locators: every UI element tests rely on carries a `data-testid` attribute (existing:
  `todo-list`, `todo-item`, `todo-title`); give new elements one too.
- Drive the UI with the Playwright MCP tools; save screenshots outside the repository.
- Stop: kill the background `npm start` process.
