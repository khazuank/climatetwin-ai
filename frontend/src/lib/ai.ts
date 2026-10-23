import type { DemoState, Scenario, ZoneId } from "./demo";

export interface AiForecast {
  horizon_min: 5 | 10 | 20;
  predicted_cm: number;
  threshold_outlook: "LOWER" | "ELEVATED";
  threshold_model_score: number;
  holdout_mae_cm: number;
  holdout_p80_absolute_error_cm: number;
}
export interface AiZone {
  id: ZoneId;
  current_cm: number;
  capacity_cm: number;
  forecasts: AiForecast[];
  factors: { feature: string; observed_value: number; global_mae_increase_cm: number }[];
}
export interface AiBranch {
  available: boolean;
  reason: string | null;
  D2_depth_cm: number | null;
  blocked_road_ids: string[] | null;
  central_route_available: boolean | null;
}
export interface AiResponse {
  schema_version: 1;
  status: "ready" | "unavailable" | "unsupported";
  reason: string | null;
  predicted_at_utc: string;
  simulation_minute: number;
  scenario: Scenario;
  run_id: string;
  model: { version: string; training_source: "SYNTHETIC_SIMULATION";
    scenario_count: number; split: string; metrics: Record<string, {
      mae_cm: number; baseline_mae_cm: number; threshold_precision: number;
      threshold_recall: number; threshold_brier: number;
      below_threshold_rows: number; new_crossing_precision: number;
      new_crossing_recall: number;
    }> } | null;
  zones: AiZone[];
  prediction_history: { minute: number; due_minute: number; zone_id: ZoneId;
    predicted_cm: number; observed_cm: number | null }[];
  intervention: { source: "DETERMINISTIC_SIMULATION"; horizon_min: number;
    assumption: string; p2_off: AiBranch; p2_on: AiBranch;
    D2_reduction_cm: number | null; recommendation: string } | null;
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const zoneIds = ["D1", "D2", "POND"];

export function parseAiResponse(value: unknown): AiResponse {
  if (!object(value) || value.schema_version !== 1 ||
      !["ready", "unavailable", "unsupported"].includes(String(value.status)) ||
      !finite(value.simulation_minute) ||
      !["CLEAR", "MODERATE", "HEAVY", "EXTREME", "GUIDED"].includes(String(value.scenario)) ||
      typeof value.run_id !== "string" || !value.run_id ||
      typeof value.predicted_at_utc !== "string" ||
      !Array.isArray(value.zones) || !Array.isArray(value.prediction_history) ||
      (value.intervention !== null && (!object(value.intervention) ||
        value.intervention.source !== "DETERMINISTIC_SIMULATION" ||
        typeof value.intervention.recommendation !== "string"))) {
    throw new Error("The AI prediction response is malformed.");
  }
  if (value.status === "ready") {
    if (!object(value.model) || typeof value.model.version !== "string" ||
        value.model.training_source !== "SYNTHETIC_SIMULATION" ||
        !object(value.model.metrics) || value.zones.length !== 3 ||
        !value.zones.every((zone: unknown) => object(zone) &&
          zoneIds.includes(String(zone.id)) && finite(zone.current_cm) &&
          Array.isArray(zone.forecasts) && zone.forecasts.length === 3 &&
          zone.forecasts.every((forecast: unknown) => object(forecast) &&
            [5, 10, 20].includes(Number(forecast.horizon_min)) &&
            finite(forecast.predicted_cm) && finite(forecast.holdout_mae_cm) &&
            ["LOWER", "ELEVATED"].includes(String(forecast.threshold_outlook))) &&
          Array.isArray(zone.factors))) {
      throw new Error("The AI forecast or model metadata is malformed.");
    }
  } else if (typeof value.reason !== "string" || value.zones.length !== 0) {
    throw new Error("The unavailable AI state needs an explicit reason.");
  }
  return value as unknown as AiResponse;
}

export function aiZoneHeadline(zone: AiZone, horizon: 5 | 10 | 20 = 10): string {
  const forecast = zone.forecasts.find((item) => item.horizon_min === horizon);
  if (!forecast) throw new Error(`Missing ${horizon}-minute forecast`);
  return `${zone.id}: ${zone.current_cm.toFixed(1)} cm now → ${forecast.predicted_cm.toFixed(1)} cm ML forecast at +${horizon} min`;
}

/** UI-only physical floor. Keep raw model predictions in AiResponse for evaluation. */
export const displayDepthCm = (rawCm: number): number => Math.max(0, rawCm);

export type ChartScale = "detail" | "full";

/** Scale only the operational display; forecast values and model evaluation stay raw. */
export function chartYRange(valuesCm: number[], warningCm: number, scale: ChartScale) {
  const values = valuesCm.filter(Number.isFinite).map(displayDepthCm);
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  if (!values.length || !Number.isFinite(warningCm) || warningCm <= 0) {
    return { min: 0, max: 10, warningVisible: false };
  }
  if (scale === "full") {
    const extent = Math.max(warningCm, highest);
    const step = niceChartStep((extent * 1.12) / 4);
    const max = Math.ceil((extent + Math.max(2, extent * 0.08)) / step) * step;
    return { min: 0, max, warningVisible: true };
  }
  const padding = Math.max(1, (highest - lowest) * 0.15);
  let min = Math.max(0, lowest - padding);
  let max = highest + padding;
  if (max - min < 10) {
    const midpoint = (min + max) / 2;
    min = Math.max(0, midpoint - 5);
    max = min + 10;
  }
  // Use finer rounding for bounds than for grid ticks, so a wide range does
  // not snap its lower edge all the way to zero.
  const step = niceChartStep((max - min) / 12);
  min = Math.max(0, Math.floor(min / step) * step);
  max = Math.ceil(max / step) * step;
  if (max - min < 10) max = min + 10;
  return { min, max, warningVisible: warningCm >= min && warningCm <= max };
}

function niceChartStep(target: number) {
  const power = 10 ** Math.floor(Math.log10(target));
  const normalized = target / power;
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * power;
}

export function trainedCapacityForecast(state: Pick<DemoState, "minute" | "zones"> & Partial<Pick<DemoState, "scenario" | "run_id">>,
                                        ai: AiResponse | null, zoneId: ZoneId,
                                        horizon: 5 | 10 | 20) {
  if (ai?.status !== "ready" ||
      (state.scenario && ai.scenario !== state.scenario) ||
      (state.run_id && ai.run_id !== state.run_id) ||
      Math.abs(ai.simulation_minute - state.minute) > 1) return null;
  const capacity = state.zones.find((zone) => zone.id === zoneId)?.capacity_cm;
  const forecast = ai.zones.find((zone) => zone.id === zoneId)?.forecasts.find((item) => item.horizon_min === horizon);
  if (!capacity || !forecast) return null;
  const displayed = displayDepthCm(forecast.predicted_cm);
  return { horizon_min: horizon, predicted_cm: displayed,
    percent: displayed / capacity * 100,
    threshold_outlook: forecast.threshold_outlook, source: "TRAINED_ML" as const };
}

export function buildAiChart(state: DemoState, zoneId: ZoneId, ai: AiResponse | null) {
  const observed = state.history.slice(-24).map((row) => ({ minute: row.minute, cm: row.depths_cm[zoneId] }));
  const zone = ai?.status === "ready" && ai.scenario === state.scenario && ai.run_id === state.run_id
    ? ai.zones.find((item) => item.id === zoneId) : null;
  const forecast = zone ? [
    { minute: ai!.simulation_minute, cm: zone.current_cm },
    ...zone.forecasts.map((item) => ({
      minute: ai!.simulation_minute + item.horizon_min, cm: displayDepthCm(item.predicted_cm),
    })),
  ] : [];
  const verified = ai?.prediction_history.filter((item) =>
    item.zone_id === zoneId && item.observed_cm !== null).slice(-3) ?? [];
  return { observed, forecast, verified };
}
