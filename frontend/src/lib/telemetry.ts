export const TELEMETRY_SENSOR_IDS = ["D1", "D2", "POND"] as const;
export type TelemetrySensorId = (typeof TELEMETRY_SENSOR_IDS)[number];

export interface TelemetryReading {
  sensor_id: TelemetrySensorId;
  distance_cm: number;
  simulated: boolean;
  received_at_utc: string;
}

export interface LatestTelemetry {
  readings: Record<TelemetrySensorId, TelemetryReading | null>;
}

// A 2 s publisher can miss several cycles before a reading becomes stale.
export const TELEMETRY_STALE_AFTER_MS = 10_000;

export function sameLatestTelemetry(
  previous: LatestTelemetry | null,
  next: LatestTelemetry,
): boolean {
  if (!previous) return false;
  return TELEMETRY_SENSOR_IDS.every((id) => {
    const a = previous.readings[id];
    const b = next.readings[id];
    return a === b || Boolean(
      a && b &&
      a.sensor_id === b.sensor_id &&
      a.distance_cm === b.distance_cm &&
      a.simulated === b.simulated &&
      a.received_at_utc === b.received_at_utc,
    );
  });
}

export function parseLatestTelemetry(value: unknown): LatestTelemetry {
  if (!isRecord(value) || !isRecord(value.readings)) {
    throw new Error("The telemetry response has an invalid format.");
  }

  const readings = {} as LatestTelemetry["readings"];
  for (const id of TELEMETRY_SENSOR_IDS) {
    const reading = value.readings[id];
    if (reading == null) {
      readings[id] = null;
      continue;
    }
    if (
      !isRecord(reading) ||
      reading.sensor_id !== id ||
      typeof reading.distance_cm !== "number" ||
      !Number.isFinite(reading.distance_cm) ||
      reading.distance_cm < 0 ||
      typeof reading.simulated !== "boolean" ||
      typeof reading.received_at_utc !== "string" ||
      !/(?:Z|\+00:00)$/i.test(reading.received_at_utc) ||
      !Number.isFinite(Date.parse(reading.received_at_utc))
    ) {
      throw new Error(`The ${id} telemetry reading is malformed.`);
    }
    readings[id] = reading as unknown as TelemetryReading;
  }
  return { readings };
}

export function telemetryAgeMs(reading: TelemetryReading, now: number): number {
  return now - Date.parse(reading.received_at_utc);
}

export function isFreshTelemetry(reading: TelemetryReading, now: number): boolean {
  const age = telemetryAgeMs(reading, now);
  return age >= -5_000 && age <= TELEMETRY_STALE_AFTER_MS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
