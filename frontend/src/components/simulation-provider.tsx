"use client";

import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import {
  createInitialState,
  simulationReducer,
  TICK_INTERVAL_MS,
} from "@/lib/simulation/model";
import type { SimulationAction, SimulationState } from "@/lib/simulation/types";

const SimulationContext = createContext<{
  state: SimulationState;
  dispatch: Dispatch<SimulationAction>;
} | null>(null);
export function SimulationProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(
    simulationReducer,
    undefined,
    createInitialState,
  );
  useEffect(() => {
    if (state.paused || (state.phase !== "storm" && state.phase !== "pumping"))
      return;
    const timer = window.setInterval(
      () => dispatch({ type: "TICK" }),
      TICK_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [state.phase, state.paused]);
  return (
    <SimulationContext.Provider value={{ state, dispatch }}>
      {children}
    </SimulationContext.Provider>
  );
}
export function useSimulation() {
  const context = useContext(SimulationContext);
  if (!context)
    throw new Error("useSimulation must be used inside SimulationProvider");
  return context;
}
