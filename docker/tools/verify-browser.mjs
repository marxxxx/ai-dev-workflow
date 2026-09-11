import { createRequire } from 'node:module';

const require = createRequire('/opt/agent-tools/package.json');
const { chromium } = require('playwright');

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto('data:text/html,<title>agent-runtime-browser-ok</title>');
  if (await page.title() !== 'agent-runtime-browser-ok') {
    throw new Error('Chromium returned an unexpected page title');
  }
} finally {
  await browser.close();
}

console.log('Chromium launch: ok');
