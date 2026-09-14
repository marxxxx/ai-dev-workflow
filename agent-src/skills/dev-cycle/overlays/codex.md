## Codex Spawn Rules

Use `spawn_agent` with the matching `agent_type` and `fork_turns: "none"` for every developer,
reviewer, and QA attempt. Give each a unique `task_name`; for developers, encode the ticket,
implementation-review iteration, and continuation, with the initial continuation numbered `0`.
Supply the self-contained prompt packet as `message`.

Never resume a returned developer with `followup_task` or a larger context. After `failed`, apply the
main skill's artifact-derived, idempotent iteration reset and limit check before spawning a new
developer; never increment counters merely because Codex restarted.

After a valid handoff, increment only the continuation and spawn a fresh developer for the remaining
criteria. Apply the main skill's bounded recovery rule with the same counters; this overlay changes
only the Codex tool mechanics.
