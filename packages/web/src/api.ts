import type { PlanResponse } from "./types";

/** Same-origin in production; Vite proxies /api to the CLI server in dev. */
export async function fetchPlan(): Promise<PlanResponse> {
  const res = await fetch("/api/plan");
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to load plan (${res.status})`);
  }
  return (await res.json()) as PlanResponse;
}
