"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { acknowledgeDemoEvent, getAiPredictions, getDemoState, resetDemo, sendDemoCommand } from "@/lib/demo-client";
import type { AiResponse } from "@/lib/ai";
import { beginAiRefresh, failAiRefresh, initialAiFeed, receiveAiRefresh, type AiFeed } from "@/lib/ai-feed";
import type { DemoCommand, DemoState, Role, TravelMode } from "@/lib/demo";

interface DemoContextValue {
  state: DemoState | null;
  ai: AiResponse | null;
  aiFeed: AiFeed;
  homeId: string;
  setHomeId: (id: string) => void;
  mode: TravelMode;
  setMode: (mode: TravelMode) => void;
  loading: boolean;
  busy: boolean;
  error: string | null;
  command: (command: DemoCommand) => Promise<void>;
  reset: () => Promise<void>;
  acknowledge: (eventId: number, role: Role) => Promise<void>;
}

const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState | null>(null);
  const [aiFeed, setAiFeed] = useState<AiFeed>(initialAiFeed);
  const [homeId, setHomeId] = useState("H2");
  const [mode, setMode] = useState<TravelMode>("WALK");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const pollControllerRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    const requests = requestIdRef;
    let active = true;
    let timer: number | undefined;
    async function poll() {
      if (busyRef.current) {
        timer = window.setTimeout(poll, 1_000);
        return;
      }
      const requestId = ++requestIdRef.current;
      const controller = new AbortController();
      pollControllerRef.current = controller;
      setAiFeed((feed) => beginAiRefresh(feed, requestId));
      try {
        const next = await getDemoState(homeId, mode, controller.signal);
        if (active && requestId === requestIdRef.current) {
          setState(next);
          setError(null);
          setLoading(false);
        }
        if (!active || requestId !== requestIdRef.current) return;
        try {
          const prediction = await getAiPredictions(homeId, controller.signal);
          if (active && requestId === requestIdRef.current) {
            setAiFeed((feed) => receiveAiRefresh(feed, requestId, prediction, next.scenario, next.run_id));
          }
        } catch (cause) {
          if (active && requestId === requestIdRef.current && !controller.signal.aborted) {
            setAiFeed((feed) => failAiRefresh(feed, requestId,
              cause instanceof Error ? cause.message : "AI refresh delayed"));
          }
        }
      } catch (cause) {
        if (active && requestId === requestIdRef.current && !controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Demo backend unavailable");
          setLoading(false);
          setAiFeed((feed) => failAiRefresh(feed, requestId,
            cause instanceof Error ? cause.message : "Simulation refresh delayed"));
        }
      } finally {
        if (pollControllerRef.current === controller) pollControllerRef.current = null;
        if (active) timer = window.setTimeout(poll, 1_000);
      }
    }
    void poll();
    return () => {
      active = false;
      ++requests.current;
      window.clearTimeout(timer);
      pollControllerRef.current?.abort();
    };
  }, [homeId, mode]);

  async function perform(action: () => Promise<DemoState>) {
    if (busyRef.current) return;
    busyRef.current = true;
    const requestId = ++requestIdRef.current;
    pollControllerRef.current?.abort();
    setBusy(true);
    setAiFeed((feed) => beginAiRefresh(feed, requestId));
    try {
      await action();
      if (requestId !== requestIdRef.current) return;
      const next = await getDemoState(homeId, mode);
      if (requestId !== requestIdRef.current) return;
      setState(next);
      setError(null);
      try {
        const prediction = await getAiPredictions(homeId);
        if (requestId === requestIdRef.current) {
          setAiFeed((feed) => receiveAiRefresh(feed, requestId, prediction, next.scenario, next.run_id));
        }
      } catch (cause) {
        if (requestId === requestIdRef.current) {
          setAiFeed((feed) => failAiRefresh(feed, requestId,
            cause instanceof Error ? cause.message : "AI refresh delayed"));
        }
      }
    } catch (cause) {
      if (requestId === requestIdRef.current) {
        setError(cause instanceof Error ? cause.message : "Demo action failed");
        setAiFeed((feed) => failAiRefresh(feed, requestId,
          cause instanceof Error ? cause.message : "Demo action failed"));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const ai = state && aiFeed.latest?.scenario === state.scenario &&
    aiFeed.latest.run_id === state.run_id ? aiFeed.latest : null;
  return <DemoContext.Provider value={{
    state, ai, aiFeed, homeId, setHomeId, mode, setMode, loading, busy, error,
    command: (value) => perform(() => sendDemoCommand(value)),
    reset: () => perform(resetDemo),
    acknowledge: (id, role) => perform(() => acknowledgeDemoEvent(id, role)),
  }}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const context = useContext(DemoContext);
  if (!context) throw new Error("useDemo must be used inside DemoProvider");
  return context;
}
