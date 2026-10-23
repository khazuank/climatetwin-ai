export type ZoneId = "D1" | "D2" | "POND";
export type Risk = "NORMAL" | "WATCH" | "WARNING" | "CRITICAL";
export type Role = "management" | "resident";
export type Scenario = "CLEAR" | "MODERATE" | "HEAVY" | "EXTREME" | "GUIDED";
export type TravelMode = "WALK" | "CAR" | "MOTORCYCLE";
export type Point = { x: number; y: number };
export type ThresholdEta = { status: "FLOODED_NOW" | "ESTIMATED" | "NOT_PREDICTED" | "UNAVAILABLE"; minutes: number | null };

export function etaLabel(eta: ThresholdEta, horizon: number): string {
  if (eta.status === "FLOODED_NOW") return "Threshold crossed now";
  if (eta.status === "ESTIMATED") return `Est. ${Math.ceil(eta.minutes ?? 0)} simulated min`;
  if (eta.status === "NOT_PREDICTED") return `Not predicted within ${horizon} min`;
  return "Estimate unavailable";
}

export interface DemoZone {
  id: ZoneId; name: string; position: Point; depth_cm: number; capacity_cm: number;
  capacity_percent: number; trend: "INSUFFICIENT" | "STABLE" | "RISING" | "FALLING";
  rate_cm_min: number | null; risk: Risk; projected_threshold_minutes: number | null;
  flood_threshold_cm: number; flood_eta: ThresholdEta; forecast_10_min_cm: number;
  baseline_forecasts: { horizon_min: 5 | 10 | 20; predicted_cm: number }[];
  forecast_note: string; road_hazard_cm: number;
  linked_road_ids: string[]; linked_house_ids: string[]; explanation: string;
}

/** Current water depth as a percentage of this zone's warning level. */
export function warningLevelPercent(zone: Pick<DemoZone, "depth_cm" | "flood_threshold_cm">): number {
  return zone.depth_cm / zone.flood_threshold_cm * 100;
}
export interface DemoRoad {
  id: string; start_node: string; end_node: string; weight: number;
  zone_id: ZoneId; via: Point[]; accessible: boolean; reason: string;
  distance_m: number; walk_minutes: number; status: "OPEN" | "AT_RISK" | "CLOSED";
  road_class: "MAIN" | "RESIDENTIAL" | "PEDESTRIAN";
  allowed_modes: TravelMode[];
  closure_eta: ThresholdEta;
}
export interface DemoRouteSegment {
  road_id: string; distance_m: number; walk_minutes: number; travel_minutes: number; arrival_min: number;
  closure_eta_min: number | null; margin_min: number | null; exposure: number;
}
export interface DemoRoute {
  home_id: string; shelter_id: string; available: boolean;
  road_ids: string[]; node_ids: string[]; total_weight: number | null;
  message: string; reason: string;
  kind: "recommended" | "fastest" | "shortest" | "alternative";
  distance_m: number | null; walk_minutes: number | null; travel_minutes: number | null; mode: TravelMode;
  safety_margin_min: number | null; earliest_closure_min: number | null;
  exposure_score: number | null; segments: DemoRouteSegment[];
  forecast_assessment: "NO_ROUTE" | "CLOSURE_MARGIN" | "WINDOW_CLEAR";
}
export function routeSafetyLabel(route: DemoRoute, horizon: number): string {
  if (!route.available) return "No feasible route in the current simulation.";
  if (route.safety_margin_min !== null) {
    return `Tightest projected road margin: ${route.safety_margin_min.toFixed(1)} simulated min after that road is traversed.`;
  }
  return `No route road is projected to close within ${horizon} simulated min. Beyond that window is unknown.`;
}
/** Node-adjacent roads are evidence about access, not a home inundation model. */
export function assessHome(state: DemoState, homeId: string) {
  const home = state.houses.find((item) => item.id === homeId);
  if (!home) return null;
  const zone = state.zones.find((item) => item.id === home.zone_id);
  if (!zone) return null;
  const roads = state.roads.filter((road) =>
    road.start_node === home.node_id || road.end_node === home.node_id);
  const counts = {
    open: roads.filter((road) => road.status === "OPEN").length,
    atRisk: roads.filter((road) => road.status === "AT_RISK").length,
    closed: roads.filter((road) => road.status === "CLOSED").length,
  };
  const access = roads.length === 0 ? "UNKNOWN" :
    counts.open === 0 && counts.atRisk === 0 ? "CLOSED" :
    counts.closed || counts.atRisk ? "RESTRICTED" : "OPEN";
  return { home, zone, roads, counts, access, homeFloodRisk: "UNKNOWN" as const };
}

