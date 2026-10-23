import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { strict as assert } from "node:assert";

const baseUrl = process.argv[2] || "http://localhost:3001";
const outputDir = resolve(".artifacts/qa");
await mkdir(outputDir, { recursive: true });
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=9237", `--user-data-dir=${resolve(".artifacts/qa/resident-touch-profile")}`, "about:blank",
], { windowsHide: true, stdio: "ignore" });
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
let socket, sessionId, sequence = 0;
const pending = new Map();
async function waitFor(check, label, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
function command(method, params = {}, useSession = true) {
  return new Promise((resolvePromise, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve: resolvePromise, reject });
    socket.send(JSON.stringify({ id, method, params, ...(useSession && sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(expression) {
  const value = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.text);
  return value.result.value;
}
async function touch(type, points) {
  await command("Input.dispatchTouchEvent", { type, touchPoints: points.map(([id, x, y]) => ({ id, x, y, radiusX: 1, radiusY: 1, force: 1 })) });
  await delay(70);
}
async function mapRect() {
  return evaluate(`(() => { const el = document.querySelector('.resident-map .demo-map-svg'); el.scrollIntoView({block:'center',behavior:'instant'}); const r = el.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height }; })()`);
}
const view = () => evaluate("document.querySelector('.resident-map .demo-map-svg').getAttribute('viewBox')");
try {
  let version;
  await waitFor(async () => {
    try { version = await (await fetch("http://127.0.0.1:9237/json/version")).json(); return true; }
    catch { return false; }
  }, "Chrome debugger");
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => { socket.onopen = resolvePromise; socket.onerror = reject; });
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  };
  const target = await command("Target.createTarget", { url: "about:blank" }, false);
  sessionId = (await command("Target.attachToTarget", { targetId: target.targetId, flatten: true }, false)).sessionId;
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await command("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
  await command("Page.navigate", { url: `${baseUrl}/resident` });
  await waitFor(() => evaluate("Boolean(document.querySelector('#resident-home-select') && document.querySelector('.resident-map .demo-map-svg'))"), "Resident map");
  await waitFor(() => evaluate("document.querySelector('.resident-navigation-summary')?.getAttribute('aria-busy') === 'false'"), "resident route");
  assert.equal(await evaluate(`(() => { const cards=[...document.querySelectorAll('.resident-water-card')]; return cards.length===3 && cards.map((item)=>item.dataset.zone).join(',')==='D1,D2,POND' && cards.every((item)=>['NOW','+10 MIN','+20 MIN'].every((period)=>item.querySelector('[data-period="'+period+'"]'))) && !document.querySelector('[data-period="+5 MIN"]') && !document.querySelector('.resident-updates'); })()`), true, "three water cards replace alerts");
  assert.equal(await evaluate(`(() => { const colors={D1:'rgb(44, 107, 255)',D2:'rgb(255, 138, 31)',POND:'rgb(0, 166, 90)'}; return Object.entries(colors).every(([id,color])=>{ const card=document.querySelector('.resident-water-card[data-zone="'+id+'"]'); const marker=document.querySelector('.resident-map .zone-'+id.toLowerCase()+' .demo-zone-centre'); return getComputedStyle(card).borderTopColor===color && getComputedStyle(marker).stroke===color; }); })()`), true, "matching monitoring and map identity colors");
  console.log("PASS three water cards, forecast periods and map identity colors");
  for (const width of [360, 390, 430, 768, 1280]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height: width < 500 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 500 });
    await delay(150);
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), true, `overflow at ${width}px`);
  }
  console.log("PASS responsive widths 360, 390, 430, 768, 1280");
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await command("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
  await delay(100);
  let rect = await mapRect();
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  const beforePan = await view();
  const beforeScroll = await evaluate("scrollY");
  await touch("touchStart", [[1, x, y]]);
  await touch("touchMove", [[1, x + 45, y]]);
  await touch("touchEnd", []);
  assert.notEqual(await view(), beforePan, "one-finger pan changes viewBox");
  assert.equal(await evaluate("scrollY"), beforeScroll, "map drag preserves page scroll");
  console.log("PASS one-finger pan and stable page scroll");
  rect = await mapRect();
  const px = rect.x + rect.width / 2, py = rect.y + rect.height / 2;
  const beforePinch = Number((await view()).split(" ")[2]);
  await touch("touchStart", [[1, px - 40, py]]);
  await touch("touchStart", [[1, px - 40, py], [2, px + 40, py]]);
  await touch("touchMove", [[1, px - 70, py], [2, px + 70, py]]);
  await touch("touchEnd", []);
  assert.ok(Number((await view()).split(" ")[2]) < beforePinch, "pinch zoom changes viewBox width");
  console.log("PASS two-finger pinch zoom");
  await evaluate("document.querySelector('.resident-map-recenter').click()");
  await delay(100);
  const selected = await evaluate(`(() => { const el=document.querySelector('.resident-map [aria-label^="Select H2,"]'); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await touch("touchStart", [[1, selected.x, selected.y]]);
  await touch("touchEnd", []);
  await waitFor(() => evaluate("document.querySelector('.resident-selection')?.textContent.includes('Selected home: H2')"), "home marker tap");
  console.log("PASS marker tap");
  const initialHomeView = await view();
  await evaluate(`(() => { const el=document.querySelector('#resident-home-select'); const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; set.call(el,'H4'); el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await waitFor(() => evaluate("document.querySelector('#resident-home-select').value === 'H4' && document.querySelector('.resident-navigation-summary')?.getAttribute('aria-busy') === 'false'"), "H4 route");
  assert.notEqual(await view(), initialHomeView, "new home fits camera");
  assert.equal(await evaluate("Boolean(document.querySelector('.resident-map .demo-home.is-home'))"), true);
  assert.equal(await evaluate(`(() => { const map=document.querySelector('.resident-map .demo-map-svg').getBoundingClientRect(); const inside=(el) => { const r=el.getBoundingClientRect(); return r.left>=map.left && r.right<=map.right && r.top>=map.top && r.bottom<=map.bottom; }; return inside(document.querySelector('.resident-map .demo-home.is-home')) && inside(document.querySelector('.resident-map .demo-shelter')); })()`), true, "home and shelter fit in viewport");
  console.log("PASS home change fits camera and updates route");
  await evaluate("scrollTo(0,0)");
  const fittedShot = await command("Page.captureScreenshot", { format: "png" });
  await writeFile(resolve(outputDir, "resident-touch-fit-390.png"), Buffer.from(fittedShot.data, "base64"));
  const metrics = await command("Page.getLayoutMetrics");
  const fullShot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: metrics.cssContentSize.width, height: metrics.cssContentSize.height, scale: 1 } });
  await writeFile(resolve(outputDir, "resident-forecast-full-390.png"), Buffer.from(fullShot.data, "base64"));
  rect = await mapRect();
  await command("Input.dispatchMouseEvent", { type: "mouseWheel", x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, deltaX: 0, deltaY: -300 });
  await delay(100);
  const adjusted = await view();
  await delay(2500);
  assert.equal(await view(), adjusted, "background poll preserves adjusted camera");
  console.log("PASS wheel zoom and background camera stability");
  await evaluate("scrollTo(0,0)");
  const scrollBefore = await evaluate("scrollY");
  await touch("touchStart", [[1, 200, 150]]);
  await touch("touchMove", [[1, 200, 65]]);
  await touch("touchEnd", []);
  assert.ok(await evaluate("scrollY") > scrollBefore, "touch outside map scrolls page");
  console.log("PASS ordinary page scrolling outside map");
  await command("Emulation.setTouchEmulationEnabled", { enabled: false });
  await command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  rect = await mapRect();
  const mouseX = rect.x + rect.width / 2, mouseY = rect.y + rect.height / 2;
  await command("Input.dispatchMouseEvent", { type: "mouseWheel", x: mouseX, y: mouseY, deltaX: 0, deltaY: -300 });
  await delay(100);
  const beforeMouseDrag = await view();
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x: mouseX, y: mouseY, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: mouseX + 25, y: mouseY, button: "left" });
  await delay(70);
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: mouseX + 60, y: mouseY, button: "left" });
  await delay(70);
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: mouseX + 60, y: mouseY, button: "left", clickCount: 1 });
  await delay(100);
  assert.notEqual(await view(), beforeMouseDrag, "desktop mouse drag pans map");
  console.log("PASS desktop mouse drag and wheel zoom");
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const shot = await command("Page.captureScreenshot", { format: "png" });
  await writeFile(resolve(outputDir, "resident-touch-390.png"), Buffer.from(shot.data, "base64"));
  console.log(`PASS screenshot saved to ${outputDir}`);
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    await command("Browser.close", {}, false).catch(() => {});
    socket.close();
  }
  chrome.kill();
}
