"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  Clock3,
  CloudRain,
  FlaskConical,
  Gauge,
  History,
  Info,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Waves,
  Wind,
  type LucideIcon,
} from "lucide-react";
import { useSimulation } from "./simulation-provider";
import { Badge, IconButton, PanelHeading } from "./ui";
import {
  criticalSensor,
  formatTime,
  overflowMinutes,
  RISK_COLORS,
  RISK_LABELS,
  riskLevel,
  riskScore,
  ZONE_NAMES,
} from "@/lib/simulation/model";
import type {
  OperationalEvent,
  RiskLevel,
  SensorReading,
} from "@/lib/simulation/types";

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const min = Math.min(...values) - 0.03;
  const max = Math.max(...values) + 0.03;
  const points = values
    .map(
      (v, i) =>
        `${(i / Math.max(1, values.length - 1)) * 100},${29 - ((v - min) / (max - min)) * 25}`,
    )
    .join(" ");
  return (
    <svg className="sparkline" viewBox="0 0 104 34" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="100"
        cy={29 - ((values.at(-1)! - min) / (max - min)) * 25}
        r="2.3"
        fill={color}
      />
    </svg>
  );
}
function Metric({
  title,
  icon: Icon,
  value,
  unit,
  detail,
  tone,
  children,
}: {
  title: string;
  icon: LucideIcon;
  value: string;
  unit?: string;
  detail: string;
  tone: RiskLevel | "cyan";
  children?: React.ReactNode;
}) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <div className="metric-heading">
        <span>{title}</span>
        <Icon size={16} />
      </div>
      <div className="metric-value">
        {value}
        {unit && <span>{unit}</span>}
      </div>
      <div className="metric-bottom">
        <span className="metric-detail">{detail}</span>
        {children}
      </div>
    </article>
  );
}
export function Metrics() {
  const { state } = useSimulation();
  const critical = criticalSensor(state.sensors);
  const highest = state.sensors.reduce((a, b) => (a.level >= b.level ? a : b));
  const risk = riskLevel(critical);
  const eta = overflowMinutes(critical);
  const history = state.history.slice(-22);
  return (
    <div className="metrics-grid">
      <Metric
        title="Overall flood risk"
        icon={ShieldCheck}
        value={RISK_LABELS[risk]}
        detail={`${riskScore(critical, state.rainfall)} / 100 · simulation index`}
        tone={risk}
      >
        <div className="risk-segments">
          {["low", "watch", "high", "critical"].map((r, i) => (
            <i
              key={r}
              style={{
                background:
                  i <= ["low", "watch", "high", "critical"].indexOf(risk)
                    ? RISK_COLORS[r as RiskLevel]
                    : "#2a3544",
              }}
            />
          ))}
        </div>
      </Metric>
      <Metric
        title="Highest drain water level"
        icon={Waves}
        value={highest.level.toFixed(2)}
        unit="m"
        detail={`${highest.id} · ${Math.round((highest.level / highest.criticalLevel) * 100)}% of critical depth`}
        tone={riskLevel(highest)}
      >
        <Sparkline
          values={history.map((p) => p[highest.id])}
          color={RISK_COLORS[riskLevel(highest)]}
        />
      </Metric>
      <Metric
        title="Online sensors"
        icon={Radio}
        value={String(state.sensors.filter((s) => s.online).length).padStart(
          2,
          "0",
        )}
        unit={`/ ${String(state.sensors.length).padStart(2, "0")}`}
        detail="All simulated sensors reporting"
        tone="low"
      >
        <span className="small-status">
          <span className="status-dot" /> Healthy
        </span>
      </Metric>
      <Metric
        title="Est. time to critical level"
        icon={Clock3}
        value={eta === null ? "Receding" : eta === 0 ? "Reached" : String(eta)}
        unit={eta !== null && eta > 0 ? "min" : undefined}
        detail={
          eta === null
            ? "Water level trending down"
            : eta === 0
              ? `${critical.id} · overflow threshold exceeded`
              : `${critical.id} · extrapolated from current trend`
        }
        tone={eta === 0 ? "critical" : "cyan"}
      >
        <span className="metric-trend">
          {critical.trend > 0 ? (
            <ArrowUpRight size={19} />
          ) : (
            <ArrowDownRight size={19} />
          )}
        </span>
      </Metric>
    </div>
  );
}

