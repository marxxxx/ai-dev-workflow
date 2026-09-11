// Proves that the .NET image trusts the ASP.NET Core development certificate for
// https://localhost, in OpenSSL (curl) and in Playwright's Chromium, without ignoring
// HTTPS errors. Run after trust-dev-cert.sh as the runtime user.
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:https';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const require = createRequire('/opt/agent-tools/package.json');
const { chromium } = require('playwright');
const TITLE = 'agent-runtime-dev-cert-ok';

const directory = mkdtempSync(path.join(tmpdir(), 'dev-cert-'));
try {
  const certificate = path.join(directory, 'localhost.pem');
  execFileSync('dotnet', ['dev-certs', 'https', '--export-path', certificate, '--format', 'Pem', '--no-password'],
    { cwd: homedir(), stdio: 'ignore' });
  const server = createServer({ cert: readFileSync(certificate), key: readFileSync(path.join(directory, 'localhost.key')) },
    (request, response) => response.end(`<title>${TITLE}</title>`));
  await new Promise(resolve => server.listen(0, resolve));
  const url = `https://localhost:${server.address().port}/`;
  try {
    // Asynchronous, so this process keeps serving the request.
    const { stdout } = await promisify(execFile)('curl', ['--fail', '--silent', '--show-error', url]);
    if (!stdout.includes(TITLE)) throw new Error('curl returned an unexpected page');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(url);
      if (await page.title() !== TITLE) throw new Error('Chromium returned an unexpected page title');
    } finally {
      await browser.close();
    }
  } finally {
    server.close();
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log('ASP.NET Core development certificate trusted for https://localhost (curl, Chromium): ok');
