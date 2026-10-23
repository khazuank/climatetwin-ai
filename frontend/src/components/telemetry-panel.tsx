"use client";

import { useEffect, useState } from "react";
import { getIntelligence } from "@/lib/intelligence-client";
import type { IntelligenceSnapshot, SensorIntelligence } from "@/lib/intelligence";
import { getLatestTelemetry } from "@/lib/telemetry-client";
import { TELEMETRY_SENSOR_IDS, type LatestTelemetry, type TelemetrySensorId } from "@/lib/telemetry";

const sensorNames: Record<TelemetrySensorId, string> = {
  D1: "Drain D1",
  D2: "Drain D2",
  POND: "Retention pond",
};
const POLL_INTERVAL_MS = 1_000;
const RETRY_INTERVAL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 7_000;

type DashboardData = { intelligence: IntelligenceSnapshot; raw: LatestTelemetry };

function formatNumber(value: number | null, digits = 1): string {
  return value === null ? "—" : value.toFixed(digits);
}

function label(value: string): string {
  return value.toLowerCase().replaceAll("_", " ");
}

function trendLine(sensor: SensorIntelligence) {
  const values = sensor.recent_depths.map((point) => point.water_depth_cm);
  if (values.length < 2) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = Math.max(1, high - low);
  const path = values.map((value, index) =>
    `${index ? "L" : "M"} ${(index / (values.length - 1) * 160).toFixed(1)} ${(34 - (value - low) / range * 28).toFixed(1)}`,
  ).join(" ");
  return <svg className="intel-sparkline" viewBox="0 0 160 40" role="img" aria-label={`${sensor.sensor_id} recent depth trend`}>
    <path d={path} fill="none" stroke="currentColor" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
  </svg>;
}

