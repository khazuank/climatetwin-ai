import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve('tmp');
await mkdir(output, { recursive: true });
const config = await readFile(resolve('../backend/.env'), 'utf8');
const username = config.match(/^CLIMATETWIN_MANAGEMENT_USERNAME=(.*)$/m)?.[1];
const password = process.env.CLIMATETWIN_DEMO_PASSWORD;
if (!username || !password) throw new Error('Local username or CLIMATETWIN_DEMO_PASSWORD is missing');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-notifications'] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, permissions: [] });
const page = await context.newPage();
try {
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: resolve(output, 'welcome.png') });
  await page.getByRole('link', { name: /Management Sign In/ }).click();
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.screenshot({ path: resolve(output, 'login.png') });
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForURL('**/management', { timeout: 15000 });
  await page.locator('[data-zone="D2"] [data-horizon="10"]').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-zone="D2"] [data-horizon="10"]')?.getAttribute('data-depth'));
  await page.screenshot({ path: resolve(output, 'management.png') });
  const overview = await page.evaluate(() => ({
    title: document.title,
    controls: !!document.querySelector('.management-simulation-controls'),
    cards: document.querySelectorAll('.management-zone-card').length,
    forecast: document.querySelector('[data-zone="D2"] [data-horizon="10"]')?.getAttribute('data-depth'),
    mapTargets: document.querySelectorAll('.demo-map-target').length,
    bodyHeight: document.body.scrollHeight,
  }));
  console.log(JSON.stringify(overview));
} finally {
  await browser.close();
}
