"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";

export function ManagementLogout({ onLoggedOut = () => window.location.replace("/") }: { onLoggedOut?: () => void }) {
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setError("");
    try {
      const session = await fetch("/api/auth/session", { cache: "no-store" });
      if (session.status === 401) { onLoggedOut(); return; }
      if (!session.ok) throw new Error("Could not check your session. Please try again.");
      const { csrf_token } = await session.json();
      const response = await fetch("/api/auth/logout", { method: "POST", headers: { "X-CSRF-Token": csrf_token } });
      if (!response.ok) throw new Error("Logout did not complete. Please try again.");
      onLoggedOut();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Logout did not complete. Please try again.");
      setLoggingOut(false);
    }
  }

  return <><button type="button" className="management-logout" disabled={loggingOut} onClick={() => void logout()}>
    <LogOut size={16} />{loggingOut ? "Logging out…" : "Log out"}</button>
    {error && <span className="management-logout-error" role="alert">{error}</span>}</>;
}
