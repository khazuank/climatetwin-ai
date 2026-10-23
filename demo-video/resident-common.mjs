import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const root = dirname(fileURLToPath(import.meta.url));
export const raw = resolve(root, 'raw/resident');
export const base = process.env.CLIMATETWIN_BASE_URL ?? 'http://localhost:3000';
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const mobile = { viewport: { width: 390, height: 640 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, permissions: [] };

export async function setup() {
  await mkdir(raw, { recursive: true });
  const config = await readFile(resolve(root, '../backend/.env'), 'utf8');
  const username = config.match(/^CLIMATETWIN_MANAGEMENT_USERNAME=(.*)$/m)?.[1];
  const password = process.env.CLIMATETWIN_DEMO_PASSWORD;
  if (!username || !password) throw new Error('Supply CLIMATETWIN_DEMO_PASSWORD for the separate Management session.');
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-notifications', '--hide-scrollbars'] });
  const management = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const control = await management.newPage();
  await control.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await control.waitForFunction(() => Object.keys(document.querySelector('.login-form') ?? {}).some(key => key.startsWith('__reactFiber$')));
  await control.locator('#username').fill(username);
  await control.locator('#password').fill(password);
  await control.getByRole('button', { name: 'Sign In', exact: true }).click();
  await control.waitForURL('**/management', { waitUntil: 'domcontentloaded' });
  await control.locator('.management-dashboard').waitFor();
  async function command(body, reset = false) {
    return control.evaluate(async ({ body, reset }) => {
      const session = await (await fetch('/api/auth/session')).json();
      const response = await fetch(reset ? '/api/demo/reset' : '/api/demo/command', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf_token },
        ...(reset ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new Error(`Simulation command failed: ${response.status}`);
      return response.json();
    }, { body, reset });
  }
  await command({}, true);
  await command({ action: 'set_paused', paused: true });
  return { browser, management, control, command };
}

export async function clean(context) {
  // Hide only the development tooling badge, never product data or controls.
  await context.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = 'nextjs-portal{display:none!important}';
    document.head.append(style);
  }));
}

export async function scrollToElement(page, selector, offset = 10, duration = 850) {
  await page.evaluate(async ({ selector, offset, duration }) => {
    const target = Math.max(0, document.querySelector(selector).getBoundingClientRect().top + scrollY - offset);
    const start = scrollY, begun = performance.now();
    await new Promise(done => {
      function frame(now) {
        const t = Math.min(1, (now - begun) / duration);
        const eased = t * t * (3 - 2 * t);
        scrollTo({ left: 0, top: start + (target - start) * eased, behavior: 'instant' });
        if (t < 1) requestAnimationFrame(frame); else done();
      }
      requestAnimationFrame(frame);
    });
  }, { selector, offset, duration });
}

export async function residentState(page) {
  return page.evaluate(async () => {
    const home = document.querySelector('#resident-home-select').value;
    const response = await fetch(`/api/resident/state?home_id=${home}&mode=WALK`);
    if (!response.ok) throw new Error(`Resident state failed: ${response.status}`);
    return response.json();
  });
}
