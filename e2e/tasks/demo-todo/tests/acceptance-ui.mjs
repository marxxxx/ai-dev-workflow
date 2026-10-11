// Hidden UI acceptance test. It uses only visible text and roles, never agent-chosen markup.
// Run: node acceptance-ui.mjs <baseUrl>. Prints TAP-like lines; exit code 0 means all passed.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/agent-tools/package.json')('playwright');

const base = process.argv[2];
const day = (o) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10);
const post = (b) => fetch(`${base}/todos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
await post({ title: 'Rechnung zahlen', dueDate: day(-2) });
await post({ title: 'Urlaub planen', dueDate: day(10) });
await post({ title: 'Ohne Datum' });

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(`ok - ${name}`); } catch (e) { results.push(`not ok - ${name}: ${e.message.split('\n')[0]}`); }
};
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(base);
  const item = (title) => page.getByRole('listitem').filter({ hasText: title });
  await check('due dates are shown', async () => {
    await item('Rechnung zahlen').getByText(day(-2)).waitFor({ timeout: 5000 });
    await item('Urlaub planen').getByText(day(10)).waitFor({ timeout: 5000 });
  });
  await check('overdue todo is marked "überfällig", others are not', async () => {
    await item('Rechnung zahlen').getByText(/überfällig/i).waitFor({ timeout: 5000 });
    if (await item('Urlaub planen').getByText(/überfällig/i).count()) throw new Error('future todo marked overdue');
  });
  await check('"nur überfällige" toggle filters the list', async () => {
    const toggle = page.getByLabel(/nur überfällige/i).or(page.getByRole('button', { name: /nur überfällige/i })).first();
    await toggle.click();
    await page.waitForTimeout(500);
    if (!(await item('Rechnung zahlen').count())) throw new Error('overdue todo hidden');
    if (await item('Urlaub planen').count()) throw new Error('future todo still shown');
  });
} finally {
  await browser.close();
}
console.log(results.join('\n'));
process.exit(results.every((r) => r.startsWith('ok')) ? 0 : 1);
