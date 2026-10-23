import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/ai.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { aiZoneHeadline, buildAiChart, chartYRange, displayDepthCm, parseAiResponse, trainedCapacityForecast } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const feedSource = await readFile(new URL("../src/lib/ai-feed.ts", import.meta.url), "utf8");
const feedCompiled = ts.transpileModule(feedSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { initialAiFeed, beginAiRefresh, receiveAiRefresh, failAiRefresh, aiForecastAvailability } = await import(
  `data:text/javascript;base64,${Buffer.from(feedCompiled).toString("base64")}`
);

const forecast = (horizon_min, predicted_cm) => ({
  horizon_min, predicted_cm, threshold_outlook: "LOWER", threshold_model_score: 0.2,
  holdout_mae_cm: 3, holdout_p80_absolute_error_cm: 6,
});
const zones = ["D1", "D2", "POND"].map((id) => ({
  id, current_cm: 40, capacity_cm: 100,
  forecasts: [forecast(5, 45), forecast(10, 50), forecast(20, 60)], factors: [],
}));
const ready = {
  schema_version: 1, status: "ready", reason: null,
  predicted_at_utc: "2026-10-19T00:00:00Z", simulation_minute: 8,
  scenario: "CLEAR",
  run_id: "run-a",
  model: { version: "synthetic-hgb-v1", training_source: "SYNTHETIC_SIMULATION",
    scenario_count: 120, split: "complete scenario episodes", metrics: {} },
  zones,
  prediction_history: [{ minute: 0, due_minute: 10, zone_id: "D2",
    predicted_cm: 52, observed_cm: 49 }],
  intervention: { source: "DETERMINISTIC_SIMULATION", horizon_min: 20,
    assumption: "Current scenario", p2_off: { available: true, D2_depth_cm: 80 },
    p2_on: { available: true, D2_depth_cm: 68 }, D2_reduction_cm: 12,
    recommendation: "Consider P2." },
};
const state = {
  minute: 8, scenario: "CLEAR", run_id: "run-a", history: [
    { minute: 7, depths_cm: { D1: 34, D2: 37, POND: 43 } },
    { minute: 8, depths_cm: { D1: 36, D2: 40, POND: 44 } },
  ],
};

test("formats the selected zone's actual and trained 10-minute forecast", () => {
  const response = parseAiResponse(ready);
  assert.equal(aiZoneHeadline(response.zones[1]), "D2: 40.0 cm now → 50.0 cm ML forecast at +10 min");
  assert.equal(response.model.training_source, "SYNTHETIC_SIMULATION");
});

test("keeps observed chart points distinct from future ML points and verified outcomes", () => {
  const chart = buildAiChart(state, "D2", parseAiResponse(ready));
  assert.deepEqual(chart.observed, [{ minute: 7, cm: 37 }, { minute: 8, cm: 40 }]);
  assert.deepEqual(chart.forecast, [{ minute: 8, cm: 40 }, { minute: 13, cm: 45 },
    { minute: 18, cm: 50 }, { minute: 28, cm: 60 }]);
  assert.equal(chart.verified[0].observed_cm, 49);
});

test("makes model-unavailable states explicit and draws no invented forecast", () => {
  const unavailable = parseAiResponse({ ...ready, status: "unavailable",
    reason: "Trained model artifact is missing", model: null, zones: [] });
  assert.equal(buildAiChart(state, "D2", unavailable).forecast.length, 0);
  assert.throws(() => parseAiResponse({ ...ready, zones: [{ ...zones[0], forecasts: [] }] }));
});

test("capacity outlook uses only a fresh trained forecast and the zone capacity", () => {
  const capacityState = { ...state, zones: [{ id: "D2", capacity_cm: 80 }] };
  const outlook = trainedCapacityForecast(capacityState, ready, "D2", 10);
  assert.equal(outlook.percent, 62.5);
  assert.equal(outlook.source, "TRAINED_ML");
  assert.equal(outlook.predicted_cm, 50);
  assert.equal(trainedCapacityForecast({ ...capacityState, minute: 12 }, ready, "D2", 10), null);
  assert.equal(trainedCapacityForecast(capacityState, { ...ready, status: "unavailable" }, "D2", 10), null);
});

test("bounds operational water depth at zero while preserving raw trained output", () => {
  const negative = parseAiResponse({ ...ready, zones: zones.map((zone) =>
    zone.id === "D2" ? { ...zone, forecasts: [forecast(5, -0.4), ...zone.forecasts.slice(1)] } : zone) });
  const capacityState = { ...state, zones: [{ id: "D2", capacity_cm: 80 }] };
  assert.equal(negative.zones[1].forecasts[0].predicted_cm, -0.4);
  assert.equal(displayDepthCm(-0.4), 0);
  assert.equal(trainedCapacityForecast(capacityState, negative, "D2", 5).predicted_cm, 0);
  assert.equal(trainedCapacityForecast(capacityState, negative, "D2", 5).percent, 0);
  assert.equal(buildAiChart(state, "D2", negative).forecast[1].cm, 0);
});

test("detailed chart exposes small normal changes without drawing an off-screen warning", () => {
  const detail = chartYRange([0, 0.8, 2.1, 3], 75, "detail");
  assert.deepEqual(detail, { min: 0, max: 10, warningVisible: false });
  const full = chartYRange([0, 0.8, 2.1, 3], 75, "full");
  assert.equal(full.min, 0);
  assert.ok(full.max > 75);
  assert.equal(full.warningVisible, true);
});

test("chart scaling follows heavy and extreme forecast values with padding", () => {
  const heavy = chartYRange([35, 43, 51, 62], 75, "detail");
  assert.ok(heavy.min < 35 && heavy.max > 62);
  assert.equal(heavy.warningVisible, false);
  const extreme = chartYRange([68, 79, 96, 115], 75, "detail");
  assert.ok(extreme.min < 68 && extreme.max > 115);
  assert.ok(extreme.min > 0);
  assert.equal(extreme.warningVisible, true);
  assert.ok(chartYRange([68, 79, 96, 115], 75, "full").max > 115);
  const widerExtreme = chartYRange([47, 91, 110, 129], 75, "detail");
  assert.ok(widerExtreme.min > 0 && widerExtreme.max > 129);
});

test("consecutive successful refreshes keep cards visible while the next request is pending", () => {
  let feed = beginAiRefresh(initialAiFeed, 1);
  assert.equal(aiForecastAvailability(feed, "CLEAR", "run-a", 8).status, "loading");
  feed = receiveAiRefresh(feed, 1, ready, "CLEAR", "run-a");
  feed = beginAiRefresh(feed, 2);
  assert.equal(aiForecastAvailability(feed, "CLEAR", "run-a", 8).forecast.zones[1].forecasts[1].predicted_cm, 50);
  assert.equal(aiForecastAvailability(feed, "CLEAR", "run-a", 8).status, "ready");
  const later = { ...ready, simulation_minute: 9, zones: zones.map(zone => ({ ...zone,
    forecasts: [forecast(5, 46), forecast(10, 51), forecast(20, 61)] })) };
  feed = receiveAiRefresh(feed, 2, later, "CLEAR", "run-a");
  assert.equal(aiForecastAvailability(feed, "CLEAR", "run-a", 9).forecast.zones[1].forecasts[1].predicted_cm, 51);
});

test("temporary transport failure keeps the last successful forecast and labels it stale", () => {
  let feed = receiveAiRefresh(beginAiRefresh(initialAiFeed, 1), 1, ready, "CLEAR", "run-a");
  feed = failAiRefresh(beginAiRefresh(feed, 2), 2, "Temporary network delay");
  const view = aiForecastAvailability(feed, "CLEAR", "run-a", 9);
  assert.equal(view.status, "stale");
  assert.equal(view.forecast.simulation_minute, 8);
  assert.equal(feed.failure, "transport");
  assert.equal(aiForecastAvailability(failAiRefresh(beginAiRefresh(initialAiFeed, 1), 1, "offline"), "CLEAR", "run-a", 8).status, "delayed");
});

test("a forecast from a later backend tick is labelled synchronizing until state catches up", () => {
  const ahead = { ...ready, simulation_minute: 9 };
  const feed = receiveAiRefresh(beginAiRefresh(initialAiFeed, 1), 1, ahead, "CLEAR", "run-a");
  assert.equal(aiForecastAvailability(feed, "CLEAR", "run-a", 8).status, "synchronizing");
  assert.equal(aiForecastAvailability(feed, "CLEAR", "run-a", 9).status, "ready");
});

test("genuine model failure is unavailable, while retaining earlier values for reference", () => {
  let feed = receiveAiRefresh(beginAiRefresh(initialAiFeed, 1), 1, ready, "CLEAR", "run-a");
  feed = receiveAiRefresh(beginAiRefresh(feed, 2), 2,
    { ...ready, status: "unavailable", reason: "Model artifact missing", zones: [] }, "CLEAR", "run-a");
  const view = aiForecastAvailability(feed, "CLEAR", "run-a", 8);
  assert.equal(view.status, "unavailable");
  assert.equal(view.forecast.zones[1].forecasts[1].predicted_cm, 50);
  assert.equal(feed.error, "Model artifact missing");
  assert.equal(aiForecastAvailability(beginAiRefresh(feed, 3), "CLEAR", "run-a", 8).status, "unavailable");
  assert.equal(aiForecastAvailability(feed, "HEAVY", "run-a", 8).status, "loading");
  assert.equal(aiForecastAvailability(receiveAiRefresh(beginAiRefresh(initialAiFeed, 1), 1,
    { ...ready, status: "unsupported", reason: "Invalid features", zones: [] }, "CLEAR", "run-a"), "CLEAR", "run-a", 8).status, "unavailable");
});

test("request races and scenario changes cannot replace a newer forecast", () => {
  const heavy = { ...ready, scenario: "HEAVY", simulation_minute: 12 };
  let feed = beginAiRefresh(initialAiFeed, 1);
  feed = beginAiRefresh(feed, 2);
  feed = receiveAiRefresh(feed, 2, heavy, "HEAVY", "run-a");
  feed = receiveAiRefresh(feed, 1, ready, "CLEAR", "run-a");
  assert.equal(feed.latest.scenario, "HEAVY");
  assert.equal(aiForecastAvailability(feed, "CLEAR", "run-a", 12).forecast, null);
  feed = receiveAiRefresh(beginAiRefresh(feed, 3), 3, ready, "HEAVY", "run-a");
  assert.equal(feed.latest.scenario, "HEAVY");
  assert.equal(feed.failure, "transport");
  feed = receiveAiRefresh(beginAiRefresh(feed, 4), 4,
    { ...heavy, simulation_minute: 11 }, "HEAVY", "run-a");
  assert.equal(feed.latest.simulation_minute, 12);
});

test("a reset in the same scenario accepts a new run and hides the previous run", () => {
  const old = { ...ready, simulation_minute: 80 };
  let feed = receiveAiRefresh(beginAiRefresh(initialAiFeed, 1), 1, old, "CLEAR", "run-a");
  assert.equal(aiForecastAvailability(feed, "CLEAR", "run-b", 0).forecast, null);
  feed = receiveAiRefresh(beginAiRefresh(feed, 2), 2,
    { ...ready, run_id: "run-b", simulation_minute: 0 }, "CLEAR", "run-b");
  assert.equal(aiForecastAvailability(feed, "CLEAR", "run-b", 0).status, "ready");
  assert.equal(feed.latest.simulation_minute, 0);
});

test("a successful refresh recovers after model failure", () => {
  let feed = receiveAiRefresh(beginAiRefresh(initialAiFeed, 1), 1,
    { ...ready, status: "unavailable", reason: "Model stopped", zones: [] }, "CLEAR", "run-a");
  assert.equal(aiForecastAvailability(feed, "CLEAR", "run-a", 8).status, "unavailable");
  feed = receiveAiRefresh(beginAiRefresh(feed, 2), 2, ready, "CLEAR", "run-a");
  assert.equal(aiForecastAvailability(feed, "CLEAR", "run-a", 8).status, "ready");
  assert.equal(feed.error, null);
});
