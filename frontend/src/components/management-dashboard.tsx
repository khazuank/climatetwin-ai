"use client";

import { useRef, useState } from "react";
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BellRing, ChevronDown,
  Clock3, CloudRain, CloudSun, Gauge, House, Pause, Play, Route, RotateCcw,
  Settings, Waves, X } from "lucide-react";
import { displayDepthCm } from "@/lib/ai";
import { aiForecastAvailability, type AiFeed } from "@/lib/ai-feed";
import { assessHome, travelDurationLabel, warningLevelPercent } from "@/lib/demo";
import type { DemoState, Risk, Scenario } from "@/lib/demo";
import { InterventionComparison } from "./demo-ai-centre";
import { DemoMap, type MapItem } from "./demo-map";
import { ManagementLogout } from "./management-logout";
import { useDemo } from "./demo-provider";

const WEATHER: { id: Exclude<Scenario, "GUIDED">; title: string }[] = [
  { id: "CLEAR", title: "Clear" }, { id: "MODERATE", title: "Moderate rain" },
  { id: "HEAVY", title: "Heavy storm" }, { id: "EXTREME", title: "Extreme storm" },
];
const riskLabel = (risk: Risk) => risk[0] + risk.slice(1).toLowerCase();
const zoneClass = (id: string) => `zone-${id.toLowerCase()}`;

function LevelBar({ percent }: { percent: number | null }) {
  return <span className="management-level-bar" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }} /></span>;
}

function SimulationControls({ state, disabled }: { state: DemoState; disabled: boolean }) {
  const { command, reset } = useDemo();
  return <details className="management-simulation-controls">
    <summary><Play size={18} /><span>Simulation controls</span><ChevronDown size={16} /></summary>
    <div className="management-control-body" aria-label="Simulation controls">
      <strong>Simulation controls</strong><small>Simulated data · changes affect this demo only.</small>
      <label htmlFor="management-weather">Weather scenario</label>
      <select id="management-weather" value={state.scenario} disabled={disabled}
        onChange={(event) => void command({ action: "set_scenario", scenario: event.target.value as Exclude<Scenario, "GUIDED"> })}>
        {state.scenario === "GUIDED" && <option value="GUIDED">Guided storm</option>}
        {WEATHER.map((weather) => <option key={weather.id} value={weather.id}>{weather.title}</option>)}
      </select>
      <button className="management-primary-button" disabled={disabled} onClick={() => void command({ action: "run_demo" })}>Run Guided Flood Demo <ArrowRight size={16} /></button>
      <div className="management-control-actions">
        <button disabled={disabled} aria-label={state.paused ? "Resume simulation" : "Pause simulation"}
          onClick={() => void command({ action: "set_paused", paused: !state.paused })}>
          {state.paused ? <Play size={16} /> : <Pause size={16} />}{state.paused ? "Play" : "Pause"}</button>
        <button disabled={disabled} aria-label="Reset demo" onClick={() => void reset()}><RotateCcw size={16} />Reset</button>
        <label>Speed<select value={state.speed} disabled={disabled}
          onChange={(event) => void command({ action: "set_speed", speed: Number(event.target.value) as 0.5 | 1 | 2 | 4 })}>
          {[0.5, 1, 2, 4].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}
        </select></label>
      </div>
      <div className="management-control-time"><span>Simulated time</span><b>{state.simulated_time} · minute {state.minute}</b></div>
    </div>
  </details>;
}

