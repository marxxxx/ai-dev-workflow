import { SessionError } from './sessions.mjs';

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] });
const fail = (message) => ({ isError: true, ...text(message) });

// The record also holds the task text and the worker pid; clients get neither.
const view = (record) => ({
  session_id: record.id,
  harness: record.harness,
  status: record.status,
  turn: record.turn,
  last_message: record.lastMessage ?? null,
  error: record.error ?? null,
  created_at: record.createdAt,
  updated_at: record.updatedAt,
});

function argsOf(raw) {
  if (raw === undefined) return {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new SessionError('arguments must be an object');
  return raw;
}

function stringArg(args, name, { required = false } = {}) {
  const value = args[name];
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || value === '') throw new SessionError(`${name} must be a non-empty string`);
  return value;
}

const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const SESSION_ID = { type: 'string', description: 'Id returned by start_session' };
const HARNESS = { type: 'string', enum: ['claude-code', 'codex', 'opencode'] };

export function buildTools(sessions, { log = (line) => console.error(line) } = {}) {
  const tool = (name, description, inputSchema, run) => ({
    name,
    description,
    inputSchema,
    async handler(raw) {
      try {
        return text(await run(argsOf(raw)));
      } catch (error) {
        if (error instanceof SessionError) return fail(error.message);
        // Only the error itself is logged: never the arguments, which may carry task text.
        log(`adw-mcp: ${name} failed: ${error?.name ?? 'Error'}${error?.code ? ` ${error.code}` : ''}: ${error?.message}`);
        return fail('internal error');
      }
    },
  });

  return [
    tool('start_session',
      'Start an agent-dev session for a task in the shared workspace. Returns at once with status running; poll query_session. Only one live session (running or idle) exists at a time.',
      schema({ harness: { ...HARNESS, description: 'Which agent CLI runs the session' }, task: { type: 'string', description: 'The task or ticket, at most 8000 characters' } }, ['harness', 'task']),
      (args) => view(sessions.start({ harness: stringArg(args, 'harness', { required: true }), task: stringArg(args, 'task', { required: true }) }))),
    tool('query_session',
      'Read a session: status (running, idle, failed, terminated), turn, and the last message of the agent once idle.',
      schema({ session_id: SESSION_ID, harness: { ...HARNESS, description: 'Optional cross-check' } }, ['session_id']),
      (args) => view(sessions.query({ sessionId: stringArg(args, 'session_id', { required: true }), harness: stringArg(args, 'harness') }))),
    tool('post_session',
      'Send the next message to an idle session (answer a question, give feedback). Starts a new turn and returns at once.',
      schema({ session_id: SESSION_ID, message: { type: 'string', description: 'The message for the agent' }, harness: { ...HARNESS, description: 'Optional cross-check' } }, ['session_id', 'message']),
      (args) => view(sessions.post({
        sessionId: stringArg(args, 'session_id', { required: true }),
        message: stringArg(args, 'message', { required: true }),
        harness: stringArg(args, 'harness'),
      }))),
    tool('list_sessions',
      'List sessions, oldest first, optionally only those in one status.',
      schema({ status: { type: 'string', enum: ['running', 'idle', 'failed', 'terminated'] } }),
      (args) => ({ sessions: sessions.list({ status: stringArg(args, 'status') }).map(view) })),
    tool('terminate_session',
      'Cancel the running turn, close the agent session and free the workspace for a new start_session.',
      schema({ session_id: SESSION_ID }, ['session_id']),
      async (args) => view(await sessions.terminate({ sessionId: stringArg(args, 'session_id', { required: true }) }))),
  ];
}
