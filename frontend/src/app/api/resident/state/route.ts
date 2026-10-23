export async function GET(request: Request) {
  const base = process.env.FASTAPI_BASE_URL ?? "http://127.0.0.1:8000";
  try {
    const upstream = await fetch(new URL(`/api/resident/state${new URL(request.url).search}`,
      `${base.replace(/\/$/, "")}/`), { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    return new Response(await upstream.text(), { status: upstream.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ detail: "Resident safety information is temporarily unavailable." }, { status: 502 });
  }
}
