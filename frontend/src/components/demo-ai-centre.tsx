"use client";

import { useState } from "react";
import type { AiResponse } from "@/lib/ai";
import { buildAiChart, chartYRange, displayDepthCm, type ChartScale } from "@/lib/ai";
import { aiForecastAvailability, type AiFeed } from "@/lib/ai-feed";
import type { DemoState, ZoneId } from "@/lib/demo";

const zoneLabel: Record<ZoneId, string> = { D1: "Drain 1", D2: "Drain 2", POND: "Retention Pond" };

function ForecastChart({ state, ai, zoneId, stale }: { state: DemoState; ai: AiResponse | null; zoneId: ZoneId; stale: boolean }) {
  const [scale, setScale] = useState<ChartScale>("detail");
  const zone = state.zones.find((item) => item.id === zoneId)!;
  const { observed, forecast, verified } = buildAiChart(state, zoneId, ai);
  const baseline = [{ minute: state.minute, cm: zone.depth_cm },
    ...zone.baseline_forecasts.map((item) => ({ minute: state.minute + item.horizon_min, cm: displayDepthCm(item.predicted_cm) }))];
  const first = Math.min(...[...observed, ...forecast, ...baseline].map((item) => item.minute));
  const last = Math.max(...[...observed, ...forecast, ...baseline].map((item) => item.minute));
  const prior = verified.filter((item) => item.due_minute >= first && item.due_minute <= state.minute);
  const values = [...observed, ...forecast, ...baseline];
  if (!values.length) return <p className="demo-empty-copy">Waiting for simulated water readings.</p>;
  const axis = chartYRange(values.map((item) => item.cm), zone.flood_threshold_cm, scale);
  const visiblePrior = prior.filter((item) =>
    displayDepthCm(item.predicted_cm) >= axis.min && displayDepthCm(item.predicted_cm) <= axis.max);
  const left = 48, right = 420, top = 28, bottom = 174;
  const x = (minute: number) => left + (minute - first) / Math.max(1, last - first) * (right - left);
  const y = (cm: number) => bottom - (displayDepthCm(cm) - axis.min) / (axis.max - axis.min) * (bottom - top);
  const points = (items: { minute: number; cm: number }[]) =>
    items.map((item) => `${x(item.minute).toFixed(1)},${y(item.cm).toFixed(1)}`).join(" ");
  const ticks = [axis.min, (axis.min + axis.max) / 2, axis.max];
  const format = (cm: number) => Number.isInteger(cm) ? cm.toFixed(0) : cm.toFixed(1);
  return <div className="demo-ai-chart-wrap">
    <div className="demo-chart-heading"><strong>Water levels over simulated time</strong>
      <div className="demo-chart-scale" role="group" aria-label="Chart scale">
        <button type="button" aria-pressed={scale === "detail"} className={scale === "detail" ? "is-active" : ""}
          onClick={() => setScale("detail")}>Detailed View</button>
        <button type="button" aria-pressed={scale === "full"} className={scale === "full" ? "is-active" : ""}
          onClick={() => setScale("full")}>Full Scale</button>
      </div></div>
    <svg className="demo-ai-chart" viewBox="0 0 440 230" role="img"
      aria-label={`${zoneLabel[zoneId]} water-depth chart in centimetres, ${scale === "detail" ? "detailed" : "full"} scale from ${format(axis.min)} to ${format(axis.max)} cm`}>
      <text x={left} y="16" className="demo-ai-axis-title">Water depth (cm)</text>
      {ticks.map((tick, index) => <g key={index}>
        <line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className="demo-ai-gridline" />
        <text x={left - 7} y={y(tick) + 4} textAnchor="end" className="demo-ai-chart-label">{format(tick)}</text>
      </g>)}
      {axis.warningVisible && <>
        <line x1={left} x2={right} y1={y(zone.flood_threshold_cm)} y2={y(zone.flood_threshold_cm)} className="demo-ai-threshold" />
        <text x={right - 3} y={Math.max(top + 12, y(zone.flood_threshold_cm) - 5)}
          textAnchor="end" className="demo-ai-threshold-label">Warning {format(zone.flood_threshold_cm)} cm</text>
      </>}
      <line x1={left} x2={right} y1={bottom} y2={bottom} className="demo-ai-axis" />
      {observed.length > 1 && <polyline points={points(observed)} className="demo-ai-actual-line" />}
      <polyline points={points(baseline)} className="demo-ai-baseline-line" />
      {forecast.length > 1 && <polyline points={points(forecast)} className="demo-ai-forecast-line" />}
      {observed.map((item) => <circle key={item.minute} cx={x(item.minute)} cy={y(item.cm)}
        r={item.minute === state.minute ? "4" : "2.5"} className="demo-ai-actual-point">
        <title>Simulated minute {item.minute}: {item.cm.toFixed(1)} cm observed.</title>
      </circle>)}
      {baseline.slice(1).map((item) => <circle key={item.minute} cx={x(item.minute)} cy={y(item.cm)}
        r="4" className="demo-ai-baseline-point">
        <title>Comparison forecast for minute {item.minute}: {item.cm.toFixed(1)} cm.</title>
      </circle>)}
      {forecast.slice(1).map((item) => <circle key={item.minute} cx={x(item.minute)} cy={y(item.cm)}
        r="4.5" className="demo-ai-forecast-point">
        <title>Trained AI forecast for minute {item.minute}: {item.cm.toFixed(1)} cm.</title>
      </circle>)}
      {visiblePrior.map((item) => <circle key={item.minute} cx={x(item.due_minute)}
        cy={y(displayDepthCm(item.predicted_cm))} r="4" className="demo-ai-prior-point">
        <title>Earlier AI estimate {displayDepthCm(item.predicted_cm).toFixed(1)} cm; observed simulated level {item.observed_cm?.toFixed(1)} cm.</title>
      </circle>)}
      {[first, state.minute, state.minute + 5, state.minute + 10, state.minute + 20]
        .filter((minute, index, all) => all.indexOf(minute) === index && minute <= last)
        .map((minute) => <g key={minute}>
          <line x1={x(minute)} x2={x(minute)} y1={bottom} y2={bottom + 4} className="demo-ai-axis" />
          <text x={x(minute)} y="194" textAnchor="middle" className="demo-ai-chart-label">
            {minute === state.minute ? "Now" : minute > state.minute ? `+${minute - state.minute}` : `Min ${minute}`}
          </text>
          <text x={x(minute)} y="207" textAnchor="middle" className="demo-ai-minute-label">{minute}</text>
        </g>)}
      <text x={(left + right) / 2} y="225" textAnchor="middle" className="demo-ai-axis-title">Simulated minute</text>
    </svg>
    {!axis.warningVisible && <p className="demo-ai-threshold-note">The {format(zone.flood_threshold_cm)} cm warning level is outside this detailed view. Choose Full Scale to see it.</p>}
    <div className="demo-ai-chart-legend"><span><i className="actual" /> Actual simulated readings</span>
      {forecast.length > 1 && <span><i className="ml" /> {stale ? `Trained AI prediction from min ${ai?.simulation_minute}` : "Trained AI prediction"}</span>}
      <span><i className="baseline" /> Comparison forecast</span>
      {axis.warningVisible && <span><i className="rule" /> Warning level</span>}
      {visiblePrior.length > 0 && <span><i className="prior" /> Earlier AI estimate</span>}</div>
    {visiblePrior.length < prior.length && <p className="demo-ai-chart-note">Some earlier AI estimates are outside this view.</p>}
  </div>;
}