export function travelDurationLabel(minutes: number | null): string {
  if (minutes === null) return "Unavailable";
  return minutes < 1 ? "Under 1 min" : `${minutes.toFixed(1)} min`;
}

export function mentionedRoadId(recommendation: string, roads: Pick<DemoRoad, "id">[]): string | null {
  const id = recommendation.match(/\bR\d+\b/)?.[0];
  return roads.find((road) => road.id === id)?.id ?? null;
}
export interface PumpBranch {
  available: boolean; reason: string | null; depth_cm: number | null;
  flood_eta: ThresholdEta | null; closed_road_ids: string[] | null;
}
export interface PumpOutlook {
  pump_id: "P1" | "P2"; zone_id: ZoneId; horizon_min: number;
  off: PumpBranch; on: PumpBranch; depth_reduction_cm: number | null;
  source: "DETERMINISTIC_SIMULATION";
}
export interface DemoEvent {
  id: number; minute: number; timestamp_utc: string; title: string;
  description: string; kind: string; severity: Risk;
  audience: Role | "both"; location: string;
  acknowledged_by: Record<Role, boolean>;
}
export interface DemoState {
  source: "SYNTHETIC_DEMO"; version: number; run_id: string; server_timestamp_utc: string;
  minute: number; simulated_time: string; speed: number; paused: boolean;
  scenario: Scenario; rainfall_mm_h: number; target_rainfall_mm_h: number;
  overall_risk: Risk; zones: DemoZone[];
  pumps: { id: "P1" | "P2"; zone_id: ZoneId; capacity_m3_min: number;
    minimum_depth_cm: number; position: Point; on: boolean }[];
  roads: DemoRoad[];
  nodes: { id: string; position: Point }[];
  houses: { id: string; name: string; node_id: string; zone_id: ZoneId; position: Point }[];
  shelter: { id: string; name: string; node_id: string; position: Point; status: string };
  school: { id: string; name: string; position: Point };
  time_model: { forecast_horizon_min: number; map_width_m: number;
    map_height_m: number; walk_speed_m_min: number;
    mode_speed_m_min: Record<TravelMode, number>; junction_delay_min: Record<TravelMode, number>; note: string };
  route: DemoRoute;
  route_options: DemoRoute[];
  pump_outlooks: PumpOutlook[];
  incidents: { id: string; kind: "ROAD_BLOCKED" | "ZONE_RISK"; location: string; description: string }[];
  notifications: DemoEvent[]; events: DemoEvent[];
  history: { minute: number; rainfall_mm_h: number; depths_cm: Record<ZoneId, number> }[];
  recommendation: string; total_spill_m3: number;
}

export type DemoCommand =
  | { action: "set_scenario"; scenario: Exclude<Scenario, "GUIDED"> }
  | { action: "run_demo" }
  | { action: "set_speed"; speed: 0.5 | 1 | 2 | 4 }
  | { action: "set_paused"; paused: boolean }
  | { action: "set_pump"; pump_id: "P1" | "P2"; on: boolean };

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function point(value: unknown): boolean {
  return object(value) && finite(value.x) && finite(value.y) &&
    value.x >= 0 && value.x <= 1 && value.y >= 0 && value.y <= 1;
}
const risks = ["NORMAL", "WATCH", "WARNING", "CRITICAL"];

