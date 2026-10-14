# AGENTS.md

demo-todo: a .NET 10 Blazor Web App (interactive server render mode) with a minimal JSON API for
todos (in-memory store) and a list page.

## Commands

```bash
dotnet test                                                     # xUnit, from the repo root
dotnet run --project src/DemoTodo --urls http://localhost:3000  # list page at http://localhost:3000/
```

## Layout

- `src/DemoTodo/TodoStore.cs`: the in-memory store, a singleton shared by the API and the page.
- `src/DemoTodo/Program.cs`: the JSON API (`/todos`, `/health`).
- `src/DemoTodo/Components/Pages/Home.razor`: the todo list at `/`. It injects `TodoStore` and calls it
  directly over the Blazor circuit; it never calls the app's own HTTP API.
- `tests/DemoTodo.Tests/`: store tests, and API and page tests through `WebApplicationFactory<Program>`.

## Conventions

- No new NuGet packages.
- Validation errors are `System.ComponentModel.DataAnnotations.ValidationException`, thrown by
  `TodoStore`; `Program.cs` maps them to HTTP 400 `{"error": "..."}`.
- TDD: write a failing test in `tests/` first.
- Every UI element tests rely on carries a `data-testid` attribute; give new elements one too.

## End-to-end testing

- Services: none besides the app itself.
- Start: `dotnet run --project src/DemoTodo --urls http://localhost:3000 &` from the repo root (it
  builds first; allow up to a minute).
- Readiness: `GET http://localhost:3000/health` returns `{"ok":true}`.
- Base URL: `http://localhost:3000` — the todo list page is `/`; the JSON API is under `/todos`.
- Request bodies are JSON and need `Content-Type: application/json`.
- Locators: existing `data-testid`s are `todo-list`, `todo-item`, `todo-title`.
- The page is prerendered and becomes interactive once its Blazor circuit has connected, about a
  second after loading; wait for that before clicking.
- Drive the UI with the Playwright MCP tools; save screenshots outside the repository.
- Stop: kill the background `dotnet run` process.
