import { readFile } from 'node:fs/promises';
import { createStore, ValidationError } from './store.mjs';

// Returns a request handler for node:http.
export function createApp(store = createStore()) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    try {
      if (url.pathname === '/' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(await readFile(new URL('../public/index.html', import.meta.url)));
      }
      if (url.pathname === '/health') return send(200, { ok: true });
      if (url.pathname === '/todos' && req.method === 'GET') return send(200, store.list());
      if (url.pathname === '/todos' && req.method === 'POST') {
        return send(201, store.add(await readJson(req)));
      }
      const match = url.pathname.match(/^\/todos\/(\d+)$/);
      if (match) {
        const id = Number(match[1]);
        if (req.method === 'GET') {
          const todo = store.get(id);
          return todo ? send(200, todo) : send(404, { error: 'not found' });
        }
        if (req.method === 'PATCH') {
          const todo = store.update(id, await readJson(req));
          return todo ? send(200, todo) : send(404, { error: 'not found' });
        }
        if (req.method === 'DELETE') {
          return store.remove(id) ? send(204) : send(404, { error: 'not found' });
        }
      }
      send(404, { error: 'not found' });
    } catch (err) {
      if (err instanceof ValidationError || err instanceof SyntaxError) {
        return send(400, { error: err.message });
      }
      send(500, { error: 'internal error' });
    }
  };
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}