function WaterForecasts({ state, feed }: { state: DemoState; feed: AiFeed }) {
  const { forecast, status } = aiForecastAvailability(feed, state.scenario, state.run_id, state.minute);
  const delayed = feed.failure === "transport" || status === "delayed";
  return <section className="management-forecasts management-card" aria-label="Water Levels & AI Forecast">
    <div className="management-section-title"><h2>Water Levels &amp; AI Forecast</h2>
      <p>Current water levels and predicted levels in 5, 10 and 20 minutes.</p></div>
    <div className="management-zone-list">{state.zones.map((zone) => {
      const prediction = forecast?.zones.find((item) => item.id === zone.id);
      const currentPercent = warningLevelPercent(zone);
      const trend = zone.trend === "RISING" ? "Rising" : zone.trend === "FALLING" ? "Falling" : zone.trend === "STABLE" ? "Stable" : "Collecting";
      return <article className={`management-zone-card ${zoneClass(zone.id)}`} key={zone.id} data-zone={zone.id}>
        <header><span className="management-zone-icon"><Waves size={21} /></span>
          <h3>{zone.id === "POND" ? "Retention Pond" : zone.name}<small>{zone.id}</small></h3>
          <span className={`management-risk risk-${zone.risk.toLowerCase()}`}>{riskLabel(zone.risk)}</span>
          <span className={`management-trend trend-${zone.trend.toLowerCase()}`}>
            {zone.trend === "RISING" ? <ArrowUpRight size={20} /> : zone.trend === "FALLING" ? <ArrowDownRight size={20} /> : <ArrowRight size={18} />}{trend}</span>
        </header>
        <div className="management-level-grid">
          <div className="management-current-level" data-current-depth={zone.depth_cm} data-reference={zone.flood_threshold_cm}>
            <span>Current level</span><strong>{currentPercent.toFixed(0)}<small>%</small></strong>
            <LevelBar percent={currentPercent} />
            <p><b>{zone.depth_cm.toFixed(1)} cm</b> of {zone.flood_threshold_cm.toFixed(0)} cm warning level</p>
          </div>
          {([5, 10, 20] as const).map((horizon) => {
            const item = prediction?.forecasts.find((value) => value.horizon_min === horizon);
            const depth = item ? displayDepthCm(item.predicted_cm) : null;
            const percent = depth === null ? null : depth / zone.flood_threshold_cm * 100;
            return <div className="management-future-level" key={horizon} data-horizon={horizon} data-depth={depth ?? ""}>
              <span>+{horizon} min</span><strong>{percent === null ? "—" : `${percent.toFixed(0)}%`}</strong>
              <LevelBar percent={percent} /><p>{depth === null ? status === "unavailable" ? "Unavailable" : "Loading" : `${depth.toFixed(1)} cm`}</p>
            </div>;
          })}
        </div>
      </article>;
    })}</div>
    <div className="management-forecast-note">
      <span>Percentages show water depth relative to the warning level.</span>
      <span>{forecast ? `AI forecast from minute ${forecast.simulation_minute}${status === "unavailable" ? " · refresh unavailable" : delayed ? " · refresh delayed" : ""}` :
        status === "unavailable" ? "AI forecasts unavailable" : delayed ? "AI forecasts delayed" : "AI forecasts loading"}</span>
    </div>
  </section>;
}

function HomeIllustration() {
  return <svg className="management-home-art" viewBox="0 0 110 94" role="img" aria-label="Illustration of a township home">
    <rect width="110" height="94" rx="10" fill="#e3f0f8" /><path d="M0 68Q35 51 110 65V94H0Z" fill="#c8deb0" />
    <path d="M17 46H90V78H17Z" fill="#fff9e8" stroke="#c6b99e" /><path d="M10 47L53 18L99 47Z" fill="#b65f4c" />
    <path d="M17 45L53 22L90 45" fill="none" stroke="#d88b73" strokeWidth="4" /><rect x="47" y="53" width="16" height="25" fill="#725d49" />
    <path d="M24 54H38V66H24ZM71 54H84V66H71Z" fill="#92b9c6" stroke="#d7dbd5" strokeWidth="3" />
    <path d="M45 94L49 78H62L73 94" fill="#e9ddc2" /><circle cx="10" cy="66" r="13" fill="#7ba66b" /><circle cx="96" cy="72" r="10" fill="#7ba66b" />
  </svg>;
}

