import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ManagementLogout } from "../src/components/management-logout";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("logs out with the session CSRF token before leaving Management", async () => {
  const onLoggedOut = vi.fn();
  const fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ csrf_token: "session-csrf" }) })
    .mockResolvedValueOnce({ ok: true, status: 200 });
  vi.stubGlobal("fetch", fetch);
  render(<ManagementLogout onLoggedOut={onLoggedOut} />);
  fireEvent.click(screen.getByRole("button", { name: "Log out" }));
  await waitFor(() => expect(onLoggedOut).toHaveBeenCalledOnce());
  expect(fetch).toHaveBeenNthCalledWith(1, "/api/auth/session", { cache: "no-store" });
  expect(fetch).toHaveBeenNthCalledWith(2, "/api/auth/logout", {
    method: "POST", headers: { "X-CSRF-Token": "session-csrf" },
  });
});

it("stays on Management and reports a failed logout", async () => {
  const onLoggedOut = vi.fn();
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ csrf_token: "session-csrf" }) })
    .mockResolvedValueOnce({ ok: false, status: 502 }));
  render(<ManagementLogout onLoggedOut={onLoggedOut} />);
  fireEvent.click(screen.getByRole("button", { name: "Log out" }));
  await screen.findByRole("alert");
  expect(onLoggedOut).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Log out" }).hasAttribute("disabled")).toBe(false);
});
