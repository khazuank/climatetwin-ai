import { TELEMETRY_SENSOR_IDS, type TelemetrySensorId } from "./telemetry";

export type WarningState = "NORMAL" | "WATCH" | "WARNING" | "CRITICAL" | "UNKNOWN";
export type MeasurementQuality =
  | "MISSING" | "STALE" | "INVALID" | "BLIND_ZONE" | "OUT_OF_RANGE"
  | "SPIKE" | "UNCALIBRATED" | "RANGE_VALID" | "VALID";
export type CalibrationStatus = "UNCONFIGURED" | "UNVERIFIED" | "VERIFIED";
export type Trend = "UNKNOWN" | "INSUFFICIENT" | "STABLE" | "RISING" | "FALLING";

export interface SensorIntelligence {
  sensor_id: TelemetrySensorId;
  source: "physical";
  latest_distance_cm: number | null;
  received_at_utc: string | null;
  age_seconds: number | null;
  water_depth_cm: number | null;
  overflow_fill_percent: number | null;
  rise_rate_cm_per_min: number | null;
  trend: Trend;
  estimated_overflow_minutes: number | null;
  measurement_quality: MeasurementQuality;
  calibration_status: CalibrationStatus;
  calibration: {
    sensor_height_cm: number | null;
    overflow_height_cm: number | null;
    minimum_reliable_distance_cm: number | null;
  };
  warning_state: WarningState;
  explanation: string;
  recommendation: string;
  recent_depths: { received_at_utc: string; water_depth_cm: number }[];
}

export interface IntelligenceSnapshot {
  method: "RULE_BASED_LINEAR_TREND";
  server_timestamp_utc: string;
  overall_warning_state: WarningState;
  coverage_complete: boolean;
  sensors: Record<TelemetrySensorId, SensorIntelligence>;
  transitions: {
    sensor_id: TelemetrySensorId;
    from_state: WarningState;
    to_state: WarningState;
    at_utc: string;
    reason: string;
  }[];
}

const warningStates = ["NORMAL", "WATCH", "WARNING", "CRITICAL", "UNKNOWN"];
const qualities = ["MISSING", "STALE", "INVALID", "BLIND_ZONE", "OUT_OF_RANGE", "SPIKE", "UNCALIBRATED", "RANGE_VALID", "VALID"];
const calibrations = ["UNCONFIGURED", "UNVERIFIED", "VERIFIED"];
const trends = ["UNKNOWN", "INSUFFICIENT", "STABLE", "RISING", "FALLING"];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableNumber(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function timestamp(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function parseIntelligence(value: unknown): IntelligenceSnapshot {
  if (!record(value) || value.method !== "RULE_BASED_LINEAR_TREND" ||
      !timestamp(value.server_timestamp_utc) ||
      !warningStates.includes(String(value.overall_warning_state)) ||
      typeof value.coverage_complete !== "boolean" || !record(value.sensors) ||
      !Array.isArray(value.transitions)) {
    throw new Error("The intelligence response has an invalid format.");
  }
  for (const id of TELEMETRY_SENSOR_IDS) {
    const sensor = value.sensors[id];
    if (!record(sensor) || sensor.sensor_id !== id || sensor.source !== "physical" ||
        !nullableNumber(sensor.latest_distance_cm) ||
        !(sensor.received_at_utc === null || timestamp(sensor.received_at_utc)) ||
        !nullableNumber(sensor.age_seconds) ||
        !nullableNumber(sensor.water_depth_cm) ||
        !nullableNumber(sensor.overflow_fill_percent) ||
        !nullableNumber(sensor.rise_rate_cm_per_min) ||
        !nullableNumber(sensor.estimated_overflow_minutes) ||
        !warningStates.includes(String(sensor.warning_state)) ||
        !qualities.includes(String(sensor.measurement_quality)) ||
        !calibrations.includes(String(sensor.calibration_status)) ||
        !trends.includes(String(sensor.trend)) ||
        typeof sensor.explanation !== "string" ||
        typeof sensor.recommendation !== "string" ||
        !record(sensor.calibration) ||
        !nullableNumber(sensor.calibration.sensor_height_cm) ||
        !nullableNumber(sensor.calibration.overflow_height_cm) ||
        !nullableNumber(sensor.calibration.minimum_reliable_distance_cm) ||
        !Array.isArray(sensor.recent_depths) ||
        !sensor.recent_depths.every((point: unknown) =>
          record(point) && timestamp(point.received_at_utc) &&
          typeof point.water_depth_cm === "number" && Number.isFinite(point.water_depth_cm))) {
      throw new Error(`The ${id} intelligence result is malformed.`);
    }
  }
  return value as unknown as IntelligenceSnapshot;
}