function LocationDetails({ state, selection, homeId }: { state: DemoState; selection: MapItem | null; homeId: string }) {
  const selected = selection ?? { kind: "home", id: homeId };
  if (selected.kind === "home") {
    const evidence = assessHome(state, selected.id);
    if (!evidence) return <p>Select a location on the map.</p>;
    const { home, zone, access } = evidence;
    const route = state.route.home_id === home.id ? state.route : null;
    return <div className="management-home-detail"><HomeIllustration /><div>
      <div className="management-location-heading"><strong>Home {home.id}</strong><span className={`management-risk risk-${zone.risk.toLowerCase()}`}>Nearby: {riskLabel(zone.risk)}</span></div>
      <span className="management-location-area">{home.name}</span>
      <p>{zone.name}: {zone.depth_cm.toFixed(1)} cm · Road access: {access.toLowerCase()}</p>
      <p>Shelter: {route ? route.available ? `${travelDurationLabel(route.travel_minutes)} · accessible` : "No route available" : "Updating route"}</p>
      <small>Property flooding: not modelled.</small>
    </div></div>;
  }
  if (selected.kind === "zone") {
    const zone = state.zones.find((item) => item.id === selected.id);
    return zone && <div className={`management-location-summary ${zoneClass(zone.id)}`}><span className="management-location-symbol"><Waves size={30} /></span><div>
      <strong>{zone.name}</strong><p>{zone.depth_cm.toFixed(1)} cm · {warningLevelPercent(zone).toFixed(0)}% of warning level</p>
      <p>Current risk: {riskLabel(zone.risk)} · {zone.trend === "INSUFFICIENT" ? "Trend collecting" : zone.trend.toLowerCase()}</p>
      <small>{zone.linked_road_ids.length} linked roads · Warning level {zone.flood_threshold_cm.toFixed(0)} cm</small>
    </div></div>;
  }
  if (selected.kind === "road") {
    const road = state.roads.find((item) => item.id === selected.id);
    return road && <div className="management-location-summary"><span className="management-location-symbol"><Route size={30} /></span><div>
      <strong>Road {road.id} · {road.status === "AT_RISK" ? "At risk" : road.status === "CLOSED" ? "Closed" : "Open"}</strong>
      <p>{road.reason}</p><small>{road.distance_m.toFixed(0)} m · Linked to {road.zone_id} · {road.allowed_modes.map((mode) => mode.toLowerCase()).join(", ")}</small>
    </div></div>;
  }
  if (selected.kind === "pump") {
    const pump = state.pumps.find((item) => item.id === selected.id);
    return pump && <div className="management-location-summary"><span className="management-location-symbol"><Gauge size={30} /></span><div>
      <strong>Virtual Pump {pump.id} · {pump.on ? "On" : "Off"}</strong><p>Serving {state.zones.find((zone) => zone.id === pump.zone_id)?.name}</p>
      <small>Operates above {pump.minimum_depth_cm.toFixed(0)} cm · Capacity {pump.capacity_m3_min.toFixed(2)} m³/min</small>
    </div></div>;
  }
  return <div className="management-location-summary"><span className="management-location-symbol"><House size={30} /></span><div><strong>{state.shelter.name}</strong><p>Illustrative shelter destination</p><small>Real shelter availability is unverified.</small></div></div>;
}

function PumpOperations({ state, disabled, onCompare }: { state: DemoState; disabled: boolean; onCompare: () => void }) {
  const { command } = useDemo();
  return <section className="management-pumps management-card" aria-label="Virtual Pump Operations">
    <div className="management-bottom-heading"><Settings size={22} /><h2>Virtual Pump Operations</h2><button onClick={onCompare}>Compare</button></div>
    <div className="management-pump-rows">{state.pumps.map((pump) => {
      const zone = state.zones.find((item) => item.id === pump.zone_id)!;
      const dry = !pump.on && zone.depth_cm <= pump.minimum_depth_cm;
      return <div className="management-pump-row" key={pump.id}>
        <span className="management-pump-icon"><Gauge size={23} /></span>
        <div><strong>Pump {pump.id}</strong><small>Serving {zone.name}</small></div>
        <button className={`management-switch ${pump.on ? "is-on" : ""}`} role="switch" aria-checked={pump.on}
          aria-label={`Switch virtual ${pump.id} ${pump.on ? "off" : "on"}`} disabled={disabled || dry}
          title={dry ? `Water must be above ${pump.minimum_depth_cm} cm; current level ${zone.depth_cm.toFixed(1)} cm` : `Turn Pump ${pump.id} ${pump.on ? "off" : "on"}`}
          onClick={() => void command({ action: "set_pump", pump_id: pump.id, on: !pump.on })}>
          <span /><b>{pump.on ? "On" : "Off"}</b>
        </button>
        <small className="management-pump-availability">{dry ? "Water too low" : "Manual control"}</small>
      </div>;
    })}</div>
  </section>;
}

