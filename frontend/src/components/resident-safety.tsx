"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck, CircleHelp, MapPinned, TriangleAlert, Waves } from "lucide-react";
import { DemoMap, type MapItem } from "./demo-map";
import { travelDurationLabel, type DemoRoute } from "@/lib/demo";
import { parseResidentState, residentLevelPercent, residentSummary, sameResidentView, usableResidentRoutes, type ResidentState } from "@/lib/resident";

const MONITORED_AREAS = [
  { id: "D1", name: "Drain 1" },
  { id: "D2", name: "Drain 2" },
  { id: "POND", name: "Retention Pond" },
] as const;

function WaterLevel({ label, depth, warning }: { label: string; depth: number | null; warning: number | null }) {
  const percent = residentLevelPercent(depth, warning);
  return <div className="resident-level" data-period={label}>
    <span>{label}</span><strong>{percent === null ? "—" : `${percent.toFixed(0)}%`}</strong>
    <div className="resident-level-track" aria-hidden="true"><i style={{ width: `${Math.min(100, percent ?? 0)}%` }} /></div>
    <small>{depth === null ? "Unavailable" : `${Math.max(0, depth).toFixed(1)} cm`}</small>
  </div>;
}

function WaterForecasts({ state }: { state: ResidentState }) {
  const ready = state.forecast.status === "ready" && state.forecast.run_id === state.run_id &&
    state.forecast.simulation_minute === state.minute;
  return <section className="resident-water" aria-label="Water Levels and AI Forecast">
    <div className="resident-water-heading"><h2>Water Levels &amp; AI Forecast</h2>
      <p>See water levels now and what may happen in 10 and 20 minutes.</p></div>
    <div className="resident-water-grid">{MONITORED_AREAS.map((area) => {
      const zone = state.zones.find((item) => item.id === area.id);
      const prediction = ready ? state.forecast.zones.find((item) => item.id === area.id) : null;
      const forecast = (horizon: 10 | 20) => prediction?.forecasts.find((item) => item.horizon_min === horizon)?.predicted_cm ?? null;
      const warning = zone?.flood_threshold_cm ?? null;
      return <article className={`resident-water-card zone-${area.id.toLowerCase()}`} data-zone={area.id} key={area.id}>
        <h3>{area.name}<small>{area.id}</small></h3>
        <div className="resident-level-grid"><WaterLevel label="NOW" depth={zone?.depth_cm ?? null} warning={warning} />
          <WaterLevel label="+10 MIN" depth={forecast(10)} warning={warning} />
          <WaterLevel label="+20 MIN" depth={forecast(20)} warning={warning} /></div>
      </article>;
    })}</div>
    <p className="resident-water-note">Percentages show water depth relative to each area&apos;s warning level, not flood probability. {ready ? `AI forecast from simulated minute ${state.forecast.simulation_minute}.` : "AI forecast unavailable; current levels remain visible."}</p>
  </section>;
}

