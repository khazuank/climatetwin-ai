import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/resident.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { parseResidentState, residentLevelPercent, residentSummary, sameResidentView, usableResidentRoutes } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const state = {
  source: "SYNTHETIC_DEMO", run_id: "one", minute: 3,
  server_timestamp_utc: "2026-10-21T00:00:00Z",
  zones: [{ id: "D1", name: "North drain", risk: "NORMAL" }],
  roads: [{ id: "R1", start_node: "A", end_node: "B", status: "OPEN" }],
  houses: [{ id: "H1", name: "North homes", node_id: "A", zone_id: "D1" }],
  nodes: [], route_options: [], notifications: [], shelter: { name: "Community shelter" },
  forecast: { source: "TRAINED_ML", status: "unavailable", run_id: "one",
    simulation_minute: 3, predicted_at_utc: "2026-10-21T00:00:00Z", zones: [] },
  route: { home_id: "H1", mode: "WALK", available: true, road_ids: ["R1"] },
};

test("resident contract contains no management data", () => {
  assert.equal(parseResidentState(state), state);
  assert.throws(() => parseResidentState({ ...state, route: null }));
  assert.equal("pumps" in state, false);
});

test("nearby conditions follow road, drainage and forecast evidence", () => {
  assert.equal(residentSummary(state, "H1").level, "normal");
  assert.equal(residentSummary(state, "H1").title, "Nearby roads are open");
  assert.equal(residentSummary({ ...state, roads: [] }, "H1").level, "unavailable");
  assert.equal(residentSummary({ ...state, zones: [] }, "H1").level, "unavailable");
  const watch = { ...state, zones: [{ ...state.zones[0], risk: "WATCH" }] };
  assert.equal(residentSummary(watch, "H1").level, "caution");
  const forecast = { ...state, roads: [{ ...state.roads[0], closure_eta: { status: "ESTIMATED", minutes: 10 } }] };
  assert.equal(residentSummary(forecast, "H1").level, "caution");
  const closed = { ...state, roads: [{ ...state.roads[0], status: "CLOSED" }] };
  assert.equal(residentSummary(closed, "H1").level, "danger");
  assert.match(residentSummary(closed, "H1").detail, /road is closed/);
  const blocked = { ...closed, route: { ...state.route, available: false, road_ids: [] } };
  assert.equal(residentSummary(blocked, "H1").title, "Flooding is affecting nearby roads");
});

test("resident route rejects closed roads", () => {
  const withShelter = { ...state, shelter: { id: "S1" }, route: { ...state.route, shelter_id: "S1" } };
  assert.equal(usableResidentRoutes(withShelter, "H1").length, 1);
  assert.equal(usableResidentRoutes({ ...withShelter, roads: [{ ...state.roads[0], status: "CLOSED" }] }, "H1").length, 0);
});

test("water percentages use warning thresholds and retain over-warning values", () => {
  assert.equal(residentLevelPercent(40, 80), 50);
  assert.equal(residentLevelPercent(125, 100), 125);
  assert.equal(residentLevelPercent(-2, 100), 0);
  assert.equal(residentLevelPercent(null, 100), null);
  assert.equal(residentLevelPercent(10, 0), null);
});

test("forecast wall timestamps do not cause polling flicker", () => {
  const next = { ...state, server_timestamp_utc: "2026-10-21T00:00:02Z",
    forecast: { ...state.forecast, predicted_at_utc: "2026-10-21T00:00:02Z" } };
  assert.equal(sameResidentView(state, next), true);
  assert.equal(sameResidentView(state, { ...next, forecast: { ...next.forecast, status: "ready" } }), false);
});