export function IntelligencePanel({
  onSelect,
}: {
  onSelect: (id: SensorReading["id"]) => void;
}) {
  const { state, dispatch } = useSimulation();
  const sensor = criticalSensor(state.sensors);
  const risk = riskLevel(sensor);
  const eta = overflowMinutes(sensor);
  const d1 = state.sensors.find((s) => s.id === "D1")!;
  const d2 = state.sensors.find((s) => s.id === "D2")!;
  const anomaly = d2.trend > 0.015 && d2.trend > d1.trend * 2.3;
  const pumping = state.phase === "pumping";
  const recovered = state.phase === "recovered";
  return (
    <aside className="panel intelligence-panel">
      <PanelHeading icon={Sparkles} title="Operations intelligence">
        <span className="micro-label">RULE-BASED</span>
      </PanelHeading>
      <div className="intelligence-body">
        <div className="flex items-center justify-between mb-2">
          <span className="eyebrow">PRIORITY LOCATION</span>
          <Badge tone={risk} dot>
            {RISK_LABELS[risk]}
          </Badge>
        </div>
        <button
          className="priority-location"
          onClick={() => onSelect(sensor.id)}
        >
          <span className={`sensor-square tone-${risk}`}>{sensor.id}</span>
          <div>
            <strong>{sensor.name}</strong>
            <span>{ZONE_NAMES[sensor.zone]}</span>
          </div>
          <ChevronRight size={16} className="text-muted" />
        </button>
        <div className="intelligence-readings">
          <div>
            <span>Water level</span>
            <strong>
              {sensor.level.toFixed(2)}
              <small>m</small>
            </strong>
          </div>
          <div>
            <span>Current trend</span>
            <strong className={sensor.trend > 0 ? "text-amber" : "text-green"}>
              {sensor.trend > 0 ? "+" : ""}
              {(sensor.trend * 100).toFixed(1)}
              <small>cm/min</small>
            </strong>
          </div>
        </div>
        <div className="capacity-track">
          <span
            style={{
              width: `${Math.min(100, (sensor.level / sensor.criticalLevel) * 100)}%`,
              background: RISK_COLORS[risk],
            }}
          />
        </div>
        <div className="capacity-caption">
          <span>
            {Math.round((sensor.level / sensor.criticalLevel) * 100)}% of
            critical depth
          </span>
          <span>{sensor.criticalLevel.toFixed(1)} m</span>
        </div>
        <div className="overflow-row">
          <Clock3 size={15} />
          <span>Estimated overflow</span>
          <strong className={eta === 0 ? "text-red" : "text-amber"}>
            {eta === null
              ? "Not projected"
              : eta === 0
                ? "Threshold reached"
                : `~${eta} min`}
          </strong>
        </div>
        <div className={`anomaly-note ${anomaly ? "anomaly-active" : ""}`}>
          <CircleAlert size={15} className="shrink-0 mt-0.5" />
          <div>
            <strong>
              {anomaly
                ? "Possible local restriction"
                : "No trend anomaly detected"}
            </strong>
            <p>
              {anomaly
                ? "D2 is rising over 2.3× faster than D1. A restriction is a hypothesis to inspect."
                : "Drain trends are within this scenario’s expected pattern."}
            </p>
          </div>
        </div>
        <div className="infrastructure-row">
          <span className="eyebrow">POTENTIALLY AFFECTED</span>
          <p>
            {risk === "low"
              ? "No assets at elevated modelled risk"
              : sensor.zone === "zone-b"
                ? "Zone B homes · Central Link · school access"
                : `${ZONE_NAMES[sensor.zone]} · local road access`}
          </p>
        </div>
        <div className="recommendation">
          <div className="flex items-center gap-2">
            <Sparkles size={14} />
            <strong>
              {recovered
                ? "Recovery verified"
                : pumping
                  ? "Verify the response"
                  : "Recommended action"}
            </strong>
          </div>
          <p>
            {recovered
              ? "Modelled levels are below 0.80 m. Continue observation and reset to replay."
              : pumping
                ? "Watch the drawdown trend and confirm all drains return below 0.80 m."
                : risk === "low"
                  ? "Maintain observation. Start a storm scenario to explore township response."
                  : `Inspect the ${sensor.id} catchment and model a P2 pump intervention to reduce water levels.`}
          </p>
          <button
            className="recommendation-button"
            disabled={pumping || recovered}
            onClick={() => dispatch({ type: "START_PUMP" })}
          >
            {recovered
              ? "Scenario recovered"
              : pumping
                ? "Intervention in progress"
                : "Simulate pump intervention"}
            {pumping ? <Activity size={14} /> : <ArrowRight size={14} />}
          </button>
        </div>
        <p className="intelligence-disclaimer">
          <Info size={11} /> Simulated estimates · no physical pump control
        </p>
      </div>
    </aside>
  );
}

