import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import ts from "typescript";

// Compile the actual pure model in memory; no test framework or generated files required.
const source = await readFile(
  new URL("../src/lib/simulation/model.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
});
const {
  createInitialState,
  simulationReducer: reduce,
  riskLevel,
  riskScore,
  overflowMinutes,
  criticalSensor,
} = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`
);
const ticks = (state, n) =>
  Array.from({ length: n }).reduce((s) => reduce(s, { type: "TICK" }), state);

test("baseline telemetry and chart share the same source; standby does not advance", () => {
  const state = createInitialState();
  for (const sensor of state.sensors) {
    assert.equal(sensor.source, "simulation");
    assert.equal(state.history.at(-1)[sensor.id], sensor.level);
  }
  assert.equal(reduce(state, { type: "TICK" }), state);
  assert.equal(criticalSensor(state.sensors).id, "D2");
});
test("storm progressively raises rainfall and all drains, with D2 rising fastest", () => {
  let state = reduce(createInitialState(), { type: "START_STORM" });
  for (let i = 0; i < 12; i++) {
    const previous = state;
    state = reduce(state, { type: "TICK" });
    assert.ok(state.rainfall >= previous.rainfall);
    assert.ok(
      state.sensors.every((s, j) => s.level > previous.sensors[j].level),
    );
    assert.ok(state.sensors[1].trend > state.sensors[0].trend);
    assert.equal(state.history.at(-1).D2, state.sensors[1].level);
  }
  assert.ok(state.events.some((e) => e.title.includes("increased to high")));
  assert.ok(
    state.events.some((e) => e.title.includes("increased to critical")),
  );
});
test("overflow crossing is logged once and prolonged storms stay bounded", () => {
  const state = ticks(
    reduce(createInitialState(), { type: "START_STORM" }),
    240,
  );
  assert.equal(state.rainfall, 96);
  assert.ok(
    state.sensors.every((s) => s.level <= s.criticalLevel * 1.3 + 0.001),
  );
  assert.equal(
    state.events.filter(
      (e) => e.title === "D2 modelled overflow threshold reached",
    ).length,
    1,
  );
  assert.equal(overflowMinutes(state.sensors[1]), 0);
  assert.equal(state.history.length, 180);
});
test("pause freezes the model, resume continues it", () => {
  const active = reduce(createInitialState(), { type: "START_STORM" });
  const paused = reduce(active, { type: "TOGGLE_PAUSE" });
  assert.equal(ticks(paused, 8), paused);
  const resumed = reduce(paused, { type: "TOGGLE_PAUSE" });
  assert.equal(ticks(resumed, 1).minute, 1);
});
test("pump intervention lowers levels and risk, reaches recovery and stops", () => {
  const storm = ticks(
    reduce(createInitialState(), { type: "START_STORM" }),
    18,
  );
  const pumping = reduce(storm, { type: "START_PUMP" });
  const next = ticks(pumping, 1);
  assert.ok(next.sensors.every((s, i) => s.level < pumping.sensors[i].level));
  assert.ok(
    riskScore(next.sensors[1], next.rainfall) <=
      riskScore(storm.sensors[1], storm.rainfall),
  );
  const drawnDown = ticks(next, 8);
  assert.ok(
    riskScore(drawnDown.sensors[1], drawnDown.rainfall) <
      riskScore(storm.sensors[1], storm.rainfall),
  );
  assert.equal(overflowMinutes({ ...next.sensors[1], level: 1.5 }), null);
  const recovered = ticks(next, 100);
  assert.equal(recovered.phase, "recovered");
  assert.ok(recovered.sensors.every((s) => s.level <= 0.8));
  assert.equal(reduce(recovered, { type: "TICK" }), recovered);
  assert.ok(
    recovered.events.some((e) => e.title === "Recovery verified in simulation"),
  );
});
test("risk thresholds are precise and index is bounded", () => {
  const sensor = createInitialState().sensors[1];
  for (const [ratio, expected] of [
    [0.54, "low"],
    [0.55, "watch"],
    [0.78, "high"],
    [0.95, "critical"],
  ]) {
    assert.equal(
      riskLevel({ ...sensor, level: sensor.criticalLevel * ratio }),
      expected,
    );
  }
  assert.equal(riskScore({ ...sensor, level: 10, trend: 10 }, 100), 100);
  assert.equal(riskScore({ ...sensor, level: 0, trend: -1 }, 0), 0);
  assert.equal(overflowMinutes({ ...sensor, trend: 0 }), null);
  assert.equal(overflowMinutes(sensor), 54);
});
test("repeated start commands do not duplicate actions; alerts can be acknowledged", () => {
  const storm = reduce(createInitialState(), { type: "START_STORM" });
  assert.equal(reduce(storm, { type: "START_STORM" }), storm);
  const pumping = reduce(storm, { type: "START_PUMP" });
  assert.equal(reduce(pumping, { type: "START_PUMP" }), pumping);
  const acknowledged = reduce(storm, { type: "ACKNOWLEDGE", id: 3 });
  assert.equal(acknowledged.events.find((e) => e.id === 3).acknowledged, true);
  assert.deepEqual(acknowledged.sensors, storm.sensors);
});
test("reset restores readings, clock, history, alerts and pause state", () => {
  const state = ticks(
    reduce(createInitialState(), { type: "START_STORM" }),
    14,
  );
  assert.deepEqual(reduce(state, { type: "RESET" }), createInitialState());
});
