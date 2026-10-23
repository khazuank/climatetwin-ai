import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Load the same TypeScript module used by the route and browser without a test dependency.
const source = await readFile(new URL("../src/lib/telemetry.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { parseLatestTelemetry, isFreshTelemetry, sameLatestTelemetry } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const timestamp = "2026-10-19T01:42:23Z";
const sample = {
  readings: {
    D1: { sensor_id: "D1", distance_cm: 12.3, simulated: true, received_at_utc: timestamp },
    D2: { sensor_id: "D2", distance_cm: 18.4, simulated: true, received_at_utc: timestamp },
    POND: { sensor_id: "POND", distance_cm: 25, simulated: true, received_at_utc: timestamp },
  },
};

test("accepts the backend's three test distances and preserves UTC timestamps", () => {
  const latest = parseLatestTelemetry(sample);
  assert.equal(latest.readings.D1.distance_cm, 12.3);
  assert.equal(latest.readings.D2.distance_cm, 18.4);
  assert.equal(latest.readings.POND.distance_cm, 25);
  assert.equal(latest.readings.D1.received_at_utc, timestamp);
});

test("normalises absent and null readings without adding simulation D3", () => {
  const latest = parseLatestTelemetry({ readings: { D1: null } });
  assert.deepEqual(latest.readings, { D1: null, D2: null, POND: null });
  assert.equal("D3" in latest.readings, false);
});

test("rejects malformed reading IDs, distances and timestamps", () => {
  for (const change of [
    { sensor_id: "D3" },
    { distance_cm: "12.3" },
    { distance_cm: -1 },
    { simulated: "true" },
    { received_at_utc: "yesterday" },
  ]) {
    assert.throws(() => parseLatestTelemetry({
      readings: { ...sample.readings, D1: { ...sample.readings.D1, ...change } },
    }));
  }
});

test("marks readings stale after 10 seconds and rejects future clock skew", () => {
  const reading = parseLatestTelemetry(sample).readings.D1;
  const at = Date.parse(timestamp);
  assert.equal(isFreshTelemetry(reading, at + 10_000), true);
  assert.equal(isFreshTelemetry(reading, at + 10_001), false);
  assert.equal(isFreshTelemetry(reading, at - 5_001), false);
});

test("recognises unchanged telemetry and updates from any channel", () => {
  const first = parseLatestTelemetry(sample);
  const equivalent = parseLatestTelemetry(structuredClone(sample));
  assert.equal(sameLatestTelemetry(first, equivalent), true);
  assert.equal(sameLatestTelemetry(null, equivalent), false);
  const changed = parseLatestTelemetry({
    readings: {
      ...sample.readings,
      POND: { ...sample.readings.POND, received_at_utc: "2026-10-19T01:42:25Z" },
    },
  });
  assert.equal(sameLatestTelemetry(first, changed), false);
});