const eventIcons: Record<OperationalEvent["kind"], LucideIcon> = {
  system: Radio,
  risk: TriangleAlert,
  pump: Gauge,
  rain: CloudRain,
};
export function EventList({
  events,
  compact = false,
}: {
  events: OperationalEvent[];
  compact?: boolean;
}) {
  const { dispatch } = useSimulation();
  return (
    <div className={`event-list ${compact ? "event-list-compact" : ""}`}>
      {events.map((event) => {
        const Icon = eventIcons[event.kind];
        return (
          <div className="event-item" key={event.id}>
            <span className={`event-icon tone-${event.severity}`}>
              <Icon size={14} />
            </span>
            <div className="event-content">
              <strong>{event.title}</strong>
              {!compact && <p>{event.description}</p>}
              <span className="event-time">
                {formatTime(event.minute)} MYT <span>· SIMULATED</span>
              </span>
            </div>
            {!compact && (
              <button
                className={`acknowledge-button ${event.acknowledged ? "acknowledged" : ""}`}
                aria-label={
                  event.acknowledged
                    ? `${event.title} acknowledged`
                    : `Acknowledge ${event.title}`
                }
                title={
                  event.acknowledged ? "Acknowledged" : "Acknowledge alert"
                }
                disabled={event.acknowledged}
                onClick={() => dispatch({ type: "ACKNOWLEDGE", id: event.id })}
              >
                {event.acknowledged ? (
                  <CheckCheck size={15} />
                ) : (
                  <Check size={15} />
                )}
              </button>
            )}
          </div>
        );
      })}
      {events.length === 0 && (
        <div className="empty-state">
          <ShieldCheck size={22} />
          <p>No alerts match this filter.</p>
        </div>
      )}
    </div>
  );
}

export function RecentAlerts({ onViewAll }: { onViewAll: () => void }) {
  const { state } = useSimulation();
  const alerts = state.events.filter((e) => e.kind !== "system").slice(0, 3);
  return (
    <section className="panel alerts-panel">
      <PanelHeading icon={TriangleAlert} title="Recent alerts">
        <Badge tone="watch">
          {
            state.events.filter((e) => !e.acknowledged && e.kind !== "system")
              .length
          }{" "}
          unreviewed
        </Badge>
      </PanelHeading>
      <EventList events={alerts} compact />
      <button className="panel-footer-button" onClick={onViewAll}>
        View all alerts <ArrowRight size={13} />
      </button>
    </section>
  );
}

export function Timeline({ onViewAll }: { onViewAll: () => void }) {
  const { state } = useSimulation();
  return (
    <section className="panel timeline-panel">
      <PanelHeading icon={History} title="Operational timeline">
        <button className="text-button" onClick={onViewAll}>
          Full log <ArrowUpRight size={13} />
        </button>
      </PanelHeading>
      <div className="timeline-items">
        {state.events.slice(0, 4).map((event) => (
          <div className="timeline-item" key={event.id}>
            <span className={`timeline-dot tone-${event.severity}`} />
            <time>{formatTime(event.minute)}</time>
            <span>{event.title}</span>
            <Badge tone={event.kind === "system" ? "neutral" : event.severity}>
              {event.kind === "pump"
                ? "Response"
                : event.kind === "rain"
                  ? "Weather"
                  : event.kind === "system"
                    ? "System"
                    : "Risk"}
            </Badge>
          </div>
        ))}
      </div>
    </section>
  );
}

