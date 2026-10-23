import { parseIntelligence, type IntelligenceSnapshot } from "./intelligence";

export async function getIntelligence(signal: AbortSignal): Promise<IntelligenceSnapshot> {
  const response = await fetch("/api/intelligence", { cache: "no-store", signal });
  if (!response.ok) throw new Error("Intelligence service unavailable");
  return parseIntelligence(await response.json());
}
