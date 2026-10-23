import { parseIntelligence } from "@/lib/intelligence";

export async function GET() {
  const baseUrl = process.env.FASTAPI_BASE_URL ?? "http://127.0.0.1:8000";
  try {
    const response = await fetch(
      new URL("/api/intelligence", `${baseUrl.replace(/\/$/, "")}/`),
      { cache: "no-store", signal: AbortSignal.timeout(4_000) },
    );
    if (!response.ok) {
      return Response.json({ error: "FastAPI intelligence is unavailable." },
        { status: 502, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json(parseIntelligence(await response.json()),
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "FastAPI intelligence is unavailable or malformed." },
      { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
