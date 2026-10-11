import { createServer } from 'node:http';
import { createApp } from './app.mjs';

const port = Number(process.env.PORT ?? 3000);
createServer(createApp()).listen(port, () => console.log(`demo-todo listening on :${port}`));
