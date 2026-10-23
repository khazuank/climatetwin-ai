"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, ArrowRight, Bell, Check, House, Info,
  MapPinned, Route, Waves, X } from "lucide-react";
import { trainedCapacityForecast, type AiResponse } from "@/lib/ai";
import { assessHome, etaLabel, routeSafetyLabel, travelDurationLabel } from "@/lib/demo";
import type { DemoEvent, DemoRoute, DemoState, Risk, Role, TravelMode } from "@/lib/demo";
import { ManagementDashboard } from "./management-dashboard";
import { useDemo } from "./demo-provider";
import { DemoMap, type MapItem } from "./demo-map";

const riskName: Record<Risk, string> = {
  NORMAL: "Normal", WATCH: "Watch", WARNING: "Warning", CRITICAL: "Critical",
};

function zoneById(state: DemoState, id: string) {
  return state.zones.find((zone) => zone.id === id);
}

function relevantEvents(state: DemoState, role: Role, homeId: string) {
  if (role === "management") return state.notifications.filter((event) => event.audience !== "resident");
  const home = state.houses.find((item) => item.id === homeId);
  const relatedRoads = new Set(state.roads.filter((road) => road.zone_id === home?.zone_id)
    .map((road) => road.id).concat(state.route.road_ids));
  return state.notifications.filter((event) =>
    event.audience !== "management" &&
    (event.location === "Township" || event.location === homeId ||
     event.location === home?.zone_id || relatedRoads.has(event.location)));
}

function HomeSafetyPanel({ state, ai, homeId }: { state: DemoState; ai: AiResponse | null; homeId: string }) {
  const assessment = assessHome(state, homeId);
  if (!assessment) return <p>Home assessment unavailable.</p>;
  const { home, zone, roads, counts, access } = assessment;
  const forecasts = ([5, 10, 20] as const).map((horizon) =>
    trainedCapacityForecast(state, ai, zone.id, horizon)).filter((item) => item !== null);
  const route = state.route.home_id === homeId ? state.route : null;
  return <section className="demo-home-assessment" aria-label={`${home.id} home safety assessment`}>
    <span className="demo-eyebrow">SELECTED HOME · MODELLED EVIDENCE</span>
    <h2>{home.id} — {home.name}</h2>
    <div className="demo-home-summary"><div><small>Home flood exposure</small><strong>Unknown</strong></div>
      <div><small>Road access</small><strong>{access.toLowerCase()}</strong></div>
      <div><small>Shelter route · {route?.mode.toLowerCase() ?? "updating"}</small>
        <strong>{route ? route.available ? "Available" : "Unavailable" : "Updating"}</strong></div></div>
    <p>There is no building elevation or home inundation model. {zone.name} is the illustrative nearby drainage zone; its {riskName[zone.risk].toLowerCase()} category describes the zone, not this house.</p>
    <div className="demo-home-capacity"><strong>{zone.capacity_percent.toFixed(0)}%</strong><span>{zone.depth_cm.toFixed(1)} cm / {zone.capacity_cm.toFixed(0)} cm nearby drainage capacity</span></div>
    <p>Warning threshold: {etaLabel(zone.flood_eta, state.time_model.forecast_horizon_min)} <small>(deterministic scenario projection)</small></p>
    <div className="demo-home-forecast"><strong>Trained AI · nearby {zone.id}</strong>
      {forecasts.length ? <div>{forecasts.map((item) => <span key={item.horizon_min}>+{item.horizon_min} min <b>{item.percent.toFixed(0)}%</b><small>{item.predicted_cm.toFixed(1)} cm · {item.threshold_outlook.toLowerCase()} 100 cm outlook</small></span>)}</div>
        : <p>Trained forecast unavailable or updating; no home forecast is inferred.</p>}</div>
    <p>Node-adjacent roads: {counts.open} open · {counts.atRisk} at risk · {counts.closed} closed ({roads.map((road) => road.id).join(", ")}).</p>
    <p>Shelter: {route ? route.available ? `${route.road_ids.join(" → ")} · ${route.distance_m?.toFixed(0)} m · ${travelDurationLabel(route.travel_minutes)}` : route.reason : "Recalculating for this home."}</p>
    <small>Road status inherits zone conditions. The route begins at the home&apos;s modelled road access node; the short walk from its plotted building is excluded. Travel time and shelter location are illustrative.</small>
  </section>;
}

