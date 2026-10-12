// In-memory todo store.
export function createStore() {
  const todos = new Map();
  let nextId = 1;
  return {
    list() {
      return [...todos.values()];
    },
    get(id) {
      return todos.get(id);
    },
    add({ title }) {
      if (typeof title !== 'string' || title.trim() === '') {
        throw new ValidationError('title is required');
      }
      const todo = { id: nextId++, title: title.trim(), done: false };
      todos.set(todo.id, todo);
      return todo;
    },
    update(id, patch) {
      const todo = todos.get(id);
      if (!todo) return undefined;
      if ('title' in patch) {
        if (typeof patch.title !== 'string' || patch.title.trim() === '') {
          throw new ValidationError('title must be a non-empty string');
        }
        todo.title = patch.title.trim();
      }
      if ('done' in patch) {
        if (typeof patch.done !== 'boolean') throw new ValidationError('done must be a boolean');
        todo.done = patch.done;
      }
      return todo;
    },
    remove(id) {
      return todos.delete(id);
    },
  };
}

export class ValidationError extends Error {}
