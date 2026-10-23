/** Record the real ClimateTwin site. No credentials are stored in this file. */
import { chromium } from 'playwright';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const base = process.env.CLIMATETWIN_BASE_URL ?? 'http://localhost:3000';
const password = process.env.CLIMATETWIN_DEMO_PASSWORD;
const config = await readFile(resolve('../backend/.env'), 'utf8');
const username = config.match(/^CLIMATETWIN_MANAGEMENT_USERNAME=(.*)$/m)?.[1];
if (!username || !password) throw new Error('Saved Management username or CLIMATETWIN_DEMO_PASSWORD is missing');
const rawDir = resolve('raw');
await mkdir(rawDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--disable-notifications', '--hide-scrollbars'] });
const contextOptions = { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
  permissions: [], reducedMotion: 'reduce' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function login(page) {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Object.keys(document.querySelector('.login-form') ?? {}).some(key => key.startsWith('__reactFiber$')));
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  try { await page.waitForURL('**/management', { timeout: 20000, waitUntil: 'domcontentloaded' }); }
  catch (error) { throw new Error('Management navigation failed after submitting the hydrated login form', { cause: error }); }
  await page.locator('.management-dashboard').waitFor();
}

// Reset and pause via the authenticated application API before the recorded login.
// This keeps the opening dashboard at simulated minute zero.
const prep = await browser.newContext(contextOptions);
const prepPage = await prep.newPage();
await login(prepPage);
const prepResult = await prepPage.evaluate(async () => {
  const session = await (await fetch('/api/auth/session')).json();
  const headers = { 'X-CSRF-Token': session.csrf_token };
  const reset = await fetch('/api/demo/reset', { method: 'POST', headers });
  const pause = await fetch('/api/demo/command', { method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'set_paused', paused: true }) });
  return { reset: reset.status, pause: pause.status };
});
if (prepResult.reset !== 200 || prepResult.pause !== 200) throw new Error('Could not prepare the real simulation');
await prep.close();

const context = await browser.newContext({ ...contextOptions, recordVideo: { dir: rawDir,
  size: { width: 1920, height: 1080 } } });