function SelectedDetail({ state, selection, route }: { state: DemoState; selection: MapItem | null; route?: DemoRoute }) {
  if (!selection) return <p>Select a map feature to inspect its current simulated condition.</p>;
  if (selection.kind === "zone") {
    const zone = zoneById(state, selection.id);
    if (!zone) return null;
    return <><strong>{zone.name} · {zone.depth_cm.toFixed(1)} cm · {riskName[zone.risk]}</strong>
      <p>{zone.capacity_percent.toFixed(0)}% of capacity. {etaLabel(zone.flood_eta, state.time_model.forecast_horizon_min)} to the {zone.flood_threshold_cm.toFixed(0)} cm warning threshold.</p>
      <small>{zone.explanation} {zone.rate_cm_min == null ? "Rate still collecting." : `Recent change ${zone.rate_cm_min >= 0 ? "+" : ""}${zone.rate_cm_min.toFixed(2)} cm per simulated minute.`}</small></>;
  }
  if (selection.kind === "road") {
    const road = state.roads.find((item) => item.id === selection.id);
    if (!road) return null;
    const segment = (route ?? state.route).segments.find((item) => item.road_id === road.id);
    return <><strong>{road.id} · {road.status === "AT_RISK" ? "At risk" : road.status === "CLOSED" ? "Closed" : "Open"}</strong>
      <p>{road.reason} {etaLabel(road.closure_eta, state.time_model.forecast_horizon_min)} to the {state.zones.find((zone) => zone.id === road.zone_id)?.road_hazard_cm.toFixed(0)} cm road closure rule.</p>
      <small>{road.distance_m.toFixed(0)} illustrative metres · Linked to {road.zone_id} · Permitted: {road.allowed_modes.map((mode) => mode.toLowerCase()).join(", ")} · {segment
        ? `On selected route: traveller reaches its end in ${segment.arrival_min.toFixed(1)} min${segment.margin_min == null ? "; no closure projected within the window" : `, ${segment.margin_min.toFixed(1)} min before projected closure`}`
        : "Not used by selected route"}. Road estimates inherit zone depth; there is no street sensor.</small></>;
  }
  if (selection.kind === "pump") {
    const pump = state.pumps.find((item) => item.id === selection.id);
    if (!pump) return null;
    return <><strong>Virtual pump {pump.id} · {state.zones.find((zone) => zone.id === pump.zone_id)?.name} · {pump.on ? "On" : "Off"}</strong>
      <p>Removes up to {pump.capacity_m3_min.toFixed(2)} m³ from {pump.zone_id} per simulated minute. The model removes that water from the township balance.</p>
      <small>Operates above {pump.minimum_depth_cm.toFixed(0)} cm; dry-run protection stops it at or below that depth.</small></>;
  }
  if (selection.kind === "home") {
    const home = state.houses.find((item) => item.id === selection.id);
    if (!home) return null;
    return <><strong>{home.name}</strong><p>Linked to {home.zone_id}. {state.route.message}</p>
      <small>{state.route.reason}</small></>;
  }
  return <><strong>{state.shelter.name}</strong><p>Illustrative destination in this synthetic road network.</p>
    <small>No real shelter availability has been verified.</small></>;
}

