## Codex Spawn Notes

For Codex subagents, omit `fork_context` or set it to false. Custom project agents must receive a self-contained `message`/`items` prompt. Do not request a full-history fork for subagents.

### Fresh Developer Context

- Every development attempt must start with `spawn_agent` using:
    - `agent_type: "developer"`
    - `fork_turns: "none"`
- a unique name such as `ticket_<id>_developer_i<iteration>_c<continuation>`, where `<continuation>` is `0` for the first attempt of an iteration.
- Never use `followup_task` to resume a developer after it has returned.
- After review or QA moves a ticket to `failed`, increment the iteration, reset the continuation to `0`, and spawn a new developer.
- The new developer receives only the self-contained prompt packet and reads ticket comments, branch diff, and durable artifacts.

### Continuations After A Handoff

Codex sessions are where oversized tickets bite hardest — a developer that pushes past its context window degrades rather than stopping, and its replacement re-explores from nothing. The handoff protocol in `{{handoff.include}}` is what prevents that; these are its Codex mechanics.

- A developer that posted `{{artifact.handoff}}` is finished. Do not `followup_task` it and do not raise its context limit — `spawn_agent` a fresh one with `fork_turns: "none"`, incrementing the continuation and keeping the same iteration number.
- The continuation's packet carries the journal path, the remaining criteria, and the continuation number. It reads the latest `{{artifact.handoff}}` comment before exploring; that map is what keeps the fresh window from being spent on rediscovery.
- If a developer returns prematurely **without** a `{{artifact.handoff}}` comment, spawn a fresh replacement at the same iteration and continuation number, and tell it in the packet that no handoff exists so it recovers from the branch diff and ticket comments instead.