export function ResidentSafety() {
  const [homeId, setHomeId] = useState(() => typeof window !== "undefined" &&
    ["H1", "H2", "H3", "H4"].includes(sessionStorage.getItem("climatetwin_home") ?? "") ?
    sessionStorage.getItem("climatetwin_home")! : "H2");
  const [state, setState] = useState<ResidentState | null>(null);
  const [selection, setSelection] = useState<MapItem | null>(null);
  const [routeKind, setRouteKind] = useState<DemoRoute["kind"]>("recommended");
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState(0);
  const [routeNotice, setRouteNotice] = useState("");
  const requestId = useRef(0);
  const lastState = useRef<ResidentState | null>(null);

  function chooseHome(id: string) {
    if (id === homeId) return;
    sessionStorage.setItem("climatetwin_home", id);
    setRouteKind("recommended"); setRouteNotice(""); setSelection(null); setHomeId(id);
  }

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const id = ++requestId.current;
    try {
      const response = await fetch(`/api/resident/state?home_id=${homeId}&mode=WALK`, { cache: "no-store", signal });
      if (!response.ok) throw new Error(`Safety information is unavailable (${response.status}).`);
      const next = parseResidentState(await response.json());
      if (id !== requestId.current || signal?.aborted) return;
      const previous = lastState.current;
      if (previous?.run_id === next.run_id && previous.route.home_id === next.route.home_id &&
          previous.route.mode === next.route.mode) {
        const before = previous.route.road_ids.join();
        const after = next.route.road_ids.join();
        if (before !== after) setRouteNotice("Route updated — road conditions have changed.");
      } else if (previous?.run_id !== next.run_id) setRouteNotice("");
      lastState.current = next;
      setState((current) => current && sameResidentView(current, next) ? current : next);
      setUpdated(Date.now()); setError("");
    } catch (cause) {
      if (id === requestId.current && !signal?.aborted) setError(cause instanceof Error ? cause.message : "Connection lost.");
    }
  }, [homeId]);

  useEffect(() => {
    const controller = new AbortController();
    const requests = requestId;
    let timer: number | undefined;
    let running = false;
    let active = true;
    async function poll() {
      if (!active || running || document.hidden) return;
      running = true;
      try { await refresh(controller.signal); }
      finally {
        running = false;
        if (active && !document.hidden) timer = window.setTimeout(poll, 2000);
      }
    }
    const first = window.setTimeout(poll, 0);
    const onVisible = () => {
      if (document.hidden) { window.clearTimeout(timer); return; }
      window.clearTimeout(timer);
      void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => { active = false; controller.abort(); ++requests.current; clearTimeout(first); clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);
  useEffect(() => {
    if (!routeNotice) return;
    const timer = window.setTimeout(() => setRouteNotice(""), 6000);
    return () => window.clearTimeout(timer);
  }, [routeNotice]);
  const [now, setNow] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const stale = Boolean(state && now - updated > 6000);
  const data = state;
  const routeCurrent = Boolean(data && data.route.home_id === homeId && data.route.mode === "WALK");
  const summary = data ? residentSummary(data, homeId) : null;
  const routes = data && routeCurrent ? usableResidentRoutes(data, homeId) : [];
  const recommended = routes[0];
  const selectedRoute = routes.find((item) => item.kind === routeKind) ?? recommended;
  const mapRoute = selectedRoute ?? (data ? { ...data.route, home_id: homeId, mode: "WALK" as const, available: false, road_ids: [], node_ids: [] } : undefined);
  const routeAtRisk = Boolean(selectedRoute && data?.roads.some((road) => selectedRoute.road_ids.includes(road.id) && road.status === "AT_RISK"));

  return <main className="resident-page">
    <header className="resident-header"><Link href="/" className="resident-brand"><Waves size={28} /><span><strong>ClimateTwin AI</strong><small>RESIDENT SAFETY</small></span></Link><span className="resident-demo-label">Simulation</span></header>
    <div className="resident-container"><h1 className="resident-visually-hidden">Resident Safety township navigation</h1>
      {(error || stale) && <div className="resident-connection" role="status">{error || "Waiting for a fresh update."} Last received information may be out of date.</div>}
      {!data ? <section className="resident-loading" role="status">{error ? "Safety information is temporarily unavailable." : "Loading current township conditions…"}</section> : <>
        <section className={`resident-status status-${summary?.level ?? "unavailable"}`} aria-label="Nearby flood conditions" role="status">
          <div className="resident-status-icon">{summary?.level === "normal" ? <CircleCheck size={26} /> : summary?.level === "unavailable" ? <CircleHelp size={26} /> : <TriangleAlert size={26} />}</div><div><span>NEARBY FLOOD CONDITIONS · {summary?.home?.name ?? "Selected home"}</span><h2>{summary?.title}</h2>
            <p>{summary?.detail} This simulation does not predict flooding at individual homes.</p></div>
        </section>
        <section className="resident-navigation" aria-label="Township navigation">
          <div className="resident-home"><label htmlFor="resident-home-select">Select your home</label><select id="resident-home-select" value={homeId} onChange={(event) => chooseHome(event.target.value)}>
            {data.houses.map((home) => <option key={home.id} value={home.id}>{home.id} — {home.name}</option>)}
          </select></div>
          <div className="resident-map"><div className="resident-map-title"><MapPinned size={19} /><h2>Township map</h2></div>
          <DemoMap state={data} resident homeId={homeId} onHome={chooseHome} selection={selection} onSelect={setSelection} route={mapRoute} routeReady={routeCurrent} />
          {selection && <p className="resident-selection">{selection.kind === "road" ? `Selected road: ${data.roads.find((road) => road.id === selection.id)?.status.toLowerCase().replace("_", " ") ?? "status unavailable"}` : selection.kind === "home" ? `Selected home: ${selection.id}` : selection.kind === "shelter" ? "Community Shelter S1" : `Selected drainage area: ${data.zones.find((zone) => zone.id === selection.id)?.name ?? "unknown"}`}</p>}</div>
          <div className="resident-navigation-summary" aria-label="Shelter route" aria-busy={!routeCurrent}>
            <div className="resident-summary-heading"><div><span>DESTINATION</span><h2>Community Shelter {data.shelter.id}</h2></div><span className="resident-route-badge">{selectedRoute && selectedRoute !== recommended ? "Selected alternative" : "Recommended route"}</span></div>
            {routeNotice && routeCurrent && <p className="resident-route-notice" role="status">{routeNotice}</p>}
            {!routeCurrent ? <p className="resident-route-pending" role="status">Updating the shelter route for {homeId}…</p> : selectedRoute ? <>
              <div className="resident-journey-line"><strong>{travelDurationLabel(selectedRoute.travel_minutes)}</strong><span aria-hidden="true">·</span><span>{selectedRoute.distance_m?.toFixed(0)} m</span></div>
              <div className="resident-journey-meta"><span>Estimated on foot</span><span className={routeAtRisk || selectedRoute.forecast_assessment === "CLOSURE_MARGIN" ? "access-caution" : "access-open"}>{routeAtRisk || selectedRoute.forecast_assessment === "CLOSURE_MARGIN" ? "Use caution" : "Route available"}</span></div>
            </> : <><p className="resident-no-route" role="alert">No available shelter route in this simulation.</p><p className="resident-route-warning">Road access to the shelter is blocked in this simulation. Check nearby road conditions.</p></>}
            <details className="resident-route-details"><summary>Route details &amp; warnings</summary>
              <div className="resident-details-content">
                {routeNotice && <p>Road conditions changed in the simulation, so the shelter route was recalculated.</p>}
                {selectedRoute && (routeAtRisk || selectedRoute.forecast_assessment === "CLOSURE_MARGIN") && <p className="resident-route-warning">Some roads on this route are at risk or may close soon. Conditions may change.</p>}
                {selectedRoute && !routeAtRisk && selectedRoute.forecast_assessment !== "CLOSURE_MARGIN" && <p>No route roads are currently closed. Future conditions may change.</p>}
                {routeCurrent && routes.length > 1 && <div className="resident-alternatives"><h3>Other available routes</h3><div className="resident-alternative-list"><button type="button" aria-pressed={selectedRoute === recommended} onClick={() => setRouteKind("recommended")}><strong>Recommended route</strong><span>{travelDurationLabel(recommended.travel_minutes)} · {recommended.distance_m?.toFixed(0)} m</span></button>{routes.slice(1).map((option, index) => <button type="button" key={`${option.kind}-${option.road_ids.join()}`} aria-pressed={selectedRoute === option} onClick={() => setRouteKind(option.kind)}><strong>Alternative {index + 1}</strong><span>{travelDurationLabel(option.travel_minutes)} · {option.distance_m?.toFixed(0)} m</span></button>)}</div></div>}
                <small className="resident-assumption">Illustrative walking time uses a {Math.round(data.time_model.walk_speed_m_min)} m/min baseline and modelled road travel times.</small>
              </div>
            </details>
          </div>
        </section>
        <WaterForecasts state={data} />
      </>}
      <footer className="resident-footer">Synthetic township demonstration — not live flood information. Routes and shelter are illustrative and are not verified for real evacuation.</footer>
    </div>
  </main>;
}