await context.addInitScript(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = 'nextjs-portal{display:none!important}.demo-film-cursor{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:24px;height:30px;transform:translate(-100px,-100px);filter:drop-shadow(0 2px 3px #0008)}';
    document.head.append(style);
    const cursor = document.createElement('div');
    cursor.className = 'demo-film-cursor';
    cursor.innerHTML = '<svg width="24" height="30" viewBox="0 0 24 30"><path d="M2 2v23l6-6 4 9 4-2-4-9h9z" fill="#fff" stroke="#1741a4" stroke-width="2"/></svg>';
    document.body.append(cursor);
    document.addEventListener('mousemove', event => { cursor.style.transform = `translate(${event.clientX}px,${event.clientY}px)`; });
  });
});
const page = await context.newPage();
const video = page.video();
const origin = performance.now();
const marks = [];
const stateChecks = [];
function mark(scene) { const at = (performance.now() - origin) / 1000; marks.push({ scene, at }); console.log(`Scene ${scene}: ${at.toFixed(2)}s`); }
async function moveTo(locator, steps = 20) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Target is not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
}
async function state() { return page.evaluate(async () => (await (await fetch('/api/demo/state')).json())); }
try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('.entry-options').waitFor();
  await page.evaluate(() => document.fonts.ready);
  mark(1);
  await sleep(2500);
  const entry = page.getByRole('link', { name: /Management Sign In/ });
  await moveTo(entry, 35);
  await sleep(3400);
  await entry.click();
  await page.locator('#username').waitFor();
  await page.waitForFunction(() => Object.keys(document.querySelector('.login-form') ?? {}).some(key => key.startsWith('__reactFiber$')));
  mark(2);
  await sleep(1400);
  await page.locator('#username').fill(username);
  await sleep(800);
  await page.locator('#password').fill(password);
  if (await page.locator('#password').getAttribute('type') !== 'password') throw new Error('Password would be visible');
  await sleep(2000);
  await moveTo(page.getByRole('button', { name: 'Sign In', exact: true }), 20);
  await sleep(500);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  try { await page.waitForURL('**/management', { timeout: 20000, waitUntil: 'domcontentloaded' }); }
  catch (error) { throw new Error('Recorded login did not reach Management', { cause: error }); }
  await page.locator('.management-dashboard').waitFor();
  await page.waitForFunction(() => !!document.querySelector('[data-zone="D2"] [data-horizon="10"]')?.getAttribute('data-depth'), null, { timeout: 20000 });
  mark(3);
  await sleep(2400);
  await moveTo(page.locator('.management-header-stat').first(), 24);
  await sleep(2100);
  await moveTo(page.locator('.management-map'), 26);
  await sleep(2200);
  await moveTo(page.locator('.management-forecasts'), 26);
  await sleep(2200);
  mark(4);
  await moveTo(page.locator('[data-map-zone="D2"]').first(), 28);
  await page.locator('[data-map-zone="D2"]').first().click();
  await sleep(3600);
  await moveTo(page.getByRole('button', { name: /Select H2,/ }), 22);
  await page.getByRole('button', { name: /Select H2,/ }).click();
  await sleep(3400);
  mark(5);
  for (const id of ['D1', 'D2', 'POND']) {
    await moveTo(page.locator(`[data-zone="${id}"] [data-horizon="10"]`), 26);
    await sleep(2500);
  }
  await sleep(1700);
  mark(6);
  const controls = page.locator('.management-simulation-controls');
  await moveTo(controls.locator('summary'), 24);
  await controls.locator('summary').click();
  await sleep(900);
  await controls.getByRole('button', { name: /Run Guided Flood Demo/ }).click();
  await controls.locator('.management-control-actions select').selectOption('4');
  await sleep(1200);
  const stormStart = performance.now();
  while (performance.now() - stormStart < 28000) {
    const snapshot = await state();
    if (snapshot.minute >= 51 && snapshot.roads.some(road => road.status === 'CLOSED')) {
      stateChecks.push({ minute: snapshot.minute, rainfall: snapshot.rainfall_mm_h,
        closed: snapshot.roads.filter(road => road.status === 'CLOSED').length,
        d2: snapshot.zones.find(zone => zone.id === 'D2')?.depth_cm });
      break;
    }
    await sleep(650);
  }
  if (!stateChecks.length) throw new Error('Guided storm did not produce a real road closure');
  await controls.getByRole('button', { name: 'Pause simulation' }).click();
  await sleep(1900);
  await controls.locator('summary').click();
  await moveTo(page.locator('.management-pumps button:has-text("Compare")'), 25);
  await page.locator('.management-pumps button:has-text("Compare")').click();
  await page.locator('.management-detail-dialog[open]').waitFor();
  await sleep(3000);
  await page.locator('.management-detail-dialog button[aria-label="Close details"]').click();
  const pump = page.getByRole('switch', { name: 'Switch virtual P2 on' });
  if (await pump.isDisabled()) throw new Error('P2 is unavailable at the captured level');
  await moveTo(pump, 18);
  await pump.click();
  await page.getByRole('switch', { name: 'Switch virtual P2 off' }).waitFor();
  await sleep(1200);
  await controls.locator('summary').click();
  await controls.getByRole('button', { name: 'Resume simulation' }).click();
  await sleep(3900);
  await controls.getByRole('button', { name: 'Pause simulation' }).click();
  await controls.locator('summary').click();
  mark(7);
  const finalState = await state();
  stateChecks.push({ minute: finalState.minute, rainfall: finalState.rainfall_mm_h,
    closed: finalState.roads.filter(road => road.status === 'CLOSED').length,
    d2: finalState.zones.find(zone => zone.id === 'D2')?.depth_cm,
    p2: finalState.pumps.find(pump => pump.id === 'P2')?.on });
  await moveTo(page.locator('.management-brand'), 30);
  await sleep(7000);
  mark('end');
} finally {
  await context.close();
  await browser.close();
  if (video) await copyFile(await video.path(), resolve(rawDir, 'management_raw.webm'));
  await writeFile(resolve(rawDir, 'marks.json'), JSON.stringify({ marks, stateChecks }, null, 2));
  console.log(JSON.stringify({ marks, stateChecks }));
}
