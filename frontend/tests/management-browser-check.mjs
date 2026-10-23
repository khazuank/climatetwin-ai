import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { strict as assert } from "node:assert";

const baseUrl = process.argv[2] ?? "http://localhost:3000";
const viewportWidth = Number(process.env.CLIMATETWIN_VIEWPORT_WIDTH ?? 1536);
const viewportHeight = Number(process.env.CLIMATETWIN_VIEWPORT_HEIGHT ?? 1024);
const outputDir = resolve(".artifacts/qa");
await mkdir(outputDir, { recursive: true });
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=9225",
  `--user-data-dir=${resolve(outputDir, "management-browser-profile")}`,
  "about:blank",
], { windowsHide: true, stdio: "ignore" });

const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
let socket;
let sessionId;
let nextId = 0;
const pending = new Map();

async function waitFor(test, message, attempts = 120) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { if (await test()) return; } catch (error) { lastError = error; }
    await delay(100);
  }
  throw new Error(`Timed out: ${message}`, { cause: lastError });
}

function command(method, params = {}, inSession = true) {
  return new Promise((resolvePromise, rejectPromise) => {
    const id = ++nextId;
    pending.set(id, { resolvePromise, rejectPromise });
    socket.send(JSON.stringify({ id, method, params, ...(inSession && sessionId ? { sessionId } : {}) }));
  });
}

async function evaluate(expression) {
  const response = await command("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}

async function screenshot(name, full = false) {
  const metrics = full ? await command('Page.getLayoutMetrics') : null;
  const shot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: full,
    ...(metrics ? { clip: { x: 0, y: 0, width: metrics.cssContentSize.width, height: metrics.cssContentSize.height, scale: 1 } } : {}) });
  await writeFile(resolve(outputDir, name), Buffer.from(shot.data, "base64"));
}

