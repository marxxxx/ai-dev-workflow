import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE = 'session.json';

function checkId(id) {
  if (typeof id !== 'string' || !UUID.test(id)) throw new Error('invalid session id');
  return id;
}

export function createStore(dir) {
  const dirOf = (id) => join(dir, checkId(id));

  function read(id) {
    try {
      return JSON.parse(readFileSync(join(dirOf(id), FILE), 'utf8'));
    } catch (error) {
      if (error.message === 'invalid session id') throw error;
      return null;
    }
  }

  function write(record) {
    const target = dirOf(record.id);
    mkdirSync(target, { recursive: true });
    const temp = join(target, `.${FILE}.${randomBytes(6).toString('hex')}.tmp`);
    writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`);
    renameSync(temp, join(target, FILE));
    return record;
  }

  return {
    dirOf,
    get: read,
    create: (record) => write(record),
    update(id, patch) {
      const current = read(id);
      if (!current) throw new Error(`unknown session ${id}`);
      return write({ ...current, ...patch });
    },
    list() {
      let names;
      try {
        names = readdirSync(dir);
      } catch {
        return [];
      }
      return names
        .filter((name) => UUID.test(name))
        .map((name) => read(name))
        .filter((record) => record && typeof record === 'object' && record.id);
    },
  };
}
