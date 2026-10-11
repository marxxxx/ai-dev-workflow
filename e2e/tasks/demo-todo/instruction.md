Get ticket #1 of the demo-todo repository implemented by the coding agent, using its `agent-dev`
workflow. Your opening message must be exactly:

    Nutze den agent-dev Skill für Ticket 1.

(If the agent says it does not know that skill, send `/agent-dev 1` for Claude-style agents or
`$agent-dev 1` otherwise.)

What you actually want (the ticket only says "Todos sollen ein Fälligkeitsdatum bekommen") — reveal
it only when the agent asks, in your own words, one topic at a time:

- A todo gets an optional field `dueDate`, a calendar date in the form `YYYY-MM-DD` (no time).
- It can be set when creating (`POST /todos`) and changed or cleared (`null`) via `PATCH /todos/:id`.
- An invalid date (wrong format or impossible date like `2026-02-30`) is rejected with HTTP 400.
- `GET /todos?overdue=true` returns only todos that are not done and whose `dueDate` is before
  today (UTC). Todos without `dueDate` are never overdue.
- The list page shows each todo's due date next to its title.
- Overdue todos are visibly marked with the word "überfällig".
- The list page has a toggle labelled "nur überfällige" that shows only overdue todos (using the
  filter).
- Nothing else: no sorting, no reminders, no styling work.

Process answers:
- When asked whether the agent should test end to end or you test manually: the agent should test
  end to end.
- When asked to approve a design or written spec: read it; approve it if it matches the bullets
  above, otherwise name the deviation and ask for a correction.
- Approve the implementation plan and any isolation/worktree choice with the agent's recommended
  option.
- If the agent asks about creating a ticket: no — ticket 1 already exists.

You are done when the agent reports that it opened a draft pull request, or when it is clearly
stuck after you tried to unblock it twice. Then end your session.
