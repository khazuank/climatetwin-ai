import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const base = process.env.FASTAPI_BASE_URL ?? "http://127.0.0.1:8000";
  try {
    const response = await fetch(new URL("/api/auth/session", `${base.replace(/\/$/, "")}/`), {
      headers: { Cookie: request.headers.get("cookie") ?? "" },
      signal: AbortSignal.timeout(4_000), cache: "no-store",
    });
    if (response.ok) return NextResponse.next();
  } catch { /* Unavailable sessions cannot authorize Management. */ }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = { matcher: "/management/:path*" };
