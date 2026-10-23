import { parseLatestTelemetry } from "@/lib/telemetry";

export async function GET() {
  const baseUrl = process.env.FASTAPI_BASE_URL ?? "http://127.0.0.1:8000";

  try {
    const response = await fetch(
      new URL("/api/telemetry/latest", `${baseUrl.replace(/\/$/, "")}/`),
      { cache: "no-store", signal: AbortSignal.timeout(4_000) },
    );
    if (!response.ok) {
      return Response.json(
        { error: "FastAPI telemetry is unavailable." },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const telemetry = parseLatestTelemetry(await response.json());
    return Response.json(telemetry, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "FastAPI telemetry is unavailable or malformed." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
