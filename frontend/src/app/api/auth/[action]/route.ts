type Context = { params: Promise<{ action: string }> };

async function forward(request: Request, action: string, method: "GET" | "POST") {
  if (!({ GET: ["session"], POST: ["login", "logout"] }[method].includes(action))) {
    return Response.json({ detail: "Unknown authentication action" }, { status: 404 });
  }
  const base = process.env.FASTAPI_BASE_URL ?? "http://127.0.0.1:8000";
  try {
    const upstream = await fetch(new URL(`/api/auth/${action}`, `${base.replace(/\/$/, "")}/`), {
      method, cache: "no-store", signal: AbortSignal.timeout(8_000),
      headers: { Cookie: request.headers.get("cookie") ?? "",
        "X-CSRF-Token": request.headers.get("x-csrf-token") ?? "",
        "X-Forwarded-Proto": new URL(request.url).protocol.slice(0, -1),
        ...(method === "POST" && action === "login" ? { "Content-Type": "application/json" } : {}) },
      body: method === "POST" && action === "login" ? await request.text() : undefined,
    });
    const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
    const cookie = upstream.headers.get("set-cookie");
    if (cookie) headers.set("Set-Cookie", cookie);
    return new Response(await upstream.text(), { status: upstream.status, headers });
  } catch {
    return Response.json({ detail: "Management sign-in service is unavailable." }, { status: 502 });
  }
}

export async function GET(request: Request, context: Context) {
  return forward(request, (await context.params).action, "GET");
}
export async function POST(request: Request, context: Context) {
  return forward(request, (await context.params).action, "POST");
}
