## Comments

These rules apply to all code written in this run, including code a subagent writes.

- Comment the why, not the what: intent, constraints and trade-offs the code cannot show. Never
  restate what the code already says.
- No commented-out code: delete it, git has the history.
- No TODO for something you could do now: do it.
- Document a non-obvious gotcha where it bites (an ordering requirement, a known limitation).
- The project's own comment rules in `AGENTS.md` apply in addition; where they conflict,
  `AGENTS.md` wins.
