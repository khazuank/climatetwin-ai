/** Film real mobile UI and public polling; Management stays in a separate unrecorded context. */
import { setup, mobile, clean, base, raw, sleep, scrollToElement, residentState } from './resident-common.mjs';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
const { browser, control, command } = await setup();
const context = await browser.newContext({ ...mobile, recordVideo: { dir: raw, size: mobile.viewport } });
await clean(context);
const page = await context.newPage();
const video = page.video();
const origin = performance.now();
const marks = [], evidence = [], errors = [], polls = [];
const at = () => (performance.now() - origin) / 1000;
function mark(scene) { marks.push({ scene, at: at() }); console.log(`Scene ${scene}: ${at().toFixed(2)}s`); }
page.on('pageerror', e => errors.push(e.message));
page.on('response', async response => {
  if (response.url().includes('/api/resident/state')) {
    if (!response.ok()) errors.push(`Public polling HTTP ${response.status()}`);
    else {
      const s = await response.json().catch(() => null);
      if (s) polls.push({ at: at(), minute: s.minute, run_id: s.run_id, roads: s.route.road_ids,
        distance_m: s.route.distance_m, minutes: s.route.travel_minutes,
        closed: s.roads.filter(r => r.status === 'CLOSED').length, forecast: s.forecast.status });
    }
  }
});
async function capture(label) {
  const s = await residentState(page);
  evidence.push({ label, at: at(), minute: s.minute, run_id: s.run_id, route: s.route,
    closed: s.roads.filter(r => r.status === 'CLOSED').length,
    status: await page.locator('.resident-status h2').innerText(), forecast: s.forecast,
    journey: await page.locator('.resident-navigation-summary').innerText() });
  await page.screenshot({ path: resolve(raw, `${label}.png`) });
}
try {
  // Prewarm public pages, without authenticating or storing cookies in the Resident context.
  await page.goto(`${base}/resident`, { waitUntil: 'networkidle' });
  await page.locator('.resident-water-card').first().waitFor();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  mark(1);
  await sleep(1100);
  await scrollToElement(page, '.entry-card:last-child', 40, 1200);
  await sleep(1700);
  await page.getByRole('link', { name: /Continue as Resident/ }).tap();
  await page.locator('.resident-status').waitFor();
  await page.waitForFunction(() => document.querySelector('.resident-navigation-summary')?.getAttribute('aria-busy') === 'false');
  await sleep(600);
  mark(2);
  await capture('02-normal');
  await sleep(6200);
  mark(3);
  // Choose the illustrated central home through the existing public selector.
  await page.locator('#resident-home-select').selectOption('H4');
  await sleep(700);
  await page.locator('#resident-home-select').selectOption('H2');
  await page.waitForFunction(() => document.querySelector('.resident-navigation-summary')?.getAttribute('aria-busy') === 'false');
  await scrollToElement(page, '.resident-home', 10, 900);
  await sleep(1700);
  const map = page.locator('.resident-map .demo-map-svg');
  const rect = await map.boundingBox();
  const cdp = await context.newCDPSession(page);
  const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
  const before = await map.getAttribute('viewBox');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 1 }] });
  for (let n = 1; n <= 16; n++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + 24 * n / 16, y: cy, id: 1 }] });
    await sleep(35);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  if (await map.getAttribute('viewBox') === before) throw new Error('Map gesture did not pan');
  await sleep(900);
  await page.locator('.resident-map-recenter').tap();
  await sleep(1000);
  await capture('03-route');
  await sleep(2300);
  mark(4);
  await scrollToElement(page, '.resident-status', 10, 850);
  await command({ action: 'run_demo' });
  await command({ action: 'set_speed', speed: 4 });
  const stormStart = performance.now();
  let didScroll = false, closed = false;
  while (performance.now() - stormStart < 25000) {
    // Observe state from the hidden authorized session; Resident keeps its own normal two-second polling.
    const s = await control.evaluate(async () => (await (await fetch('/api/demo/state')).json()));
    if (s.minute >= 18 && !didScroll) {
      await capture('04-caution');
      await scrollToElement(page, '.resident-home', 10, 900);
      didScroll = true;
    }
    if (s.minute >= 51 && s.roads.some(r => r.status === 'CLOSED')) { closed = true; break; }
    await sleep(500);
  }
  if (!closed) throw new Error('The live storm did not close roads');
  await command({ action: 'set_paused', paused: true });
  await sleep(2300);
  await capture('04-closed-route');
  await sleep(2000);
  // Show the actual red warning too, then settle back on the longer blue route.
  await scrollToElement(page, '.resident-status', 10, 650);
  await sleep(1900);
  await capture('04-danger');
  await scrollToElement(page, '.resident-home', 10, 700);
  await sleep(1700);
  mark(5);
  await scrollToElement(page, '.resident-water', 10, 1200);
  await page.waitForFunction(() => [...document.querySelectorAll('.resident-water-card .resident-level strong')].every(e => e.textContent.includes('%')));
  await capture('05-forecasts');
  await sleep(6700);
  mark(6);
  await scrollToElement(page, '.resident-home', 10, 1000);
  await sleep(4000);
  await capture('06-closing');
  mark('end');
  const cookies = await context.cookies();
  if (cookies.some(c => /session|auth/i.test(c.name))) throw new Error('Resident context unexpectedly contains an authentication cookie');
  if (errors.length) throw new Error(errors.join('; '));
  if (!evidence.find(e => e.label === '04-closed-route')?.closed) throw new Error('Missing recorded closure evidence');
  await context.close();
  await video.saveAs(resolve(raw, 'resident_raw.webm'));
  await writeFile(resolve(raw, 'marks.json'), JSON.stringify({ viewport: mobile.viewport, marks, evidence, polls, errors, residentAuthenticated: false }, null, 2));
  console.log('Saved public Resident recording and real shared-state evidence.');
} finally { await browser.close(); }
