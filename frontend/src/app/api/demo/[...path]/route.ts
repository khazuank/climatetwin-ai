const ALLOWED_GET = new Set(["state", "history", "route", "ai/v1/predictions"]);
const ALLOWED_POST = new Set(["command", "reset", "acknowledge"]);

async function forward(path: string, method: "GET" | "POST", request: Request) {
  const baseUrl = process.env.FASTAPI_BASE_URL ?? "http://127.0.0.1:8000";
  const search = method === "GET" ? new URL(request.url).search : "";
  try {
    const upstream = await fetch(
      new URL(`/api/demo/${path}${search}`, `${baseUrl.replace(/\/$/, "")}/`),
      { method, cache: "no-store", signal: AbortSignal.timeout(8_000),
        headers: {
          Cookie: request.headers.get("cookie") ?? "",
          "X-CSRF-Token": request.headers.get("x-csrf-token") ?? "",
          ...(method === "POST" && path !== "reset" ? { "Content-Type": "application/json" } : {}),
        },
        body: method === "POST" && path !== "reset" ? await request.text() : undefined },
    );
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ detail: "Synthetic demo backend is unavailable." },
      { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: Request, context: Context) {
  const path = (await context.params).path.join("/");
  if (!ALLOWED_GET.has(path)) return Response.json({ detail: "Unknown demo resource" }, { status: 404 });
  return forward(path, "GET", request);
}
export async function POST(request: Request, context: Context) {
  const path = (await context.params).path.join("/");
  if (!ALLOWED_POST.has(path)) return Response.json({ detail: "Unknown demo command" }, { status: 404 });
  return forward(path, "POST", request);
}