export function SimulationControls() {
  const { state, dispatch } = useSimulation();
  const running = state.phase === "storm" || state.phase === "pumping";
  return (
    <section
      className="simulation-controls"
      aria-label="Simulation mode controls"
    >
      <div className="simulation-description">
        <span className="simulation-icon">
          <FlaskConical size={20} />
        </span>
        <div>
          <div className="flex items-center gap-2.5">
            <h2>Simulation mode</h2>
            <Badge
              tone={
                state.phase === "storm"
                  ? "watch"
                  : state.phase === "pumping" || state.phase === "recovered"
                    ? "low"
                    : "cyan"
              }
              dot
            >
              {state.paused
                ? "Paused"
                : state.phase === "storm"
                  ? "Storm active"
                  : state.phase === "pumping"
                    ? "P2 active"
                    : state.phase === "recovered"
                      ? "Recovered"
                      : "Ready"}
            </Badge>
          </div>
          <p>Explore a storm. Model a response. Verify the outcome.</p>
        </div>
      </div>
      <div className="simulation-weather">
        <CloudRain size={17} />
        <strong>
          {state.rainfall}
          <small> mm/h</small>
        </strong>
        <span>MODELLED RAINFALL</span>
      </div>
      <div className="simulation-buttons">
        <button
          className="button button-primary"
          disabled={state.phase === "storm"}
          onClick={() => dispatch({ type: "START_STORM" })}
        >
          <CloudRain size={15} />
          Start storm simulation
        </button>
        <button
          className="button button-secondary"
          disabled={state.phase === "pumping" || state.phase === "recovered"}
          onClick={() => dispatch({ type: "START_PUMP" })}
        >
          <Wind size={15} />
          Simulate pump intervention
        </button>
        {running && (
          <IconButton
            icon={state.paused ? Play : Pause}
            label={state.paused ? "Resume simulation" : "Pause simulation"}
            onClick={() => dispatch({ type: "TOGGLE_PAUSE" })}
          />
        )}
        <button
          className="button button-quiet"
          onClick={() => dispatch({ type: "RESET" })}
        >
          <RotateCcw size={14} />
          Reset scenario
        </button>
      </div>
      <p className="simulation-caption">
        <Info size={11} /> All data and actions are simulated. 1.2 seconds = 1
        modelled minute. No hardware connected.
      </p>
    </section>
  );
}

export function SensorDetail({ sensor }: { sensor: SensorReading }) {
  const { state } = useSimulation();
  return (
    <div className="sensor-detail">
      <div className="flex items-center gap-2 mb-3">
        <Badge tone={riskLevel(sensor)}>
          {RISK_LABELS[riskLevel(sensor)]} risk
        </Badge>
        <Badge tone="cyan">Simulated</Badge>
      </div>
      <p className="text-muted text-sm">
        {sensor.name} · {ZONE_NAMES[sensor.zone]}
      </p>
      <dl>
        <div>
          <dt>Current water level</dt>
          <dd>{sensor.level.toFixed(3)} m</dd>
        </div>
        <div>
          <dt>Critical depth</dt>
          <dd>{sensor.criticalLevel.toFixed(2)} m</dd>
        </div>
        <div>
          <dt>Trend</dt>
          <dd>
            {sensor.trend > 0 ? "+" : ""}
            {(sensor.trend * 100).toFixed(1)} cm / modelled min
          </dd>
        </div>
        <div>
          <dt>Operational risk index</dt>
          <dd>{riskScore(sensor, state.rainfall)} / 100</dd>
        </div>
        <div>
          <dt>Sensor status</dt>
          <dd>{sensor.online ? "Online (simulated)" : "Offline"}</dd>
        </div>
        <div>
          <dt>Latest model time</dt>
          <dd>{formatTime(state.minute)} MYT</dd>
        </div>
      </dl>
      <p className="model-note">
        The risk index combines relative depth, positive water trend, and
        rainfall. It is a simulation estimate, not a statistically calibrated
        flood probability.
      </p>
    </div>
  );
}