try {
  let version;
  await waitFor(async () => {
    try {
      version = await (await fetch("http://127.0.0.1:9225/json/version")).json();
      return true;
    } catch { return false; }
  }, "Chrome debugging endpoint");
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolvePromise, rejectPromise) => {
    socket.onopen = resolvePromise;
    socket.onerror = rejectPromise;
  });
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    if (message.error) handler.rejectPromise(new Error(message.error.message));
    else handler.resolvePromise(message.result);
  };
  const target = await command("Target.createTarget", { url: "about:blank" }, false);
  const attached = await command("Target.attachToTarget", {
    targetId: target.targetId, flatten: true,
  }, false);
  sessionId = attached.sessionId;
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Emulation.setDeviceMetricsOverride", {
    width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile: false,
  });
  await fetch(`${baseUrl}/api/demo/reset`, { method: "POST" });
  await fetch(`${baseUrl}/api/demo/command`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set_paused", paused: true }) });
  await command("Page.navigate", { url: baseUrl });
  await waitFor(() => evaluate("!!document.querySelector('.management-dashboard') && document.querySelector('[data-horizon]')?.dataset.depth !== undefined && document.querySelector('[data-horizon]')?.dataset.depth !== ''"), "management dashboard and trained forecasts");
  await evaluate("document.fonts.ready");
  await delay(750);
  async function click(selector) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  }
  async function readState() {
    return evaluate("fetch('/api/demo/state?home_id=H2').then(r => r.json())");
  }
  async function select(selector, value) {
    await waitFor(() => evaluate(`!document.querySelector(${JSON.stringify(selector)}).disabled`), "enabled selector");
    await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  }
  async function scenario(value) {
    await select('#management-weather', value);
    await waitFor(async () => (await readState()).scenario === value, `${value} scenario`);
    await waitFor(() => evaluate("!document.querySelector('#management-weather').disabled && document.querySelector('[data-horizon]').dataset.depth !== ''"), `${value} trained forecasts`);
    console.log(`PASS ${value} scenario with all three trained forecasts`);
  }
  if (process.env.CLIMATETWIN_LAYOUT_MATRIX) {
    const viewports = [[1536, 1024], [1920, 1080], [1366, 768], [390, 844]];
    async function checkLayout(weather) {
      for (const [width, height] of viewports) {
        await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        const result = await evaluate(`(() => {
          const rect = el => { const r = el.getBoundingClientRect(); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; };
          const within = (inner, outer, tolerance = 1) => inner.left >= outer.left-tolerance && inner.right <= outer.right+tolerance && inner.top >= outer.top-tolerance && inner.bottom <= outer.bottom+tolerance;
          const svg = document.querySelector('.management-map .demo-map-svg');
          const svgBounds = rect(svg);
          const grass = rect(svg.querySelector('.demo-map-grass'));
          const cards = [...document.querySelectorAll('.management-zone-card')];
          const clippedFeatures = [...svg.querySelectorAll('.demo-map-target,.demo-school-grounds,.demo-pond-shape')].filter(el => !within(rect(el), svgBounds)).map(el => el.getAttribute('aria-label') ?? el.className.baseVal);
          const clippedContent = [];
          for (const card of cards) {
            for (const el of card.querySelectorAll('header,.management-level-grid > div,.management-level-bar,p,strong')) {
              if (!within(rect(el),rect(card))) clippedContent.push(card.dataset.zone+': '+el.className);
            }
            for (const cell of card.querySelectorAll('.management-level-grid > div')) {
              for (const el of cell.querySelectorAll('strong,p')) {
                const range = document.createRange(); range.selectNodeContents(el);
                if (!within(rect(range),rect(cell))) clippedContent.push(card.dataset.zone+': text '+el.textContent);
              }
            }
          }
          const gaps = cards.slice(1).map((card,index) => rect(card).top - rect(cards[index]).bottom);
          const forecast = rect(document.querySelector('.management-forecasts'));
          const bars = [...document.querySelectorAll('.management-level-bar')];
          const identities = ['D1','D2','POND'].map(id => ({id,
            marker:getComputedStyle(svg.querySelector('[data-map-zone="'+id+'"] .demo-zone-progress')).stroke,
            bar:getComputedStyle(document.querySelector('[data-zone="'+id+'"] .management-level-bar > span')).backgroundColor}));
          const nav = rect(document.querySelector('.management-map-navigation'));
          return {
            overflow:document.documentElement.scrollWidth > innerWidth,
            completeScene:within(grass,svgBounds),
            padding:Math.min(grass.left-svgBounds.left,grass.top-svgBounds.top,svgBounds.right-grass.right,svgBounds.bottom-grass.bottom),
            clippedFeatures,clippedContent,gaps,
            panelContainsCards:cards.every(card => within(rect(card),forecast)),
            barsVisible:bars.length===12 && bars.every(el=>rect(el).height>=8 && rect(el).width>20),
            controlsOutsideMap:nav.left>=svgBounds.right-1 || nav.top>=svgBounds.bottom-1,
            identities,
            bottom:rect(document.querySelector('.management-bottom-row')).bottom,
          };
        })()`);
        assert.equal(result.overflow, false, `${weather} ${width}: horizontal page overflow`);
        assert.equal(result.completeScene, true, `${weather} ${width}: whole map scene fits`);
        assert.ok(result.padding >= 4, `${weather} ${width}: map padding`);
        assert.deepEqual(result.clippedFeatures, [], `${weather} ${width}: map features clipped`);
        assert.deepEqual(result.clippedContent, [], `${weather} ${width}: forecast content clipped`);
        assert.ok(result.gaps.every(gap => gap >= 9), `${weather} ${width}: card spacing`);
        assert.equal(result.panelContainsCards, true);
        assert.equal(result.barsVisible, true);
        assert.equal(result.controlsOutsideMap, true);
        for (const identity of result.identities) assert.equal(identity.marker, identity.bar);
        await screenshot(`layout-${weather}-${width}x${height}.png`, true);
        console.log(`PASS ${weather} ${width}x${height}: full map, complete forecast cards, no overlap/overflow (bottom ${result.bottom.toFixed(0)}px)`);
      }
    }
    const normalValues = await evaluate("[...document.querySelectorAll('[data-current-depth]')].map(el=>el.dataset.currentDepth)");
    await checkLayout('clear');
    await command('Emulation.setDeviceMetricsOverride', { width:1536, height:1024, deviceScaleFactor:1, mobile:false });
    await click('.management-simulation-controls > summary');
    await scenario('EXTREME');
    await select('.management-control-actions label select', '4');
    await waitFor(() => evaluate("document.querySelector('[aria-label=\"Resume simulation\"]')?.disabled === false"), 'resume enabled');
    await click('[aria-label="Resume simulation"]');
    await waitFor(async () => (await readState()).zones.some(zone => zone.depth_cm > zone.flood_threshold_cm), 'extreme storm warning threshold', 500);
    await waitFor(() => evaluate("document.querySelector('[aria-label=\"Pause simulation\"]')?.disabled === false"), 'pause enabled');
    await click('[aria-label="Pause simulation"]');
    await waitFor(async () => (await readState()).paused, 'extreme paused');
    await waitFor(() => evaluate("!document.querySelector('#management-weather').disabled && [...document.querySelectorAll('[data-horizon]')].every(el=>el.dataset.depth!=='')"), 'updated storm forecasts');
    await click('.management-simulation-controls > summary');
    await delay(750);
    const extremeValues = await evaluate("[...document.querySelectorAll('[data-current-depth]')].map(el=>el.dataset.currentDepth)");
    assert.notDeepEqual(extremeValues, normalValues, 'Current cards update from the simulation');
    await checkLayout('extreme');
    await command('Emulation.setDeviceMetricsOverride', { width:1536, height:1024, deviceScaleFactor:1, mobile:false });
    const defaultView = await evaluate("document.querySelector('.management-map .demo-map-svg').getAttribute('viewBox')");
    await click('.management-map [aria-label="Zoom map in"]');
    assert.notEqual(await evaluate("document.querySelector('.management-map .demo-map-svg').getAttribute('viewBox')"), defaultView);
    await click('.management-map [aria-label="Pan map right"]');
    await click('.management-map [aria-label="Reset map view"]');
    assert.equal(await evaluate("document.querySelector('.management-map .demo-map-svg').getAttribute('viewBox')"), defaultView);
    for (const home of ['H1','H2','H3','H4']) {
      await click('g[aria-label^="Select '+home+',"]');
      await waitFor(() => evaluate("document.querySelector('.management-selected').textContent.includes('Home "+home+"')"), home+' details');
    }
    await click('.management-footer button:last-child');
    await waitFor(() => evaluate("!!document.querySelector('.demo-resident-wrap')"), 'Resident Safety');
    await screenshot('layout-resident-desktop.png', true);
    await command('Emulation.setDeviceMetricsOverride', { width:390, height:844, deviceScaleFactor:1, mobile:false });
    await screenshot('layout-resident-mobile.png', true);
    assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false);
    console.log('PASS map pan/zoom/reset, H1-H4 selection and Resident Safety');
    await fetch(`${baseUrl}/api/demo/reset`, {method:'POST'});
    await fetch(`${baseUrl}/api/demo/command`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'set_paused',paused:true})});
    socket.close(); chrome.kill(); process.exit(0);
  }
  const layout = await evaluate(`(() => {
    const panel = document.querySelector('.management-simulation-controls');
    return {
      cards: document.querySelectorAll('.management-zone-card').length,
      bars: document.querySelectorAll('.management-level-bar').length,
      graphs: document.querySelectorAll('.demo-ai-chart,.demo-ai-zone-tabs,.demo-current-levels').length,
      open: panel.open,
      bodyVisible: !!panel.querySelector('.management-control-body').getClientRects().length,
      overflow: document.documentElement.scrollWidth > innerWidth,
      bottom: document.querySelector('.management-bottom-row').getBoundingClientRect().bottom,
      forecastBottom: document.querySelector('.management-forecasts').getBoundingClientRect().bottom,
      lastZoneBottom: document.querySelector('[data-zone="POND"]').getBoundingClientRect().bottom,
      mapLeft: document.querySelector('.management-map').getBoundingClientRect().left,
      forecastLeft: document.querySelector('.management-forecasts').getBoundingClientRect().left,
      currentFont: parseFloat(getComputedStyle(document.querySelector('.management-current-level > strong')).fontSize),
      futureFont: parseFloat(getComputedStyle(document.querySelector('.management-future-level > strong')).fontSize),
    };
  })()`);
  assert.equal(layout.cards, 3);
  assert.equal(layout.bars, 12);
  assert.equal(layout.graphs, 0);
  assert.equal(layout.open, false);
  assert.equal(layout.bodyVisible, false);
  assert.equal(layout.overflow, false);
  assert.ok(layout.mapLeft < layout.forecastLeft);
  assert.ok(layout.currentFont > layout.futureFont);
  assert.ok(layout.bottom <= viewportHeight + 120, 'Desktop layout permits modest natural scrolling');
  assert.ok(layout.lastZoneBottom < layout.forecastBottom, 'Forecast cards stay inside their panel');
  console.log('Desktop layout:', JSON.stringify(layout));
  await screenshot(viewportWidth === 1536 ? "management-reference-desktop.png" : `management-${viewportWidth}x${viewportHeight}.png`);
  if (process.env.CLIMATETWIN_VISUAL_ONLY) {
    console.log(await evaluate("[...document.querySelectorAll('.management-workspace,.management-map,.management-forecasts,.management-zone-card,.management-bottom-row')].map(el=>({name:el.className,height:el.getBoundingClientRect().height,top:el.getBoundingClientRect().top}))"));
    await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await screenshot('management-reference-mobile.png', true);
    assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false);
    socket.close(); chrome.kill(); process.exit(0);
  }
  const identities = await evaluate(`['D1','D2','POND'].map(id => ({
    id,
    marker: getComputedStyle(document.querySelector('[data-map-zone="'+id+'"] .demo-zone-progress')).stroke,
    bar: getComputedStyle(document.querySelector('[data-zone="'+id+'"] .management-level-bar > span')).backgroundColor,
  }))`);
  for (const identity of identities) assert.equal(identity.marker, identity.bar);
  const values = await evaluate(`Array.from(document.querySelectorAll('.management-current-level')).map(el => ({
    depth: Number(el.dataset.currentDepth), reference: Number(el.dataset.reference),
    shown: parseInt(el.querySelector('strong').textContent),
  }))`);
  for (const value of values) assert.equal(value.shown, Math.round(value.depth / value.reference * 100));
  const trained = await evaluate("fetch('/api/demo/ai/v1/predictions?home_id=H2').then(r => r.json())");
  const forecastValues = await evaluate("[...document.querySelectorAll('.management-zone-card')].map(card => ({id:card.dataset.zone,forecasts:[...card.querySelectorAll('[data-horizon]')].map(el=>({horizon:Number(el.dataset.horizon),depth:Number(el.dataset.depth),shown:parseInt(el.querySelector('strong').textContent)})),reference:Number(card.querySelector('[data-reference]').dataset.reference)}))");
  for (const card of forecastValues) for (const item of card.forecasts) {
    const expected = Math.max(0, trained.zones.find(zone => zone.id === card.id).forecasts.find(value => value.horizon_min === item.horizon).predicted_cm);
    assert.equal(item.depth, expected);
    assert.equal(item.shown, Math.round(expected / card.reference * 100));
  }
  console.log('PASS zone identities and warning-level percentages');

  await click('.management-simulation-controls > summary');
  assert.equal(await evaluate("document.querySelector('.management-simulation-controls').open"), true);
  assert.equal(await evaluate("!!document.querySelector('.management-control-body').getClientRects().length"), true);
  await screenshot('management-reference-controls.png');
  await click('.management-simulation-controls > summary');
  assert.equal(await evaluate("document.querySelector('.management-simulation-controls').open"), false);
  console.log('PASS collapsible simulation controls');

  for (const home of ['H1','H2','H3','H4']) {
    await click(`g[aria-label^="Select ${home},"]`);
    await waitFor(() => evaluate(`document.querySelector('.management-selected').textContent.includes('Home ${home}')`), `${home} selected location`);
    await waitFor(() => evaluate(`fetch('/api/demo/state?home_id=${home}').then(r => r.json()).then(s => s.route.home_id === '${home}')`), `${home} route`);
  }
  await click('g[aria-label^="Select H2,"]');
  await waitFor(() => evaluate("document.querySelector('.management-selected').textContent.includes('Home H2')"), 'H2 selected again');
  const viewBox = await evaluate("document.querySelector('.management-map svg.demo-map-svg').getAttribute('viewBox')");
  await click('.management-map [aria-label="Zoom map in"]');
  assert.notEqual(await evaluate("document.querySelector('.management-map svg.demo-map-svg').getAttribute('viewBox')"), viewBox);
  await click('.management-map [aria-label="Pan map right"]');
  await click('.management-map [aria-label="Reset map view"]');
  assert.equal(await evaluate("document.querySelector('.management-map svg.demo-map-svg').getAttribute('viewBox')"), viewBox);
  console.log('PASS H1-H4 selection, selected details, map zoom and pan');

  await waitFor(() => evaluate("!document.querySelector('[aria-label=\"Switch virtual P2 on\"]').disabled"), 'P2 available');
  await click('[aria-label="Switch virtual P2 on"]');
  await waitFor(() => evaluate("document.querySelector('[aria-label=\"Switch virtual P2 off\"]')?.getAttribute('aria-checked') === 'true'"), 'P2 on');
  assert.equal((await readState()).pumps.find(p => p.id === 'P2').on, true);
  await waitFor(() => evaluate("!document.querySelector('[aria-label=\"Switch virtual P2 off\"]').disabled"), 'P2 toggle enabled');
  await click('[aria-label="Switch virtual P2 off"]');
  await waitFor(async () => !(await readState()).pumps.find(p => p.id === 'P2').on, 'P2 off');
  await click('.management-pumps .management-bottom-heading button');
  assert.equal(await evaluate("document.querySelector('.management-detail-dialog').open"), true);
  await click('[aria-label="Close details"]');
  console.log('PASS backend pump commands and deterministic comparison');

  await click('.management-simulation-controls > summary');
  await scenario('MODERATE');
  await scenario('HEAVY');
  await scenario('EXTREME');
  await scenario('CLEAR');
  await waitFor(() => evaluate("!document.querySelector('[aria-label=\"Resume simulation\"]').disabled"), 'play enabled');
  await click('[aria-label="Resume simulation"]');
  await waitFor(async () => !(await readState()).paused, 'simulation playing');
  await waitFor(() => evaluate("!document.querySelector('[aria-label=\"Pause simulation\"]').disabled"), 'pause enabled');
  await click('[aria-label="Pause simulation"]');
  await waitFor(async () => (await readState()).paused, 'simulation paused');
  await select('.management-control-actions label select', '4');
  await waitFor(async () => (await readState()).speed === 4, '4x speed');
  console.log('PASS play, pause and playback speed');

  await command('Network.enable');
  await command('Network.setBlockedURLs', { urls: ['*api/demo/ai/v1/predictions*'] });
  await delay(2200);
  assert.equal(await evaluate("[...document.querySelectorAll('[data-horizon]')].every(el => el.dataset.depth !== '')"), true);
  await select('#management-weather', 'MODERATE');
  await waitFor(async () => (await readState()).scenario === 'MODERATE', 'scenario switch while forecasts delayed');
  await waitFor(() => evaluate("[...document.querySelectorAll('[data-horizon]')].every(el => el.dataset.depth === '')"), 'old scenario forecasts hidden');
  await command('Network.setBlockedURLs', { urls: [] });
  await waitFor(() => evaluate("[...document.querySelectorAll('[data-horizon]')].every(el => el.dataset.depth !== '')"), 'forecast refresh recovery');
  console.log('PASS forecast retention, scenario isolation and recovery');

  await scenario('EXTREME');
  await waitFor(() => evaluate("!document.querySelector('[aria-label=\"Resume simulation\"]').disabled"), 'resume enabled');
  await click('[aria-label="Resume simulation"]');
  await waitFor(async () => (await readState()).roads.some(r => r.status === 'CLOSED'), 'storm road closures', 500);
  await waitFor(async () => (await readState()).zones.some(zone => zone.depth_cm > zone.flood_threshold_cm), 'warning reference exceeded', 250);
  await waitFor(() => evaluate("!!document.querySelector('.management-map .demo-road.is-closed')"), 'closed roads rendered');
  await waitFor(() => evaluate("!document.querySelector('[aria-label=\"Pause simulation\"]').disabled"), 'storm pause enabled');
  await click('[aria-label="Pause simulation"]');
  await waitFor(async () => (await readState()).paused, 'storm paused');
  await click('.management-simulation-controls > summary');
  await screenshot('management-reference-storm.png');
  const stormState = await readState();
  const visibleAlerts = await evaluate("[...document.querySelectorAll('.management-alert-list strong')].map(el => el.textContent)");
  for (const title of visibleAlerts) assert.ok(stormState.notifications.some(event => event.title === title));
  assert.ok(await evaluate("[...document.querySelectorAll('.management-level-bar > span')].every(el => el.getBoundingClientRect().width <= el.parentElement.getBoundingClientRect().width + 1)"));
  console.log('PASS storm road rendering, real alerts and bounded progress bars');

  await click('.management-alerts .management-bottom-heading button');
  assert.equal(await evaluate("!!document.querySelector('[aria-label=\"Notification centre\"]')"), true);
  await click('[aria-label="Close notifications"]');
  await click('.management-simulation-controls > summary');
  await scenario('CLEAR');
  await waitFor(() => evaluate("!document.querySelector('[aria-label=\"Resume simulation\"]').disabled"), 'clear resume enabled');
  await click('[aria-label="Resume simulation"]');
  await waitFor(async () => {
    const state = await readState();
    return state.pumps.some(pump => state.zones.find(zone => zone.id === pump.zone_id).depth_cm <= pump.minimum_depth_cm);
  }, 'pump minimum operating depth', 500);
  await waitFor(() => evaluate("[...document.querySelectorAll('.management-pump-row')].some(row=>row.textContent.includes('Water too low') && row.querySelector('[role=switch]').disabled)"), 'unavailable pump control disabled');
  console.log('PASS pump minimum-depth limit in the interface');
  await waitFor(() => evaluate("!document.querySelector('.management-primary-button').disabled"), 'guided demo enabled');
  await click('.management-primary-button');
  await waitFor(async () => (await readState()).scenario === 'GUIDED', 'guided demo started');
  await waitFor(() => evaluate("!document.querySelector('[aria-label=\"Pause simulation\"]').disabled"), 'guided pause enabled');
  await click('[aria-label="Pause simulation"]');
  await waitFor(async () => (await readState()).paused, 'guided paused');
  await waitFor(() => evaluate("!document.querySelector('[aria-label=\"Reset demo\"]').disabled"), 'reset enabled');
  await click('[aria-label="Reset demo"]');
  await waitFor(async () => (await readState()).scenario === 'CLEAR' && (await readState()).speed === 1, 'simulation reset');
  console.log('PASS guided flood demo and reset');

  await click('.management-footer button:last-child');
  await waitFor(() => evaluate("!!document.querySelector('.demo-resident-wrap')"), 'resident safety');
  await select('#demo-home-select', 'H1');
  await waitFor(() => evaluate("document.querySelector('.demo-home-assessment h2').textContent.includes('H1')"), 'resident home selection');
  await click('[aria-label="Open management dashboard"]');
  await waitFor(() => evaluate("document.querySelectorAll('.management-zone-card').length === 3"), 'return to management');
  console.log('PASS Resident Safety and return navigation');

  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await screenshot('management-reference-mobile.png', true);
  assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false);
  assert.equal(await evaluate("document.querySelectorAll('.management-zone-card').length"), 3);
  console.log('PASS mobile stacking without page overflow');
  await command('Emulation.setDeviceMetricsOverride', { width: 1536, height: 1024, deviceScaleFactor: 1, mobile: false });
  await fetch(`${baseUrl}/api/demo/reset`, { method: "POST" });
  await fetch(`${baseUrl}/api/demo/command`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set_paused", paused: true }) });
} finally {
  socket?.close();
  chrome.kill();
}
