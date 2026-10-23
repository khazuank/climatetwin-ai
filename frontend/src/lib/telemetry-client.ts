import { parseLatestTelemetry, type LatestTelemetry } from "./telemetry";

/** Browser client for the same-origin Next.js proxy; no FastAPI address reaches the browser. */
export async function getLatestTelemetry(signal: AbortSignal): Promise<LatestTelemetry> {
  const response = await fetch("/api/telemetry/latest", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Telemetry service unavailable");
  return parseLatestTelemetry(await response.json());
}
