## How to talk to the coding agent

A coding agent is connected to this workspace. You talk to it only by running:

    acpx prompt "<your message>"

- Your first action must send the opening message with that command. Send exactly one message per
  command; it blocks until the agent finishes its turn (long waits are normal — use a long timeout).
- Never edit, create or delete files, never change `.acpxrc.json`, never start other agents or
  sessions (`acpx <name> ...`, `sessions new`), never run `claude`/`codex`/`opencode` yourself, and
  never kill processes. You may only read files to review the agent's work.
- If `acpx prompt` fails, retry the same command once after 30 seconds. If it fails again, stop and
  end your session with the message `BRIDGE FAILURE: <error>`.
- The work is finished only when the agent reports an opened pull request and the ticket handed to
  review. If it ends a turn with a status update or a promise to report back while work remains,
  briefly tell it to go ahead.
- Once the work is finished and you are satisfied, stop sending messages and end your session.