function ResidentView({ state, ai, selection, setSelection, homeId, setHomeId, mode, setMode, openNotifications }: {
  state: DemoState; selection: MapItem | null; setSelection: (item: MapItem) => void;
  ai: AiResponse | null; homeId: string; setHomeId: (id: string) => void;
  mode: TravelMode; setMode: (mode: TravelMode) => void; openNotifications: () => void;
}) {
  const [routeChoice, setRouteChoice] = useState<{ homeId: string; mode: TravelMode; kind: DemoRoute["kind"] }>({ homeId, mode, kind: "recommended" });
  const routeKind = routeChoice.homeId === homeId && routeChoice.mode === mode ? routeChoice.kind : "recommended";
  const home = state.houses.find((item) => item.id === homeId) ?? state.houses[0];
  const zone = zoneById(state, home.zone_id)!;
  const affected = assessHome(state, homeId)?.roads.filter((road) => road.status !== "OPEN") ?? [];
  const routePending = state.route.home_id !== homeId || state.route.mode !== mode;
  const route = routePending ? { ...state.route, available: false, road_ids: [],
    message: "Recalculating the shelter journey for this home and transport mode.",
    reason: "Waiting for the shared simulation response.", travel_minutes: null } :
    state.route_options.find((item) => item.kind === routeKind) ?? state.route;
  const residentRisk: Risk = zone.risk;
  const relevant = relevantEvents(state, "resident", homeId).slice(0, 3);
  return <div className="demo-resident-wrap">
    <section className={`demo-resident-hero risk-border-${residentRisk.toLowerCase()}`}>
      <span className="demo-eyebrow">NEARBY DRAINAGE · HOME EXPOSURE UNKNOWN</span>
      <h2>{riskName[residentRisk]} near {home.id}</h2>
      <p>{home.name}: {zone.name} is at {zone.depth_cm.toFixed(1)} cm. {affected.length} linked roads are at risk or closed. Home-level inundation is not modelled.</p>
      <div className="demo-resident-hero-meta"><span>Home {home.id}</span><span>{zone.capacity_percent.toFixed(0)}% of modelled capacity</span>
        <span>{etaLabel(zone.flood_eta, state.time_model.forecast_horizon_min)} to warning threshold</span></div>
    </section>
    <div className="demo-resident-select"><label htmlFor="demo-home-select">Selected home</label>
      <select id="demo-home-select" value={homeId} onChange={(event) => setHomeId(event.target.value)}>
        {state.houses.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}
      </select></div>
    <div className="demo-resident-workspace">
      <section className="demo-resident-map" id="map"><DemoMap state={state} homeId={homeId} onHome={setHomeId}
        selection={selection} onSelect={setSelection} route={route} resident />
        {selection?.kind !== "home" && <div className="demo-map-detail"><MapPinned size={17} /><div><SelectedDetail state={state} selection={selection} route={route} /></div></div>}</section>
      <section className="demo-resident-route-card"><HomeSafetyPanel state={state} ai={ai} homeId={homeId} />
        <div className="demo-resident-route-icon"><Route size={22} /></div>
        <div><span className="demo-eyebrow">SHELTER JOURNEY · ILLUSTRATIVE</span>
          <div className="demo-mode-select" role="group" aria-label="Transport mode">
            {(["WALK", "CAR", "MOTORCYCLE"] as const).map((item) => <button type="button" key={item}
              className={mode === item ? "is-active" : ""} aria-pressed={mode === item}
              onClick={() => setMode(item)}>{item === "WALK" ? "Walking" : item === "CAR" ? "Car" : "Motorcycle"}</button>)}
          </div>
          <h2>{route.available ? state.shelter.name : "No accessible shelter route"}</h2>
          {route.available && <div className="demo-route-primary"><strong>{travelDurationLabel(route.travel_minutes)}</strong><span>estimated {mode.toLowerCase()} journey · {route.distance_m?.toFixed(0)} m</span></div>}
          <p>{route.message}</p><small>{route.reason}</small>
          {route.available && <p className="demo-route-margin">{routeSafetyLabel(route, state.time_model.forecast_horizon_min)}</p>}
          {route.available && <div className="demo-route-steps">{route.road_ids.map((id) => <span key={id}>{id}</span>)}</div>}
          <div className="demo-route-options" role="group" aria-label="Compare shelter routes">
            {!routePending && state.route_options.map((option) => <button type="button" key={`${option.kind}-${option.road_ids.join("-")}`}
              className={route.road_ids.join() === option.road_ids.join() ? "is-active" : ""}
              onClick={() => setRouteChoice({ homeId, mode, kind: option.kind })}>
              <strong>{option.kind === "recommended" ? "Recommended · lowest exposure" : option.kind === "fastest" ? "Fastest" : option.kind === "shortest" ? "Shortest" : "Alternative"}</strong>
              <span>{travelDurationLabel(option.travel_minutes)} · {option.distance_m?.toFixed(0)} m</span>
            </button>)}
          </div>
          <small>{state.time_model.note}</small>
        </div></section>
    </div>
    <div className="demo-resident-lower"><section className="demo-resident-roads"><div className="demo-card-title"><h2>Road conditions nearby</h2><span>{affected.length} affected</span></div>
      {affected.length ? affected.map((road) => <div key={road.id}><strong>{road.id} · {road.status === "AT_RISK" ? "At risk" : "Closed"}</strong><p>{etaLabel(road.closure_eta, state.time_model.forecast_horizon_min)} · {road.reason}</p></div>)
        : <p className="demo-empty-copy">All modelled roads are currently open.</p>}</section>
      <section className="demo-resident-notices"><div className="demo-card-title"><h2>Updates for your area</h2>
        <button type="button" onClick={openNotifications}>View all <ArrowRight size={13} /></button></div>
        {relevant.length ? relevant.map((event) => <div key={event.id} className="demo-preview-event">
          <span className={`demo-alert-dot risk-${event.severity.toLowerCase()}`} />
          <div><strong>{event.title}</strong><small>Simulated minute {event.minute}</small></div></div>)
          : <p className="demo-empty-copy">No relevant warnings for this home.</p>}</section></div>
    <p className="demo-resident-disclaimer"><Info size={15} /> This route and shelter are illustrative. They are not verified for a real evacuation.</p>
  </div>;
}

