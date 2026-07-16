## Codex Spawn Notes

Every Codex subagent spawn must explicitly set:

```toml
fork_turns = "none"
task_name = "<role>-<ticket-number>-<iteration>"
```

Give each spawn a self-contained `message` containing the role-specific prompt packet described above.
Use a distinct `task_name` for every spawn; include the role, ticket number, and iteration so a
later follow-up can target the correct subagent.