export function AiIntelligenceCentre({ state, feed, zoneId, onZone }: {
  state: DemoState; feed: AiFeed;
  zoneId: ZoneId; onZone: (id: ZoneId) => void;
}) {
  const current = state.zones.find((item) => item.id === zoneId)!;
  const { forecast: ai, status } = aiForecastAvailability(feed, state.scenario, state.run_id, state.minute);
  const prediction = ai?.zones.find((item) => item.id === zoneId);
  const stale = Boolean(ai && status !== "ready");
  const ten = prediction?.forecasts.find((item) => item.horizon_min === 10);
  const levelPercent = current.depth_cm / current.flood_threshold_cm * 100;
  const trend = current.trend === "RISING" ? "rising" : current.trend === "FALLING" ? "falling" : "steady";
  const eta = current.flood_eta;
  const warning = eta.status === "FLOODED_NOW" ? "Warning level reached." :
    eta.status === "ESTIMATED" ? `Warning level possible in about ${Math.ceil(eta.minutes ?? 0)} min.` :
    eta.status === "NOT_PREDICTED" ? `No warning level expected in the next ${state.time_model.forecast_horizon_min} min.` :
    "Warning timing unavailable.";
  return <section className="demo-intelligence-card demo-ai-centre" aria-label="Flood Predictions">
    <div className="demo-card-heading"><div><h2>Flood Predictions</h2>
      <p>See current water levels and what may happen next.</p></div>
      <span className={`demo-ai-status ${status === "ready" ? "is-ready" : status === "stale" || status === "synchronizing" ? "is-stale" : ""}`}>
        {status === "ready" ? "Trained AI forecast" : status === "stale" ? "Earlier AI forecast" :
          status === "synchronizing" ? "Forecast synchronizing" :
          status === "unavailable" ? "AI forecast unavailable" : status === "delayed" ? "Forecast refresh delayed" : "AI forecast loading"}
        {feed.refreshing && <small className="demo-ai-updating"> · updating</small>}</span></div>
    <div className="demo-ai-zone-tabs" role="group" aria-label="Prediction zone">
      {state.zones.map((zone) => <button type="button" key={zone.id}
        aria-pressed={zoneId === zone.id} className={zoneId === zone.id ? "is-active" : ""}
        onClick={() => onZone(zone.id)}>{zoneLabel[zone.id]} <small>{zone.id}</small></button>)}
    </div>
    <div className="demo-ai-current"><div><span>Water level now</span><strong>{current.depth_cm.toFixed(1)} <small>cm</small></strong>
      <p>{levelPercent.toFixed(0)}% of {current.flood_threshold_cm.toFixed(0)} cm warning level{levelPercent > 100 ? " · above warning level" : ""}</p></div>
      <span className={`demo-risk-chip risk-${current.risk.toLowerCase()}`}>{current.risk.toLowerCase()} · {trend}</span></div>
    <div className="demo-ai-plain"><div><h3>Next 10 minutes</h3>
        {ten ? <p>{stale ? `Earlier AI forecast: ${displayDepthCm(ten.predicted_cm).toFixed(1)} cm for minute ${(ai?.simulation_minute ?? 0) + 10}.` :
          `AI forecast: about ${displayDepthCm(ten.predicted_cm).toFixed(1)} cm.`} {warning}</p>
          : <p>{warning} {status === "unavailable" ? "AI forecast unavailable." : "AI forecast loading."}</p>}</div>
    </div>
    {stale && <p className="demo-ai-refresh-note">Last successful forecast: simulated minute {ai?.simulation_minute} ({state.scenario.toLowerCase()} scenario); displayed state: minute {state.minute}. {status === "unavailable" ? `Current inference failed${feed.error ? `: ${feed.error}` : "."}` : feed.failure === "transport" ? "Refresh delayed; saved values are shown." : "Synchronizing forecast and simulation time."}</p>}
    {!ai && status === "unavailable" && feed.error && <p className="demo-ai-refresh-note">{feed.error}</p>}
    <div className="demo-ai-forecast-grid" aria-label="Trained AI water level forecasts">
      {([5, 10, 20] as const).map((horizon) => {
        const item = prediction?.forecasts.find((forecast) => forecast.horizon_min === horizon);
        return <div key={horizon}><span>{stale ? `For min ${(ai?.simulation_minute ?? 0) + horizon}` : `In ${horizon} min`}</span><strong>{item ? `${displayDepthCm(item.predicted_cm).toFixed(1)} cm` : "—"}</strong>
          <small>{item ? stale ? `Trained AI · from min ${ai?.simulation_minute}` : "Trained AI · simulated" : status === "unavailable" ? "Inference unavailable" : "Awaiting forecast"}</small></div>;
      })}
    </div>
    <ForecastChart state={state} ai={ai} zoneId={zoneId} stale={stale} />
    <p className="demo-ai-limitation">AI forecasts use simulated data.</p>
  </section>;
}

