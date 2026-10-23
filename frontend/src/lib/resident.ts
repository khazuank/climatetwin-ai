import type { DemoRoute, DemoState } from "./demo";

export type ResidentForecast = {
  source: "TRAINED_ML";
  status: "ready" | "unavailable" | "unsupported";
  run_id: string;
  simulation_minute: number;
  predicted_at_utc: string;
  zones: { id: "D1" | "D2" | "POND"; forecasts: {
    horizon_min: 10 | 20; predicted_cm: number }[] }[];
};

export type ResidentState = Pick<DemoState, "source" | "version" | "run_id" | "server_timestamp_utc" |
  "minute" | "simulated_time" | "overall_risk" | "zones" | "roads" | "nodes" | "houses" |
  "shelter" | "school" | "time_model" | "route" | "route_options"> & {
    forecast: ResidentForecast;
    notifications: { id: number; minute: number; title: string; description: string;
      severity: DemoState["overall_risk"]; location: string }[];
  };

export function parseResidentState(value: unknown): ResidentState {
  if (!value || typeof value !== "object") throw new Error("Resident data is unavailable.");
  const state = value as Record<string, unknown>;
  if (state.source !== "SYNTHETIC_DEMO" || typeof state.run_id !== "string" ||
      typeof state.minute !== "number" || typeof state.server_timestamp_utc !== "string" ||
      !Array.isArray(state.zones) || !Array.isArray(state.roads) || !Array.isArray(state.houses) ||
      !Array.isArray(state.nodes) || !Array.isArray(state.route_options) ||
      !Array.isArray(state.notifications) || !state.route || !state.shelter ||
      !state.forecast || typeof state.forecast !== "object") {
    throw new Error("Resident data is malformed.");
  }
  const forecast = state.forecast as Record<string, unknown>;
  if (forecast.source !== "TRAINED_ML" ||
      !["ready", "unavailable", "unsupported"].includes(String(forecast.status)) ||
      typeof forecast.run_id !== "string" || typeof forecast.simulation_minute !== "number" ||
      typeof forecast.predicted_at_utc !== "string" || !Array.isArray(forecast.zones) ||
      (forecast.status === "ready" && (forecast.zones.length !== 3 ||
        !forecast.zones.every((zone: unknown) => {
          if (!zone || typeof zone !== "object") return false;
          const item = zone as Record<string, unknown>;
          return ["D1", "D2", "POND"].includes(String(item.id)) && Array.isArray(item.forecasts) &&
            item.forecasts.length === 2 && item.forecasts.every((value: unknown) => {
              if (!value || typeof value !== "object") return false;
              const level = value as Record<string, unknown>;
              return [10, 20].includes(Number(level.horizon_min)) &&
                typeof level.predicted_cm === "number" && Number.isFinite(level.predicted_cm);
            });
        }))) || (forecast.status !== "ready" && forecast.zones.length !== 0)) {
    throw new Error("Resident forecast data is malformed.");
  }
  return state as ResidentState;
}

/** Server timestamps change on every poll even when the visible township does not. */
export function sameResidentView(previous: ResidentState, next: ResidentState): boolean {
  const { server_timestamp_utc: _previousTime, ...previousView } = previous;
  const { server_timestamp_utc: _nextTime, ...nextView } = next;
  void _previousTime;
  void _nextTime;
  return JSON.stringify({ ...previousView, forecast: { ...previousView.forecast, predicted_at_utc: "" } }) ===
    JSON.stringify({ ...nextView, forecast: { ...nextView.forecast, predicted_at_utc: "" } });
}

/** A percentage of the zone's configured warning level, never a flood probability. */
export function residentLevelPercent(depthCm: number | null, warningCm: number | null): number | null {
  if (depthCm === null || warningCm === null || !Number.isFinite(depthCm) ||
      !Number.isFinite(warningCm) || warningCm <= 0) return null;
  return Math.max(0, depthCm) / warningCm * 100;
}

export function residentSummary(state: ResidentState, homeId: string) {
  const home = state.houses.find((item) => item.id === homeId);
  const zone = state.zones.find((item) => item.id === home?.zone_id);
  const nearby = state.roads.filter((road) => road.start_node === home?.node_id || road.end_node === home?.node_id);
  const closed = nearby.filter((road) => road.status === "CLOSED").length;
  const atRisk = nearby.filter((road) => road.status === "AT_RISK").length;
  const forecastConcern = nearby.some((road) => road.closure_eta?.status === "ESTIMATED" ||
    road.closure_eta?.status === "FLOODED_NOW") || zone?.flood_eta?.status === "ESTIMATED";
  const level = !home || !zone || !["NORMAL", "WATCH", "WARNING", "CRITICAL"].includes(zone.risk) ||
    nearby.length === 0 || nearby.some((road) => !["OPEN", "AT_RISK", "CLOSED"].includes(road.status)) ? "unavailable" :
    closed || zone.risk === "WARNING" || zone.risk === "CRITICAL" ||
    nearby.some((road) => road.closure_eta?.status === "FLOODED_NOW") ? "danger" :
    atRisk || zone.risk === "WATCH" || forecastConcern ? "caution" : "normal";
  const title = level === "danger" ? closed ? "Flooding is affecting nearby roads" : "Serious flood risk nearby" :
    level === "caution" ? "Flood risk is increasing nearby" :
    level === "normal" ? "Nearby roads are open" : "Conditions unavailable";
  const detail = level === "danger" ? closed
    ? `${closed} nearby ${closed === 1 ? "road is" : "roads are"} closed. Check the available route to the community shelter.`
    : "The nearby drainage area has a serious flood warning. Check the shelter route and road updates." :
    level === "caution" ? atRisk
      ? `${atRisk} nearby ${atRisk === 1 ? "road is" : "roads are"} at risk and may become difficult to use.`
      : "Nearby drainage conditions or forecasts indicate roads may become difficult to use." :
    level === "normal" ? "No nearby roads are currently affected by flooding." :
    "Current nearby road or drainage information is unavailable.";
  return { home, zone, nearby, closed, atRisk, level, title, detail };
}

/** Accept only current walking routes whose full path remains open to pedestrians. */
export function usableResidentRoutes(state: ResidentState, homeId: string): DemoRoute[] {
  const roads = new Map(state.roads.map((road) => [road.id, road]));
  const valid = (route: DemoRoute) => route.home_id === homeId && route.shelter_id === state.shelter.id &&
    route.mode === "WALK" && route.available && route.road_ids.length > 0 &&
    route.road_ids.every((id) => {
      const road = roads.get(id);
      return road && road.status !== "CLOSED" && road.accessible !== false &&
        (!road.allowed_modes || road.allowed_modes.includes("WALK"));
    });
  const candidates = [state.route, ...state.route_options].filter(valid);
  return candidates.filter((route, index) => candidates.findIndex((other) => other.road_ids.join() === route.road_ids.join()) === index);
}
