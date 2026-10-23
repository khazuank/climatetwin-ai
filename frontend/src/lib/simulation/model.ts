import type {
  HistoryPoint,
  OperationalEvent,
  RiskLevel,
  SensorReading,
  SimulationAction,
  SimulationState,
  ZoneId,
} from "./types";

export const TICK_INTERVAL_MS = 1200;
export const RISK_LABELS: Record<RiskLevel, string> = {
  low: "Low",
  watch: "Elevated",
  high: "High",
  critical: "Critical",
};
export const RISK_COLORS: Record<RiskLevel, string> = {
  low: "#42c9a0",
  watch: "#e9bf64",
  high: "#ee944c",
  critical: "#f16f78",
};
export const ZONE_NAMES: Record<ZoneId, string> = {
  "zone-a": "Residential Zone A",
  "zone-b": "Residential Zone B",
  "zone-c": "Residential Zone C",
};
const round = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

export function formatTime(minute: number) {
  const total = (((14 * 60 + minute) % 1440) + 1440) % 1440;
  return `${Math.floor(total / 60)
    .toString()
    .padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
}
export function riskLevel(sensor: SensorReading): RiskLevel {
  const ratio = sensor.level / sensor.criticalLevel;
  if (ratio >= 0.95) return "critical";
  if (ratio >= 0.78) return "high";
  if (ratio >= 0.55) return "watch";
  return "low";
}
/** A deterministic operational index, never a calibrated probability. */
export function riskScore(sensor: SensorReading, rainfall: number) {
  return Math.round(
    clamp(
      (sensor.level / sensor.criticalLevel) * 78 +
        Math.max(0, sensor.trend) * 120 +
        rainfall * 0.18,
      0,
      100,
    ),
  );
}
export function overflowMinutes(sensor: SensorReading): number | null {
  if (sensor.level >= sensor.criticalLevel) return 0;
  if (sensor.trend <= 0) return null;
  return Math.ceil((sensor.criticalLevel - sensor.level) / sensor.trend);
}
export function criticalSensor(sensors: SensorReading[]) {
  return sensors.reduce((a, b) =>
    a.level / a.criticalLevel > b.level / b.criticalLevel ? a : b,
  );
}
function snapshot(
  minute: number,
  sensors: SensorReading[],
  rainfall: number,
): HistoryPoint {
  return {
    minute,
    time: formatTime(minute),
    rainfall,
    D1: sensors.find((s) => s.id === "D1")!.level,
    D2: sensors.find((s) => s.id === "D2")!.level,
    D3: sensors.find((s) => s.id === "D3")!.level,
  };
}
export function createInitialState(): SimulationState {
  const sensors: SensorReading[] = [
    {
      id: "D1",
      name: "North residential drain",
      zone: "zone-a",
      level: 0.82,
      criticalLevel: 2.4,
      trend: 0.006,
      online: true,
      source: "simulation",
    },
    {
      id: "D2",
      name: "Central drainage junction",
      zone: "zone-b",
      level: 1.54,
      criticalLevel: 2.4,
      trend: 0.016,
      online: true,
      source: "simulation",
    },
    {
      id: "D3",
      name: "East residential drain",
      zone: "zone-c",
      level: 0.68,
      criticalLevel: 2.1,
      trend: 0.004,
      online: true,
      source: "simulation",
    },
  ];
  const history = Array.from({ length: 31 }, (_, i) => {
    const minute = i - 30;
    return snapshot(
      minute,
      sensors.map((s) => ({
        ...s,
        level: round(s.level + minute * s.trend + Math.sin(i * 0.65) * 0.012),
      })),
      18,
    );
  });
  history[30] = snapshot(0, sensors, 18);
  return {
    phase: "standby",
    minute: 0,
    rainfall: 18,
    sensors,
    history,
    paused: false,
    nextEventId: 4,
    events: [
      {
        id: 3,
        minute: 0,
        title: "D2 water level elevated",
        description:
          "Central junction at 64% of critical depth. Monitor the rising trend.",
        severity: "watch",
        kind: "risk",
        acknowledged: false,
      },
      {
        id: 2,
        minute: -8,
        title: "Rainfall detected",
        description: "Modelled rainfall assumption set to 18 mm/h.",
        severity: "low",
        kind: "rain",
        acknowledged: false,
      },
      {
        id: 1,
        minute: -30,
        title: "Simulation environment ready",
        description:
          "Three simulated drain sensors online. No hardware connected.",
        severity: "low",
        kind: "system",
        acknowledged: true,
      },
    ],
  };
}
function addEvent(
  state: SimulationState,
  event: Omit<OperationalEvent, "id" | "minute" | "acknowledged">,
): SimulationState {
  return {
    ...state,
    nextEventId: state.nextEventId + 1,
    events: [
      {
        ...event,
        id: state.nextEventId,
        minute: state.minute,
        acknowledged: false,
      },
      ...state.events,
    ].slice(0, 60),
  };
}
export function simulationReducer(
  state: SimulationState,
  action: SimulationAction,
): SimulationState {
  switch (action.type) {
    case "RESET":
      return createInitialState();
    case "ACKNOWLEDGE":
      return {
        ...state,
        events: state.events.map((e) =>
          e.id === action.id ? { ...e, acknowledged: true } : e,
        ),
      };
    case "TOGGLE_PAUSE":
      return state.phase === "storm" || state.phase === "pumping"
        ? { ...state, paused: !state.paused }
        : state;
    case "START_STORM":
      if (state.phase === "storm") return state;
      return addEvent(
        { ...state, phase: "storm", paused: false },
        {
          title: "Storm simulation started",
          description:
            "Rainfall and inflow will increase each simulated minute, strongest at D2.",
          severity: "watch",
          kind: "rain",
        },
      );
    case "START_PUMP":
      if (state.phase === "pumping" || state.phase === "recovered")
        return state;
      return addEvent(
        { ...state, phase: "pumping", paused: false },
        {
          title: "P2 intervention simulated",
          description:
            "Modelled drawdown active. This does not operate a physical pump.",
          severity: "low",
          kind: "pump",
        },
      );
    case "TICK": {
      if (
        state.paused ||
        (state.phase !== "storm" && state.phase !== "pumping")
      )
        return state;
      const pumping = state.phase === "pumping";
      const rainfall = pumping
        ? Math.max(6, state.rainfall - 5)
        : Math.min(96, state.rainfall + 6);
      const sensors = state.sensors.map((s) => {
        const inflow =
          s.id === "D2"
            ? 0.023 + rainfall * 0.00078
            : s.id === "D1"
              ? 0.008 + rainfall * 0.00028
              : 0.005 + rainfall * 0.00021;
        const rate = pumping
          ? s.id === "D2"
            ? -0.085
            : s.id === "D1"
              ? -0.033
              : -0.026
          : inflow;
        const level = round(clamp(s.level + rate, 0.38, s.criticalLevel * 1.3));
        return { ...s, level, trend: round(level - s.level) };
      });
      let next: SimulationState = {
        ...state,
        minute: state.minute + 1,
        rainfall,
        sensors,
        history: [
          ...state.history,
          snapshot(state.minute + 1, sensors, rainfall),
        ].slice(-180),
      };
      for (const sensor of sensors) {
        const previous = state.sensors.find((s) => s.id === sensor.id)!;
        if (riskLevel(previous) !== riskLevel(sensor))
          next = addEvent(next, {
            title: `${sensor.id} risk ${pumping ? "reduced" : "increased"} to ${RISK_LABELS[riskLevel(sensor)].toLowerCase()}`,
            description: `${sensor.level.toFixed(2)} m · ${ZONE_NAMES[sensor.zone]} · simulation estimate.`,
            severity: riskLevel(sensor),
            kind: "risk",
          });
        if (
          previous.level < sensor.criticalLevel &&
          sensor.level >= sensor.criticalLevel
        )
          next = addEvent(next, {
            title: `${sensor.id} modelled overflow threshold reached`,
            description:
              "Simulated water depth exceeds the configured drain capacity. Prioritise response.",
            severity: "critical",
            kind: "risk",
          });
      }
      if (pumping && sensors.every((s) => s.level <= 0.8))
        next = addEvent(
          { ...next, phase: "recovered" },
          {
            title: "Recovery verified in simulation",
            description:
              "All modelled drains are below 0.80 m. Pump scenario complete.",
            severity: "low",
            kind: "pump",
          },
        );
      return next;
    }
  }
}
