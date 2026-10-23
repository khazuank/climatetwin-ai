import type { AiResponse } from "./ai";
import type { Scenario } from "./demo";

export interface AiFeed {
  latest: AiResponse | null;
  refreshing: boolean;
  error: string | null;
  failure: "transport" | "model" | null;
  failedScenario: Scenario | null;
  failedRunId: string | null;
  requestId: number;
}

export const initialAiFeed: AiFeed = {
  latest: null, refreshing: false, error: null, failure: null,
  failedScenario: null, failedRunId: null, requestId: 0,
};

export function beginAiRefresh(feed: AiFeed, requestId: number): AiFeed {
  if (requestId <= feed.requestId) return feed;
  return { ...feed, refreshing: true, requestId };
}

export function receiveAiRefresh(feed: AiFeed, requestId: number,
                                 response: AiResponse, scenario: Scenario, runId: string): AiFeed {
  if (requestId !== feed.requestId) return feed;
  if (response.scenario !== scenario || response.run_id !== runId) {
    return { ...feed, refreshing: false, error: "Simulation changed during forecast refresh.",
      failure: "transport", failedScenario: null, failedRunId: null };
  }
  if (response.status !== "ready") {
    return { ...feed, refreshing: false, error: response.reason ?? "Trained inference failed.",
      failure: "model", failedScenario: scenario, failedRunId: runId };
  }
  if (feed.latest?.run_id === runId && feed.latest.scenario === scenario &&
      response.simulation_minute < feed.latest.simulation_minute) {
    return { ...feed, refreshing: false, error: null, failure: null,
      failedScenario: null, failedRunId: null };
  }
  return { ...feed, latest: response, refreshing: false, error: null, failure: null,
    failedScenario: null, failedRunId: null };
}

export function failAiRefresh(feed: AiFeed, requestId: number, error: string): AiFeed {
  if (requestId !== feed.requestId) return feed;
  return { ...feed, refreshing: false, error, failure: "transport",
    failedScenario: null, failedRunId: null };
}

export function aiForecastAvailability(feed: AiFeed, scenario: Scenario, runId: string, minute: number) {
  const forecast = feed.latest?.scenario === scenario && feed.latest.run_id === runId ? feed.latest : null;
  if (feed.failure === "model" && feed.failedScenario === scenario && feed.failedRunId === runId) {
    return { forecast, status: "unavailable" as const };
  }
  if (forecast) return { forecast, status: forecast.simulation_minute > minute
    ? "synchronizing" as const : forecast.simulation_minute === minute && !feed.failure
      ? "ready" as const : "stale" as const };
  return { forecast: null, status: feed.failure === "transport" ? "delayed" as const : "loading" as const };
}