export function ManagementDashboard({ state, feed, disabled, error, selection, setSelection, homeId, setHomeId, openNotifications, openResident }: {
  state: DemoState; feed: AiFeed; disabled: boolean; error: string | null;
  selection: MapItem | null; setSelection: (item: MapItem) => void;
  homeId: string; setHomeId: (id: string) => void; openNotifications: () => void; openResident: () => void;
}) {
  const [dialogContent, setDialogContent] = useState<"history" | "comparison">("history");
  const dialog = useRef<HTMLDialogElement>(null);
  const affected = state.roads.filter((road) => road.status !== "OPEN").length;
  const closed = state.roads.filter((road) => road.status === "CLOSED").length;
  const recent = state.notifications.filter((event) => event.audience !== "resident").slice(0, 3);
  const weather = WEATHER.find((item) => item.id === state.scenario)?.title ?? "Guided storm";
  function showDialog(content: "history" | "comparison") { setDialogContent(content); dialog.current?.showModal(); }
  return <main className="management-dashboard">
    <header className="management-header management-card">
      <div className="management-brand"><Waves size={43} strokeWidth={2} /><div><h1>ClimateTwin AI</h1><span>Township Flood Management</span></div></div>
      <div className="management-header-stat"><span className={`management-status-dot risk-${state.overall_risk.toLowerCase()}`} /><div><span>Township risk</span><strong>{riskLabel(state.overall_risk)}</strong></div></div>
      <div className="management-header-stat"><Route size={29} /><div><span>Roads affected</span><strong>{affected} affected · {closed} closed</strong></div></div>
      <div className="management-header-stat">{state.scenario === "CLEAR" ? <CloudSun size={29} /> : <CloudRain size={29} />}<div><span>Simulated weather</span><strong>{weather} · {state.rainfall_mm_h.toFixed(0)} mm/h</strong></div></div>
      <div className="management-header-stat"><Clock3 size={29} /><div><span>Simulation time</span><strong>{state.simulated_time} · minute {state.minute}{state.paused ? " · paused" : ""}</strong></div></div>
      <div className="management-header-actions"><SimulationControls state={state} disabled={disabled} />
        <ManagementLogout /></div>
    </header>
    {error && <div className="management-connection-error" role="status">Connection issue: {error}. Controls will resume after reconnection.</div>}
    <div className="management-workspace">
      <section className="management-map management-card" id="map"><DemoMap state={state} homeId={homeId} onHome={setHomeId} selection={selection} onSelect={setSelection} /></section>
      <WaterForecasts state={state} feed={feed} />
    </div>
    <div className="management-bottom-row">
      <section className="management-selected management-card" aria-label="Selected Location"><div className="management-bottom-heading"><House size={23} /><h2>Selected Location</h2></div>
        <LocationDetails state={state} selection={selection} homeId={homeId} /></section>
      <PumpOperations state={state} disabled={disabled} onCompare={() => showDialog("comparison")} />
      <section className="management-alerts management-card" aria-label="Recent Alerts"><div className="management-bottom-heading"><BellRing size={23} /><h2>Recent Alerts</h2><button onClick={openNotifications}>View all</button></div>
        <div className="management-alert-list">{recent.length ? recent.map((event) => <div key={event.id}><span className={`management-status-dot risk-${event.severity.toLowerCase()}`} /><strong>{event.title}</strong><time>Minute {event.minute}</time></div>) : <p>No current alerts.</p>}</div>
      </section>
    </div>
    <footer className="management-footer"><span>Illustrative township · simulated data</span><div><button onClick={() => showDialog("history")}><Activity size={14} />Activity history</button><button onClick={openResident}><House size={14} />Resident Safety</button></div></footer>
    <dialog ref={dialog} className="management-detail-dialog" onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="management-dialog-heading"><h2>{dialogContent === "history" ? "Incidents & activity history" : "Pump response comparison"}</h2><button aria-label="Close details" onClick={() => dialog.current?.close()}><X size={22} /></button></div>
      {dialogContent === "comparison" ? <><InterventionComparison ai={feed.latest?.run_id === state.run_id && feed.latest.scenario === state.scenario ? feed.latest : null} />
        {state.pump_outlooks.map((outlook) => <div className="management-comparison-row" key={outlook.pump_id}><strong>Pump {outlook.pump_id} · next {outlook.horizon_min} min</strong><p>Off: {outlook.off.depth_cm?.toFixed(1) ?? "—"} cm · On: {outlook.on.available ? `${outlook.on.depth_cm?.toFixed(1)} cm` : "Unavailable at this water level"}</p><small>Deterministic simulation · current conditions continue.</small></div>)}</> :
        <><h3>Active incidents</h3>{state.incidents.length ? state.incidents.map((incident) => <p key={incident.id}>{incident.location} · {incident.description}</p>) : <p>No active incidents.</p>}<h3>Activity timeline</h3>{state.events.map((event) => <article key={event.id}><time>Minute {event.minute}</time><div><strong>{event.title}</strong><p>{event.description}</p></div></article>)}</>}
    </dialog>
  </main>;
}
