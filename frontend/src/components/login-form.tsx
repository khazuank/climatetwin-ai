"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }) });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(response.status === 401 ? "Invalid username or password." : body.detail ?? "Sign-in failed.");
      }
      router.replace("/management"); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Sign-in failed."); }
    finally { setBusy(false); }
  }
  return <form className="login-form" onSubmit={submit}>
    <label htmlFor="username">Username</label><input id="username" name="username" autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} />
    <label htmlFor="password">Password</label><div className="login-password"><input id="password" name="password" autoComplete="current-password" required type={show ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} />
      <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>{show ? "Hide" : "Show"}</button></div>
    {error && <p className="login-error" role="alert">{error}</p>}
    <button className="login-submit" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign In"}</button>
  </form>;
}