export function compareZonePriority(
  a: Pick<DemoZone, "risk" | "capacity_percent">,
  b: Pick<DemoZone, "risk" | "capacity_percent">,
): number {
  return risks.indexOf(b.risk) - risks.indexOf(a.risk) ||
    b.capacity_percent - a.capacity_percent;
}

/** Validate the contract at the browser boundary before showing operational data. */
export function parseDemoState(value: unknown): DemoState {
  if (!object(value) || value.source !== "SYNTHETIC_DEMO" ||
      typeof value.run_id !== "string" || !value.run_id ||
      !finite(value.minute) || !finite(value.speed) ||
      typeof value.paused !== "boolean" || !finite(value.rainfall_mm_h) ||
      !risks.includes(String(value.overall_risk)) || !Array.isArray(value.zones) ||
      !Array.isArray(value.roads) || !Array.isArray(value.pumps) ||
      !Array.isArray(value.nodes) || !Array.isArray(value.houses) ||
      !Array.isArray(value.history) || !Array.isArray(value.events) ||
      !Array.isArray(value.notifications) || !Array.isArray(value.incidents) ||
      !object(value.route) || !object(value.shelter) || !object(value.school) ||
      !object(value.time_model) || !Array.isArray(value.route_options) ||
      !Array.isArray(value.pump_outlooks) ||
      typeof value.simulated_time !== "string" || typeof value.recommendation !== "string") {
    throw new Error("The demo state response is malformed.");
  }
  const timeModel = value.time_model as Record<string, unknown>;
  const modeSpeeds = timeModel.mode_speed_m_min as Record<string, unknown>;
  const junctionDelays = timeModel.junction_delay_min as Record<string, unknown>;
  if (!value.zones.every((zone: unknown) => object(zone) &&
      ["D1", "D2", "POND"].includes(String(zone.id)) && finite(zone.depth_cm) &&
      finite(zone.capacity_cm) && finite(zone.forecast_10_min_cm) && point(zone.position) &&
      risks.includes(String(zone.risk)) && finite(zone.flood_threshold_cm) && object(zone.flood_eta) &&
      Array.isArray(zone.baseline_forecasts)) ||
      !value.roads.every((road: unknown) => object(road) &&
        typeof road.id === "string" && typeof road.accessible === "boolean" &&
        Array.isArray(road.via) && road.via.every(point) && finite(road.distance_m) &&
        finite(road.walk_minutes) && object(road.closure_eta) &&
        Array.isArray(road.allowed_modes) && typeof road.road_class === "string") ||
      !value.nodes.every((node: unknown) => object(node) && point(node.position)) ||
      !value.houses.every((home: unknown) => object(home) && point(home.position)) ||
      !value.pumps.every((pump: unknown) => object(pump) && point(pump.position) &&
        typeof pump.on === "boolean") ||
      !point(value.shelter.position) || !point(value.school.position) ||
      !Array.isArray(value.route.road_ids) || typeof value.route.available !== "boolean" ||
      !["WALK", "CAR", "MOTORCYCLE"].includes(String(value.route.mode)) ||
      (value.route.available && !finite(value.route.travel_minutes)) ||
      !value.route_options.every((route: unknown) => object(route) && Array.isArray(route.road_ids) &&
        ["WALK", "CAR", "MOTORCYCLE"].includes(String(route.mode)) && finite(route.travel_minutes)) ||
      !finite(timeModel.walk_speed_m_min) ||
      !object(modeSpeeds) || !object(junctionDelays) ||
      !(["WALK", "CAR", "MOTORCYCLE"] as const).every((mode) =>
        finite(modeSpeeds[mode]) && finite(junctionDelays[mode]))) {
    throw new Error("The demo map or route response is malformed.");
  }
  return value as unknown as DemoState;
}
