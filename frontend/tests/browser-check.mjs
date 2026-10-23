import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { strict as assert } from "node:assert";

// Uses an installed Chrome and Node's native WebSocket, without browser automation dependencies.
const baseUrl = process.argv[2] || "http://localhost:3000";
const outputDir = resolve(".artifacts/qa");
const downloadDir = resolve(outputDir, "downloads", String(Date.now()));
await mkdir(outputDir, { recursive: true });
const chrome = spawn(
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=9223",
    `--user-data-dir=${resolve(".artifacts/qa/chrome-profile")}`,
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let socket;
let seq = 0;
let sessionId;
const pending = new Map();
const consoleErrors = [];
const results = [];

async function waitFor(fn, message, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${message}`);
}
function command(method, params = {}, useSession = true) {
  return new Promise((resolvePromise, reject) => {
    const id = ++seq;
    pending.set(id, { resolve: resolvePromise, reject });
    socket.send(
      JSON.stringify({
        id,
        method,
        params,
        ...(useSession && sessionId ? { sessionId } : {}),
      }),
    );
  });
}
async function evaluate(expression) {
  const result = await command("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
async function clickSelector(selector) {
  const bounds = await evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('Missing element'); el.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()`,
  );
  await command("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...bounds,
    button: "left",
    clickCount: 1,
  });
  await command("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...bounds,
    button: "left",
    clickCount: 1,
  });
  await delay(100);
}
async function clickText(label) {
  await evaluate(
    `(() => { const el = [...document.querySelectorAll('button')].find(e => e.textContent.trim().toLowerCase() === ${JSON.stringify(label.toLowerCase())}); if (!el) throw new Error('Missing button: ' + ${JSON.stringify(label)}); el.scrollIntoView({ block: 'center', behavior: 'instant' }); el.click(); })()`,
  );
  await delay(100);
}
async function escape() {
  await command("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await command("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await delay(100);
}
async function screenshot(name, full = false) {
  const viewport = await command("Page.getLayoutMetrics");
  const clip = full
    ? {
        x: 0,
        y: 0,
        width: viewport.cssContentSize.width,
        height: viewport.cssContentSize.height,
        scale: 1,
      }
    : undefined;
  const shot = await command("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: full,
    ...(clip ? { clip } : {}),
  });
  await writeFile(resolve(outputDir, name), Buffer.from(shot.data, "base64"));
}
async function check(name, fn) {
  await fn();
  results.push(name);
  console.log(`PASS ${name}`);
}

