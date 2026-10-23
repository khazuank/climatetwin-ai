import { parseDemoState, type DemoCommand, type DemoState, type Role, type TravelMode } from "./demo";
import { parseAiResponse } from "./ai";

async function request(path: string, options: RequestInit = {}): Promise<DemoState> {
  const response = await fetch(`/api/demo/${path}`, { cache: "no-store", ...options });
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined" && window.location.pathname === "/management") {
      window.location.assign("/login");
    }
    let detail = `Demo service returned ${response.status}`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch { /* retain status text */ }
    throw new Error(detail);
  }
  return parseDemoState(await response.json());
}

export function getDemoState(homeId: string, mode: TravelMode = "WALK", signal?: AbortSignal) {
  return request(`state?home_id=${encodeURIComponent(homeId)}&mode=${mode}`, { signal });
}

export async function getAiPredictions(homeId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/demo/ai/v1/predictions?home_id=${encodeURIComponent(homeId)}`,
    { cache: "no-store", signal });
  if (!response.ok) throw new Error(`AI service returned ${response.status}`);
  return parseAiResponse(await response.json());
}
export function sendDemoCommand(command: DemoCommand) {
  return managementPost("command", JSON.stringify(command));
}
export function resetDemo() {
  return managementPost("reset");
}
export function acknowledgeDemoEvent(eventId: number, role: Role) {
  return managementPost("acknowledge", JSON.stringify({ event_id: eventId, role }));
}

async function managementPost(path: string, body?: string) {
  const response = await fetch("/api/auth/session", { cache: "no-store" });
  if (response.status === 401) { window.location.assign("/login"); throw new Error("Session expired."); }
  if (!response.ok) throw new Error("Management session unavailable.");
  const { csrf_token } = await response.json();
  return request(path, { method: "POST", headers: { "X-CSRF-Token": csrf_token,
    ...(body ? { "Content-Type": "application/json" } : {}) }, body });
}
