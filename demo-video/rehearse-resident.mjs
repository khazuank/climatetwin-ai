import { setup, mobile, clean, base, root, raw, sleep, scrollToElement, residentState } from './resident-common.mjs';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
const { browser, command } = await setup();
try {
  const context = await browser.newContext(mobile);
  await clean(context);
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.screenshot({ path: resolve(raw, 'welcome.png') });
  await scrollToElement(page, '.entry-card:last-child', 80);
  await page.screenshot({ path: resolve(raw, 'welcome-resident.png') });
  await page.getByRole('link', { name: /Continue as Resident/ }).click();
  await page.locator('.resident-status').waitFor();
  await page.waitForFunction(() => document.querySelector('.resident-navigation-summary')?.getAttribute('aria-busy') === 'false');
  await page.screenshot({ path: resolve(raw, 'normal.png') });
  const initial = await residentState(page);
  console.log(JSON.stringify({ phase: 'initial', minute: initial.minute, route: initial.route, forecast: initial.forecast.status }));
  await scrollToElement(page, '.resident-home');
  await page.screenshot({ path: resolve(raw, 'map.png') });
  await command({ action: 'run_demo' });
  await command({ action: 'set_speed', speed: 4 });
  const snapshots = [];
  for (let i = 0; i < 18; i++) {
    await sleep(1000);
    const s = await residentState(page);
    snapshots.push({ minute: s.minute, route: s.route, closed: s.roads.filter(r => r.status === 'CLOSED').length, status: await page.locator('.resident-status h2').innerText(), forecast: s.forecast.status });
    console.log(JSON.stringify(snapshots.at(-1)));
    if (s.minute >= 55) break;
  }
  await command({ action: 'set_paused', paused: true });
  await sleep(2600);
  await page.screenshot({ path: resolve(raw, 'storm-map.png') });
  await scrollToElement(page, '.resident-status');
  await page.screenshot({ path: resolve(raw, 'storm-status.png') });
  await scrollToElement(page, '.resident-water');
  await page.screenshot({ path: resolve(raw, 'forecast.png') });
  await writeFile(resolve(raw, 'rehearsal.json'), JSON.stringify(snapshots, null, 2));
  console.log(`Rehearsal images saved in ${raw}`);
} finally { await browser.close(); }
