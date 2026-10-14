# demo-todo acceptance criteria

The E2E verifier checks these against the running app of every trial's PR head (`e2e/lib/postverify.mjs`).
The coding agent never sees this file.

Rules for changing it:
- A criterion describes observable behaviour. Name no endpoint paths, query parameters or field names.
  Use exact wording only for text a user sees.
- A criterion may only cover what the briefing (`instruction.md`) actively communicates, or what follows
  unambiguously from the ticket.
- Any change alters the verifier hash: recalibrate (`node e2e/run.mjs calibrate`).

| Id | Criterion |
|---|---|
| AC1 | A todo can optionally get a due date when it is created. The date is a calendar date without a time. |
| AC2 | The due date can be changed later and removed again. |
| AC3 | An invalid date (wrong format, an impossible date such as 30 February) is rejected with HTTP 400. |
| AC4 | The API can return only overdue todos. A todo is overdue when it is not done and its due date is before today (UTC). Todos without a due date, and done todos, are never overdue. |
| AC5 | The list page shows each todo's due date. |
| AC6 | Overdue todos in the list are marked with the word "überfällig"; other todos are not. |
| AC7 | A control labelled "nur überfällige" filters the list to overdue todos. |