export function DemoDashboard({ role: initialRole = "management" }: { role?: Role }) {
  const { state, ai, aiFeed, homeId, setHomeId, mode, setMode, loading, busy, error, acknowledge } = useDemo();
  const [role] = useState<Role>(initialRole);
  const [selection, setSelection] = useState<MapItem | null>({ kind: "home", id: "H2" });
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [browserAlerts, setBrowserAlerts] = useState(false);
  const seenEventId = useRef<number | null>(null);
  const events = state ? relevantEvents(state, role, homeId) : [];
  const unread = events.filter((event) => !event.acknowledged_by[role]).length;
  const notificationSupport = typeof window !== "undefined" && "Notification" in window;

  useEffect(() => {
    if (!notificationsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotificationsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [notificationsOpen]);

  useEffect(() => {
    if (!state) return;
    const newest = state.events[0]?.id ?? 0;
    if (seenEventId.current !== null && browserAlerts && typeof window !== "undefined" &&
        "Notification" in window && Notification.permission === "granted") {
      for (const event of relevantEvents(state, role, homeId).filter((item) => item.id > seenEventId.current!)) {
        new Notification(`ClimateTwin · ${event.title}`, { body: `${event.description} Synthetic scenario.` });
      }
    }
    seenEventId.current = Math.max(seenEventId.current ?? 0, newest);
  }, [state, role, homeId, browserAlerts]);

  async function enableBrowserAlerts() {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    setBrowserAlerts(permission === "granted");
  }

  if (loading && !state) return <div className="demo-loading"><Waves size={28} /><h1>ClimateTwin AI</h1><p>Connecting to the shared synthetic simulation…</p></div>;
  if (!state) return <div className="demo-loading"><Waves size={28} /><h1>Simulation unavailable</h1><p>{error ?? "FastAPI is not responding."}</p></div>;

  return <div className={`demo-root ${role === "resident" ? "is-resident" : "is-management"}`}>
    {role === "management" ? <ManagementDashboard state={state} feed={aiFeed} disabled={busy || Boolean(error)} error={error}
      selection={selection} setSelection={setSelection} homeId={homeId} setHomeId={setHomeId}
      openNotifications={() => setNotificationsOpen(true)} openResident={() => window.location.assign("/resident")} /> : <>
      <aside className="demo-sidebar">
        <div className="demo-brand"><span><Waves size={22} /></span><div><strong>ClimateTwin <i>AI</i></strong><small>FLOOD DIGITAL TWIN</small></div></div>
        <div className="demo-nav-caption">WORKSPACE</div>
        <button type="button" aria-label="Open management dashboard" title="Management dashboard"
          onClick={() => window.location.assign("/login")}><Activity size={17} /> Management</button>
        <button type="button" className="is-current" aria-label="Open resident safety dashboard" title="Resident safety dashboard"
          onClick={() => window.location.assign("/resident")}><House size={17} /> Resident safety</button>
        <div className="demo-nav-caption">EXPLORE</div>
        <a href="#map"><MapPinned size={17} /> Township map</a>
        <button type="button" onClick={() => setNotificationsOpen(true)}><Bell size={17} /> Notifications
          {unread > 0 && <em>{unread}</em>}</button>
        <div className="demo-sidebar-bottom"><span className="demo-source-dot" /><strong>Synthetic demonstration</strong>
          <p>Shared FastAPI state · no live sensors or physical pumps.</p></div>
      </aside>
      <main className="demo-main">
        <header className="demo-topbar"><div className="demo-breadcrumb">ClimateTwin <span>/</span> Resident safety</div>
          <div className="demo-top-actions"><span className="demo-sim-clock">{state.simulated_time} <small>SIMULATED TIME · MIN {state.minute}</small></span>
            <button type="button" className="demo-notification-button" onClick={() => setNotificationsOpen(true)} aria-label={`Open notifications, ${unread} unread`}>
              <Bell size={18} />{unread > 0 && <i />}</button></div></header>
        <div className="demo-page-content">
          {error && <div className="demo-error" role="status">Connection issue: {error}. Showing the last received synthetic state; controls are disabled until reconnection.</div>}
          <div className="demo-page-heading"><div><span className="demo-eyebrow">SYNTHETIC TOWNSHIP · TRAINED FORECAST + RULE-BASED ALERTS</span>
            <h1>Your safety view</h1><p>See your area and the current route through this simulated township.</p></div>
            <span className="demo-source-badge"><span /> SIMULATED DATA</span></div>
          <ResidentView state={state} ai={ai} selection={selection} setSelection={setSelection}
            homeId={homeId} setHomeId={setHomeId} mode={mode} setMode={setMode}
            openNotifications={() => setNotificationsOpen(true)} />
          <footer className="demo-footer">ClimateTwin AI · Illustrative digital twin · No real-world warning or verified evacuation guidance</footer>
        </div>
      </main>
    </>}
    {notificationsOpen && <div className="demo-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setNotificationsOpen(false);
    }}><section className="demo-notification-drawer" role="dialog" aria-modal="true" aria-label="Notification centre">
      <div className="demo-drawer-heading"><div><span className="demo-eyebrow">{role.toUpperCase()} UPDATES</span><h2>Notification centre</h2></div>
        <button type="button" aria-label="Close notifications" onClick={() => setNotificationsOpen(false)}><X size={19} /></button></div>
      <p>In-app synthetic events only. Acknowledgements are saved in the shared demo state.</p>
      {notificationSupport &&
        <button type="button" className="demo-browser-alert-button" onClick={() => void enableBrowserAlerts()}
          disabled={browserAlerts || Notification.permission === "denied"}>
          {browserAlerts ? "Browser alerts enabled" : Notification.permission === "denied" ? "Browser alerts blocked" : "Enable browser alerts"}
        </button>}
      <div className="demo-drawer-events">{events.length ? events.map((event: DemoEvent) => <article key={event.id}>
        <div className="demo-drawer-event-top"><span className={`demo-alert-dot risk-${event.severity.toLowerCase()}`} />
          <strong>{event.title}</strong><small>Min {event.minute}</small></div>
        <p>{event.description}</p><div><span>{event.location} · {event.severity.toLowerCase()}</span>
          <button type="button" disabled={event.acknowledged_by[role] || busy || Boolean(error)}
            onClick={() => void acknowledge(event.id, role)}>
            <Check size={13} /> {event.acknowledged_by[role] ? "Acknowledged" : "Acknowledge"}</button></div>
      </article>) : <p className="demo-empty-copy">No notifications for this view.</p>}</div>
    </section></div>}
  </div>;
}