export function InterventionComparison({ ai }: { ai: AiResponse | null }) {
  const branch = ai?.intervention;
  const off = branch?.p2_off.D2_depth_cm;
  const on = branch?.p2_on.D2_depth_cm;
  return <section className="demo-pump-card demo-ai-intervention" aria-label="Pump 2 intervention comparison">
    <div className="demo-card-title"><h2>What if Pump 2 is turned on?</h2><span>SIMULATED COMPARISON · IN 20 MIN</span></div>
    {branch && off != null && on != null && branch.p2_on.available ? <>
      <div className="demo-ai-branches"><div><span>Pump 2 off</span><strong>{off.toFixed(1)} cm</strong>
        <small>{branch.p2_off.blocked_road_ids?.length ?? 0} blocked roads</small></div>
        <div><span>Pump 2 on</span><strong>{on.toFixed(1)} cm</strong>
          <small>{branch.p2_on.blocked_road_ids?.length ?? 0} blocked roads</small></div></div>
      {branch.D2_reduction_cm !== null && <p className="demo-ai-branch-recommendation">About {branch.D2_reduction_cm.toFixed(1)} cm less water in Drain 2 in this simulated comparison.</p>}
    </> : <p>{branch?.p2_on.reason ?? "The simulated comparison is loading or Pump 2 cannot operate at the current water level."}</p>}
    <small>Simulator comparison only · Pump 2 stays unchanged.</small>
  </section>;
}
