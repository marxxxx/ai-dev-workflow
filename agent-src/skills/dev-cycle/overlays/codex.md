## Codex Spawn Notes

For Codex subagents, omit `fork_context` or set it to false. Custom project agents must receive a self-contained `message`/`items` prompt. Do not request a full-history fork for subagents.

### Fresh Developer Context

- Every development attempt must start with `spawn_agent` using:
    - `agent_type: "developer"`
    - `fork_turns: "none"`
- a unique name such as `ticket_<id>_developer_i<iteration>`.
- Never use `followup_task` to resume a developer after it has returned.
- After review or QA moves a ticket to `failed`, increment the iteration and spawn a new developer.
- If a developer returns prematurely, spawn a fresh replacement; keep the same iteration number unless review or QA failed.
- The new developer receives only the self-contained prompt packet and reads ticket comments, branch diff, and durable artifacts.