try {
  let version;
  await waitFor(async () => {
    try {
      version = await (
        await fetch("http://127.0.0.1:9223/json/version")
      ).json();
      return true;
    } catch {
      return false;
    }
  }, "Chrome debugging endpoint");
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => {
    socket.onopen = resolvePromise;
    socket.onerror = reject;
  });
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const p = pending.get(message.id);
      if (p) {
        pending.delete(message.id);
        if (message.error) p.reject(new Error(message.error.message));
        else p.resolve(message.result);
      }
    }
    if (message.method === "Runtime.exceptionThrown")
      consoleErrors.push(message.params.exceptionDetails);
    if (
      message.method === "Log.entryAdded" &&
      message.params.entry.level === "error"
    )
      consoleErrors.push(message.params.entry);
    if (
      message.method === "Runtime.consoleAPICalled" &&
      message.params.type === "error"
    )
      consoleErrors.push(message.params.args);
  };
  const target = await command(
    "Target.createTarget",
    { url: "about:blank" },
    false,
  );
  const attached = await command(
    "Target.attachToTarget",
    { targetId: target.targetId, flatten: true },
    false,
  );
  sessionId = attached.sessionId;
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Log.enable");
  await command("Emulation.setDeviceMetricsOverride", {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await command(
    "Browser.setDownloadBehavior",
    { behavior: "allow", downloadPath: downloadDir },
    false,
  );
  await command("Page.navigate", { url: baseUrl });
  await waitFor(
    () =>
      evaluate(
        "document.readyState === 'complete' && !!document.querySelector('.recharts-line')",
      ),
    "dashboard hydration",
  );
  await evaluate("document.fonts.ready");
  await delay(400);
  await check("desktop render and no horizontal overflow", async () => {
    assert.equal(
      await evaluate("document.title"),
      "ClimateTwin AI | Command Centre",
    );
    assert.equal(
      await evaluate("document.querySelectorAll('.metric-card').length"),
      4,
    );
    assert.ok(
      await evaluate("document.documentElement.scrollWidth <= innerWidth"),
    );
    assert.ok(
      await evaluate(
        "document.querySelector('.simulation-controls').getBoundingClientRect().bottom <= innerHeight",
      ),
      "Simulation controls must be visible on the presentation display",
    );
  });
  await screenshot("desktop.png");
  await screenshot("desktop-full.png", true);
  await check("map sensor selection and keyboard dismissal", async () => {
    await clickSelector('g[aria-label^="Select sensor D1"]');
    assert.ok(
      await evaluate(
        "document.querySelector('dialog[open]').textContent.includes('North residential drain')",
      ),
    );
    await escape();
    assert.equal(
      await evaluate("document.querySelectorAll('dialog[open]').length"),
      0,
    );
  });
  await check("keyboard sensor selection", async () => {
    await evaluate(
      "document.querySelector('g[aria-label^=\"Select sensor D3\"]').focus()",
    );
    await command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    assert.ok(
      await evaluate(
        "document.querySelector('dialog[open]').textContent.includes('East residential drain')",
      ),
    );
    await escape();
  });
  await check("zone context, zoom, reset and layer toggles", async () => {
    await clickSelector('g[aria-label^="Select Residential Zone B"]');
    assert.ok(
      await evaluate(
        "document.querySelector('.map-context').textContent.includes('Residential Zone B')",
      ),
    );
    await clickSelector('button[aria-label="Zoom in"]');
    assert.ok(
      await evaluate(
        "document.querySelector('.map-zoom').textContent.includes('120%')",
      ),
    );
    await clickSelector('button[aria-label="Reset map view"]');
    await clickSelector('button[aria-label="Toggle map layers"]');
    await clickSelector(".map-layer-menu input");
    assert.equal(
      await evaluate("document.querySelector('.map-layer-menu input').checked"),
      false,
    );
    await clickSelector(".map-layer-menu input");
    await clickSelector('button[aria-label="Close layers"]');
  });
  await check("expanded map and unique SVG IDs", async () => {
    await clickSelector('button[aria-label="Expand township map"]');
    assert.equal(
      await evaluate(
        "document.querySelectorAll('dialog[open] .township-svg').length",
      ),
      1,
    );
    assert.ok(
      await evaluate(
        "(() => { const ids = [...document.querySelectorAll('[id]')].map(e => e.id); return ids.length === new Set(ids).size; })()",
      ),
    );
    await escape();
  });
  await check("chart time range and sensor series", async () => {
    await clickText("15m");
    assert.equal(
      await evaluate(
        "document.querySelector('.segmented-control button[aria-pressed=true]').textContent",
      ),
      "15m",
    );
    await clickSelector('button[aria-label="Toggle D1 chart series"]');
    assert.equal(
      await evaluate("document.querySelectorAll('.recharts-line').length"),
      2,
    );
    await clickSelector('button[aria-label="Toggle D1 chart series"]');
  });
  await check("chart keyboard interaction and tooltips", async () => {
    await evaluate(
      "(() => { const chart = document.querySelector('.recharts-surface[tabindex=\"0\"]'); chart.scrollIntoView({ block: 'center', behavior: 'instant' }); chart.focus(); })()",
    );
    await command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "ArrowRight",
      code: "ArrowRight",
      windowsVirtualKeyCode: 39,
    });
    await waitFor(
      () =>
        evaluate(
          "!!document.querySelector('.recharts-tooltip-wrapper') && document.querySelector('.recharts-tooltip-wrapper').textContent.includes('Drain D2')",
        ),
      "keyboard chart tooltip",
    );
    await screenshot("chart-detail.png");
  });
  await check("sidebar collapse and honest module placeholders", async () => {
    await clickSelector('button[aria-label="Collapse navigation"]');
    assert.ok(
      await evaluate(
        "document.querySelector('.app-shell').classList.contains('sidebar-collapsed')",
      ),
    );
    await clickSelector('button[aria-label="Expand navigation"]');
    await clickText("Sensorssoon");
    assert.ok(
      await evaluate(
        "document.querySelector('dialog[open]').textContent.includes('PLANNED MODULE')",
      ),
    );
    await escape();
  });
  await check("notifications, acknowledgement and filters", async () => {
    await clickSelector('button[aria-label^="Open notifications"]');
    await clickSelector(
      'dialog[open] button[aria-label="Acknowledge D2 water level elevated"]',
    );
    assert.ok(
      await evaluate(
        "document.querySelector('dialog[open] button[aria-label=\"D2 water level elevated acknowledged\"]').disabled",
      ),
    );
    await clickText("Unreviewed");
    assert.equal(
      await evaluate(
        "document.querySelectorAll('dialog[open] .event-item').length",
      ),
      1,
    );
    await escape();
  });
  await check("resident role identifies the planned experience", async () => {
    await evaluate(
      "(() => { const s = document.querySelector('select[aria-label=\"User role\"]'); s.value = 'resident'; s.dispatchEvent(new Event('change', {bubbles:true})); })()",
    );
    await delay(100);
    assert.ok(
      await evaluate(
        "document.querySelector('dialog[open]').textContent.includes('Resident experience')",
      ),
    );
    await escape();
  });
  await check("demo guide and full operational log", async () => {
    await clickText("Demo guide");
    assert.ok(
      await evaluate(
        "document.querySelector('dialog[open]').textContent.includes('not calibrated flood probabilities')",
      ),
    );
    await escape();
    await clickText("Full log");
    assert.ok(
      await evaluate(
        "document.querySelector('dialog[open]').textContent.includes('Simulation environment ready')",
      ),
    );
    await escape();
  });
  await check(
    "storm updates shared readings, chart and timeline; pause freezes them",
    async () => {
      await clickText("Start storm simulation");
      await waitFor(
        () =>
          evaluate(
            "Number(document.querySelectorAll('.metric-value')[1].textContent.replace('m','')) > 1.6",
          ),
        "storm level rise",
      );
      await clickSelector('button[aria-label="Pause simulation"]');
      const values = await evaluate(
        "[...document.querySelectorAll('.metric-value')].map(e=>e.textContent)",
      );
      await delay(1500);
      assert.deepEqual(
        await evaluate(
          "[...document.querySelectorAll('.metric-value')].map(e=>e.textContent)",
        ),
        values,
      );
      assert.ok(
        await evaluate(
          "document.querySelector('.timeline-items').textContent.includes('Storm simulation started')",
        ),
      );
      await screenshot("storm.png", true);
      await clickSelector('button[aria-label="Resume simulation"]');
    },
  );
  await check(
    "pump intervention reduces levels and verifies recovery",
    async () => {
      await clickText("Simulate pump intervention");
      await waitFor(
        () =>
          evaluate(
            "document.querySelector('.simulation-description .badge').textContent.includes('Recovered')",
          ),
        "pump recovery",
        45000,
      );
      assert.equal(
        await evaluate("document.querySelector('.metric-value').textContent"),
        "Low",
      );
      assert.ok(
        await evaluate(
          "document.querySelector('.timeline-items').textContent.includes('Recovery verified')",
        ),
      );
      await screenshot("recovered.png", true);
    },
  );
  await check("snapshot export and reset", async () => {
    const downloadsBefore = await readdir(
      downloadDir,
    ).catch(() => []);
    await clickText("Export snapshot");
    let downloadedFile;
    await waitFor(async () => {
      const files = await readdir(downloadDir).catch(
        () => [],
      );
      downloadedFile = files.find(
        (f) => f.endsWith(".json") && !downloadsBefore.includes(f),
      );
      return !!downloadedFile;
    }, "snapshot JSON download");
    const snapshot = JSON.parse(
      await readFile(resolve(downloadDir, downloadedFile), "utf8"),
    );
    assert.equal(snapshot.source, "simulation");
    assert.equal(snapshot.phase, "recovered");
    assert.equal(snapshot.sensors.length, 3);
    await clickText("Reset scenario");
    assert.equal(
      await evaluate(
        "document.querySelectorAll('.metric-value')[1].textContent",
      ),
      "1.54m",
    );
    assert.ok(
      await evaluate(
        "document.querySelector('.simulation-description .badge').textContent.includes('Ready')",
      ),
    );
  });
  for (const width of [390, 360, 768, 1280]) {
    await check(`responsive layout at ${width}px`, async () => {
      await command("Emulation.setDeviceMetricsOverride", {
        width,
        height: width < 500 ? 844 : 900,
        deviceScaleFactor: 1,
        mobile: width < 500,
      });
      await evaluate("scrollTo(0,0)");
      await delay(200);
      assert.ok(
        await evaluate(
          "document.documentElement.scrollWidth <= innerWidth + 1",
        ),
        `horizontal overflow at ${width}px`,
      );
      if (width === 390) {
        await screenshot("mobile.png", true);
        await clickSelector('button[aria-label="Open navigation"]');
        assert.ok(
          await evaluate(
            "document.querySelector('.sidebar').classList.contains('mobile-open')",
          ),
        );
        await clickSelector(".sidebar-backdrop");
      }
    });
  }
  assert.deepEqual(consoleErrors, [], "Browser console must be free of errors");
  results.push("no browser console or runtime errors");
  await writeFile(
    resolve(outputDir, "browser-results.json"),
    JSON.stringify({ baseUrl, checks: results, consoleErrors }, null, 2),
  );
  console.log(
    `${results.length} browser checks passed. Screenshots: ${outputDir}`,
  );
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    await command("Browser.close", {}, false).catch(() => {});
    socket.close();
  }
  chrome.kill();
}
