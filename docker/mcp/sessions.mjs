import { openingText } from './harness.mjs';

export const HARNESSES = ['claude-code', 'codex', 'opencode'];
const STATUSES = ['running', 'idle', 'failed', 'terminated'];
const LIVE = ['running', 'idle'];
const MAX_TASK = 8000;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MARKER = '\n[truncated]';

export class SessionError extends Error {}

function capMessage(message) {
  const buffer = Buffer.from(message ?? '', 'utf8');
  if (buffer.length <= MAX_MESSAGE_BYTES) return buffer.toString('utf8');
  let cut = MAX_MESSAGE_BYTES;
  while (cut > 0 && (buffer[cut] & 0xc0) === 0x80) cut -= 1;
  return buffer.subarray(0, cut).toString('utf8') + MARKER;
}

export function applyTurnResult(store, id, result, now) {
  const current = store.get(id);
  if (!current) throw new SessionError(`unknown session ${id}`);
  // Only a running turn takes a result; a late one must not revive failed, idle or terminated sessions.
  if (current.status !== 'running') return current;
  const patch = result.ok
    ? { status: 'idle', lastMessage: capMessage(result.message), error: null }
    : { status: 'failed', error: result.error ?? 'turn failed' };
  return store.update(id, { ...patch, pid: null, updatedAt: now() });
}

export function createSessions({ store, startTurn, cancel, isAlive, now, newId }) {
  function find(sessionId, harness) {
    let record;
    try {
      record = store.get(sessionId);
    } catch {
      record = null;
    }
    if (!record) throw new SessionError(`unknown session ${sessionId}`);
    if (harness !== undefined && harness !== record.harness) {
      throw new SessionError(`session ${sessionId} runs ${record.harness}, not ${harness}`);
    }
    return record;
  }

  function begin(record, text, patch) {
    const running = store.update(record.id, { ...patch, status: 'running', error: null, updatedAt: now() });
    try {
      return store.update(record.id, { pid: startTurn(running, text) });
    } catch (error) {
      store.update(record.id, { status: 'failed', error: `could not start the turn: ${error.message}`, pid: null, updatedAt: now() });
      throw new SessionError(`could not start the turn: ${error.message}`);
    }
  }

  return {
    start({ harness, task }) {
      if (!HARNESSES.includes(harness)) throw new SessionError(`harness must be one of ${HARNESSES.join(', ')}`);
      if (typeof task !== 'string' || task.trim() === '') throw new SessionError('task must not be empty');
      if (task.length > MAX_TASK) throw new SessionError(`task must be at most ${MAX_TASK} characters`);
      // No await between this check and create: two same-tick calls cannot both pass.
      const live = store.list().find((record) => LIVE.includes(record.status));
      if (live) {
        throw new SessionError(`session ${live.id} is ${live.status} and holds the workspace; terminate it first`);
      }
      const stamp = now();
      const record = store.create({
        id: newId(), harness, task, status: 'running', turn: 1, lastMessage: null, error: null,
        createdAt: stamp, updatedAt: stamp, pid: null,
      });
      return begin(record, openingText(harness, task), {});
    },

    query: ({ sessionId, harness }) => find(sessionId, harness),

    post({ sessionId, message, harness }) {
      const record = find(sessionId, harness);
      if (typeof message !== 'string' || message.trim() === '') throw new SessionError('message must not be empty');
      if (record.status !== 'idle') {
        throw new SessionError(`session ${sessionId} is ${record.status}; post works only on an idle session`);
      }
      return begin(record, message, { turn: record.turn + 1 });
    },

    list({ status } = {}) {
      if (status !== undefined && !STATUSES.includes(status)) {
        throw new SessionError(`status must be one of ${STATUSES.join(', ')}`);
      }
      return store.list()
        .filter((record) => status === undefined || record.status === status)
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    },

    async terminate({ sessionId }) {
      let record = find(sessionId);
      if (!LIVE.includes(record.status)) return record;
      await cancel(record);
      // A post (or a finishing worker) can change the turn or the worker while cancel is awaited. Terminating on the
      // stale record would orphan a worker started meanwhile, so cancel what is there now until nothing changes.
      for (let latest = find(sessionId); latest.turn !== record.turn || latest.pid !== record.pid; latest = find(sessionId)) {
        record = latest;
        await cancel(record);
      }
      return store.update(record.id, { status: 'terminated', pid: null, updatedAt: now() });
    },

    reconcile() {
      for (const record of store.list()) {
        if (record.status === 'running' && !(record.pid != null && isAlive(record.pid))) {
          store.update(record.id, { status: 'failed', error: 'worker lost', pid: null, updatedAt: now() });
        }
      }
    },
  };
}
