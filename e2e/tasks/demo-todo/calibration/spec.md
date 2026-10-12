## Approved Spec

Due dates for todos (ticket #1).

- A todo has an optional due date: a calendar date without a time. It can be set when the todo is
  created, and changed or removed later.
- An invalid date (wrong format, or an impossible date such as 30 February) is rejected with HTTP 400.
- The API can return only overdue todos: todos that are not done and whose due date is before today
  (UTC). Todos without a due date are never overdue.
- The list page shows each todo's due date next to its title, marks overdue todos with the word
  "überfällig", and has a control labelled "nur überfällige" that shows only overdue todos.
- Out of scope: sorting, reminders, styling.
