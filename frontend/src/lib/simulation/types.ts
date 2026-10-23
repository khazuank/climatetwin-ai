export type SensorId = "D1" | "D2" | "D3";
export type RiskLevel = "low" | "watch" | "high" | "critical";
export type ScenarioPhase = "standby" | "storm" | "pumping" | "recovered";
export type ZoneId = "zone-a" | "zone-b" | "zone-c";
export type MapSelection =
  SensorId | ZoneId | "pond" | "school" | "shelter" | "pump";

/** Device-independent telemetry contract; a future adapter can normalise ESP32/FastAPI readings here. */
export interface SensorReading {
  id: SensorId;
  name: string;
  zone: ZoneId;
  level: number;
  criticalLevel: number;
  trend: number;
  online: boolean;
  source: "simulation";
}
export interface HistoryPoint {
  minute: number;
  time: string;
  D1: number;
  D2: number;
  D3: number;
  rainfall: number;
}
export interface OperationalEvent {
  id: number;
  minute: number;
  title: string;
  description: string;
  severity: RiskLevel;
  kind: "system" | "risk" | "pump" | "rain";
  acknowledged: boolean;
}
export interface SimulationState {
  phase: ScenarioPhase;
  minute: number;
  rainfall: number;
  sensors: SensorReading[];
  history: HistoryPoint[];
  events: OperationalEvent[];
  nextEventId: number;
  paused: boolean;
}
export type SimulationAction =
  | { type: "START_STORM" }
  | { type: "START_PUMP" }
  | { type: "TICK" }
  | { type: "TOGGLE_PAUSE" }
  | { type: "ACKNOWLEDGE"; id: number }
  | { type: "RESET" };
