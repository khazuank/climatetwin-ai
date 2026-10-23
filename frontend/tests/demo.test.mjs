import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/demo.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { assessHome, compareZonePriority, etaLabel, mentionedRoadId, parseDemoState, routeSafetyLabel, travelDurationLabel, warningLevelPercent } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const position = { x: 0.5, y: 0.5 };
const zone = (id) => ({ id, name: id, position, depth_cm: 35, capacity_cm: 100,
  capacity_percent: 35, trend: "STABLE", rate_cm_min: 0, risk: "NORMAL",
  forecast_10_min_cm: 33, flood_threshold_cm: 75,
  flood_eta: { status: "NOT_PREDICTED", minutes: null },
  baseline_forecasts: [5, 10, 20].map((horizon_min) => ({ horizon_min, predicted_cm: 33 })) });
const state = {
  source: "SYNTHETIC_DEMO", version: 1, run_id: "run-a", server_timestamp_utc: "2026-10-19T00:00:00Z",
  minute: 0, simulated_time: "14:00", speed: 1, paused: false,
  scenario: "CLEAR", rainfall_mm_h: 0, overall_risk: "NORMAL",
  zones: [zone("D1"), zone("D2"), zone("POND")],
  roads: [{ id: "R1", start_node: "A", end_node: "B", accessible: true, via: [],
    distance_m: 100, walk_minutes: 1.4, road_class: "MAIN", allowed_modes: ["WALK", "CAR", "MOTORCYCLE"],
    status: "OPEN", closure_eta: { status: "NOT_PREDICTED", minutes: null } }],
  nodes: [{ id: "A", position }], houses: [{ id: "H1", node_id: "A", zone_id: "D1", position }],
  pumps: [{ id: "P1", position, on: false }], shelter: { id: "S1", position },
  school: { id: "SCH1", position },
  time_model: { walk_speed_m_min: 72,
    mode_speed_m_min: { WALK: 72, CAR: 300, MOTORCYCLE: 360 },
    junction_delay_min: { WALK: 0, CAR: 0.18, MOTORCYCLE: 0.12 } }, pump_outlooks: [],
  route: { available: true, road_ids: ["R1"], home_id: "H1", mode: "WALK", travel_minutes: 1.4 },
  route_options: [{ available: true, road_ids: ["R1"], mode: "WALK", travel_minutes: 1.4 }],
  history: [], events: [], notifications: [], incidents: [], recommendation: "Monitor.",
};

test("accepts a synthetic shared state with three virtual zones and a graph route", () => {
  const parsed = parseDemoState(state);
  assert.equal(parsed.source, "SYNTHETIC_DEMO");
  assert.deepEqual(parsed.zones.map((item) => item.id), ["D1", "D2", "POND"]);
  assert.deepEqual(parsed.route.road_ids, ["R1"]);
});

test("rejects physical-source, impossible map positions, and malformed road states", () => {
  assert.throws(() => parseDemoState({ ...state, source: "ESP32" }));
  assert.throws(() => parseDemoState({ ...state, nodes: [{ id: "A", position: { x: 2, y: 0.5 } }] }));
  assert.throws(() => parseDemoState({ ...state, roads: [{ ...state.roads[0], accessible: "yes" }] }));
  assert.throws(() => parseDemoState({ ...state, time_model: { walk_speed_m_min: 72 } }));
});

test("prioritizes the highest-risk zone before capacity", () => {
  const zones = [
    { ...zone("D1"), risk: "WATCH", capacity_percent: 99 },
    { ...zone("D2"), risk: "CRITICAL", capacity_percent: 60 },
    { ...zone("POND"), risk: "WARNING", capacity_percent: 95 },
  ];
  assert.equal([...zones].sort(compareZonePriority)[0].id, "D2");
});

test("uses capacity to break ties within the same risk severity", () => {
  const zones = [
    { ...zone("D1"), risk: "WARNING", capacity_percent: 65 },
    { ...zone("D2"), risk: "WARNING", capacity_percent: 85 },
  ];
  assert.equal([...zones].sort(compareZonePriority)[0].id, "D2");
});

test("current-level percentage uses each zone's warning level and keeps overflow visible", () => {
  assert.equal(warningLevelPercent({ depth_cm: 37.5, flood_threshold_cm: 75 }), 50);
  assert.equal(warningLevelPercent({ depth_cm: 60, flood_threshold_cm: 80 }), 75);
  assert.equal(warningLevelPercent({ depth_cm: 90, flood_threshold_cm: 75 }), 120);
});

test("labels model-projected ETA outcomes without inventing a countdown", () => {
  assert.equal(etaLabel({ status: "ESTIMATED", minutes: 7.2 }, 40), "Est. 8 simulated min");
  assert.equal(etaLabel({ status: "FLOODED_NOW", minutes: 0 }, 40), "Threshold crossed now");
  assert.equal(etaLabel({ status: "NOT_PREDICTED", minutes: null }, 40), "Not predicted within 40 min");
  assert.equal(etaLabel({ status: "UNAVAILABLE", minutes: null }, 40), "Estimate unavailable");
});

test("route copy uses a road-specific margin or states the forecast limit", () => {
  assert.match(routeSafetyLabel({ available: true, safety_margin_min: 4.2 }, 40), /4\.2 simulated min/);
  assert.match(routeSafetyLabel({ available: true, safety_margin_min: null }, 40), /Beyond that window is unknown/);
  assert.match(routeSafetyLabel({ available: false, safety_margin_min: null }, 40), /No feasible route/);
});

test("home evidence stays unknown even when its access road is open", () => {
  const assessment = assessHome(state, "H1");
  assert.equal(assessment.homeFloodRisk, "UNKNOWN");
  assert.equal(assessment.access, "OPEN");
  assert.equal(assessment.zone.capacity_percent, 35);
  assert.deepEqual(assessment.counts, { open: 1, atRisk: 0, closed: 0 });
  assert.equal(assessHome(state, "H9"), null);
  assert.equal(assessHome({ ...state, roads: [{ ...state.roads[0], status: "CLOSED" }] }, "H1").access, "CLOSED");
  assert.equal(assessHome({ ...state, roads: [] }, "H1").access, "UNKNOWN");
});

test("travel copy avoids false precision below a minute", () => {
  assert.equal(travelDurationLabel(0.8), "Under 1 min");
  assert.equal(travelDurationLabel(2.37), "2.4 min");
  assert.equal(travelDurationLabel(null), "Unavailable");
});

test("contextual road action selects the complete road identifier", () => {
  assert.equal(mentionedRoadId("Monitor D2 and road R12.", [{ id: "R1" }, { id: "R12" }]), "R12");
  assert.equal(mentionedRoadId("Continue monitoring.", [{ id: "R12" }]), null);
});
