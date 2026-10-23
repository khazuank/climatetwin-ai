import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DemoProvider } from "@/components/demo-provider";
import { DemoDashboard } from "@/components/demo-dashboard";

export const instant = false;

export default async function ManagementPage() {
  const base = process.env.FASTAPI_BASE_URL ?? "http://127.0.0.1:8000";
  const cookie = (await cookies()).toString();
  let authorized = false;
  try {
    const response = await fetch(new URL("/api/auth/session", `${base.replace(/\/$/, "")}/`),
      { headers: { Cookie: cookie }, cache: "no-store", signal: AbortSignal.timeout(4_000) });
    authorized = response.ok;
  } catch { /* Redirect if the backend is unavailable. */ }
  if (!authorized) redirect("/login");
  return <DemoProvider><DemoDashboard role="management" /></DemoProvider>;
}