export function TelemetryPanel() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [selected, setSelected] = useState<TelemetrySensorId>("D1");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    let pollTimer: number | undefined;
    let requestTimer: number | undefined;
    let controller: AbortController | undefined;

    async function poll() {
      const startedAt = Date.now();
      let succeeded = false;
      controller = new AbortController();
      requestTimer = window.setTimeout(() => controller?.abort(), REQUEST_TIMEOUT_MS);
      try {
        const [intelligenceResult, rawResult] = await Promise.allSettled([
          getIntelligence(controller.signal),
          getLatestTelemetry(controller.signal),
        ]);
        if (intelligenceResult.status !== "fulfilled" || rawResult.status !== "fulfilled") {
          throw new Error("Telemetry services unavailable");
        }
        if (active) {
          setData({ intelligence: intelligenceResult.value, raw: rawResult.value });
          setError(false);
          setLoading(false);
        }
        succeeded = true;
      } catch {
        if (active) {
          setError(true);
          setLoading(false);
        }
      } finally {
        window.clearTimeout(requestTimer);
        controller = undefined;
        if (active) {
          pollTimer = window.setTimeout(poll, succeeded
            ? Math.max(250, POLL_INTERVAL_MS - (Date.now() - startedAt))
            : RETRY_INTERVAL_MS);
        }
      }
    }

    void poll();
    return () => {
      active = false;
      window.clearTimeout(pollTimer);
      window.clearTimeout(requestTimer);
      controller?.abort();
    };
  }, []);

  const live = error ? null : data;
  const analysis = live?.intelligence.sensors[selected];
  const overall = live?.intelligence.overall_warning_state ?? "UNKNOWN";
  const hasPhysical = Boolean(analysis?.received_at_utc);
  const urgentSensor = live && TELEMETRY_SENSOR_IDS.find((id) =>
    ["CRITICAL", "WARNING"].includes(live.intelligence.sensors[id].warning_state));
  const recommendation = !live
    ? "Reconnect to the telemetry service before assessing flood risk."
    : overall === "UNKNOWN" && analysis?.warning_state !== "UNKNOWN"
      ? "Verify every sensor before making a township-wide flood-risk decision."
      : analysis?.recommendation ?? "Await physical telemetry.";

  return <section className="intelligence-dashboard" aria-label="Rule-based flood intelligence">
    <div className="intel-header">
      <div>
        <span className="intel-eyebrow">PHYSICAL TELEMETRY / RULE-BASED ANALYSIS</span>
        <h2>Flood intelligence</h2>
        <p>Explainable measurements from ESP32 B. Physical calibration is required before risk estimates appear.</p>
      </div>
      <div className={`intel-connection ${error ? "is-disconnected" : ""}`} role="status">
        <span className="intel-connection-dot" />
        {loading ? "Connecting" : error ? "Disconnected · retrying" : "FastAPI connected"}
      </div>
    </div>

    <div className="intel-selection" role="group" aria-label="Inspect sensor">
      <span>Inspect channel</span>
      <div>
        {TELEMETRY_SENSOR_IDS.map((id) => <button key={id} type="button"
          aria-pressed={selected === id} onClick={() => setSelected(id)}>{id}</button>)}
      </div>
    </div>

    <div className="intel-primary">
      <div className="intel-risk">
        <span className="intel-label">Flood risk · all channels</span>
        <strong className={`intel-risk-state risk-${overall.toLowerCase()}`}>{loading ? "Loading" : overall}</strong>
        <p>{error ? "Live analysis is unavailable. Previous data is hidden." :
          overall === "UNKNOWN" ? urgentSensor
            ? `Coverage incomplete. ${urgentSensor} has a ${live?.intelligence.sensors[urgentSensor].warning_state.toLowerCase()} state.`
            : "At least one channel lacks a fresh, reliable, verified measurement." :
          overall === "CRITICAL" ? "Prototype critical rule reached. Overflow has not been confirmed." :
          "Prototype warning state from verified sensor measurements."}</p>
      </div>
      <div className="intel-metric">
        <span className="intel-label">Current water depth · {selected}</span>
        <strong>{formatNumber(analysis?.water_depth_cm ?? null)}<small>{analysis?.water_depth_cm == null ? "" : " cm"}</small></strong>
        <p>{analysis?.overflow_fill_percent == null
          ? "Requires a valid, verified sensor calibration"
          : `${analysis.overflow_fill_percent.toFixed(1)}% of configured overflow height`}</p>
      </div>
      <div className="intel-metric">
        <span className="intel-label">Rise rate · {selected}</span>
        <strong>{formatNumber(analysis?.rise_rate_cm_per_min ?? null)}<small>{analysis?.rise_rate_cm_per_min == null ? "" : " cm/min"}</small></strong>
        <p>{analysis?.trend && analysis.trend !== "UNKNOWN" ? label(analysis.trend) : "Trend unavailable"}</p>
      </div>
      <div className="intel-metric">
        <span className="intel-label">Estimated overflow time · {selected}</span>
        <strong>{analysis?.estimated_overflow_minutes == null ? "—" : formatNumber(analysis.estimated_overflow_minutes)}<small>{analysis?.estimated_overflow_minutes == null ? "" : " min"}</small></strong>
        <p>Linear trend estimate only when rise is credible</p>
      </div>
    </div>

    <div className="intel-recommendation">
      <div>
        <span className="intel-label">Intelligence recommendation</span>
        <strong>{recommendation}</strong>
      </div>
      <p>{error ? "Connection lost; no current interpretation is displayed." :
        analysis?.explanation ?? "Waiting for the first physical reading."}</p>
    </div>

    <div className="intel-secondary">
      <div className="intel-section-heading">
        <div><h3>Sensor status</h3><p>Raw distance remains visible even when depth cannot be calculated.</p></div>
        <span>Last analysis {live?.intelligence.server_timestamp_utc ?? "—"}</span>
      </div>
      <div className="intel-sensor-list">
        {TELEMETRY_SENSOR_IDS.map((id) => {
          const item = live?.intelligence.sensors[id];
          const raw = live?.raw.readings[id];
          const source = raw ? raw.simulated ? "Simulated test" : "Physical" : "No packet";
          return <button className={`intel-sensor-row ${selected === id ? "is-selected" : ""}`}
            key={id} type="button" onClick={() => setSelected(id)} aria-label={`Inspect ${sensorNames[id]}`}>
            <span className="intel-sensor-name"><b>{id}</b><small>{sensorNames[id]}</small></span>
            <span><small>Latest packet · {source}</small><b>{raw ? `${raw.distance_cm.toFixed(1)} cm` : "—"}</b></span>
            <span><small>Physical freshness</small><b>{!item?.received_at_utc ? "No reading" : item.measurement_quality === "STALE" ? "Stale" : `${Math.max(0, item.age_seconds ?? 0).toFixed(0)} s ago`}</b></span>
            <span><small>Measurement quality</small><b>{item ? label(item.measurement_quality) : "—"}</b></span>
            <span><small>Calibration</small><b>{item ? label(item.calibration_status) : "—"}</b></span>
            <span className={`intel-row-state risk-${(item?.warning_state ?? "UNKNOWN").toLowerCase()}`}>{item?.warning_state ?? "UNKNOWN"}</span>
          </button>;
        })}
      </div>
      <div className="intel-inspector">
        <div>
          <span className="intel-label">{selected} / MEASUREMENT DETAIL</span>
          <p>{hasPhysical ? `Last physical reading: ${analysis?.latest_distance_cm?.toFixed(1)} cm at ${analysis?.received_at_utc}` : "No physical reading has been received for this channel."}</p>
          <p>{analysis?.calibration_status === "VERIFIED"
            ? `Verified geometry: sensor ${analysis.calibration.sensor_height_cm} cm, overflow ${analysis.calibration.overflow_height_cm} cm, minimum reliable distance ${analysis.calibration.minimum_reliable_distance_cm} cm.`
            : analysis?.calibration_status === "UNVERIFIED"
              ? "Geometry is configured but has not been checked against ruler measurements."
              : "Mounting geometry has not been assigned to this channel."}</p>
        </div>
        {analysis && trendLine(analysis)}
      </div>
      {live && live.intelligence.transitions.length > 0 && <div className="intel-transitions">
        <span className="intel-label">Recent state changes</span>
        {live.intelligence.transitions.slice(-3).reverse().map((transition, index) =>
          <p key={`${transition.sensor_id}-${transition.at_utc}-${index}`}>
            <b>{transition.sensor_id}</b> {transition.from_state} → {transition.to_state}
            <span>{transition.at_utc}</span>
          </p>)}
      </div>}
    </div>

    <p className="intel-footnote">Prototype thresholds are operational demo rules. A 3 cm pipe can cause wall echoes, and a 25 cm blind zone may hide water near a 40 cm overflow outlet. A critical state does not confirm overflow. In-memory history resets when FastAPI restarts. No physical pump is controlled.</p>
  </section>;
}
