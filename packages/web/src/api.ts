import type { ConflictResponse, PlanResponse } from "./types";

/** Thrown when a save is rejected because the file changed on disk. */
export class ConflictError extends Error {
  readonly current: PlanResponse;
  constructor(message: string, current: PlanResponse) {
    super(message);
    this.name = "ConflictError";
    this.current = current;
  }
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

/** Same-origin in production; Vite proxies /api to the CLI server in dev. */
export async function fetchPlan(): Promise<PlanResponse> {
  const res = await fetch("/api/plan");
  if (!res.ok) throw new Error(await errorMessage(res, `Failed to load plan (${res.status})`));
  return (await res.json()) as PlanResponse;
}

/**
 * Writes the plan. `revision` is the revision the edit was based on; the server
 * rejects the write with 409 if the file changed underneath it.
 */
export async function savePlan(markdown: string, revision: string): Promise<PlanResponse> {
  const res = await fetch("/api/plan", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown, revision }),
  });

  if (res.status === 409) {
    const body = (await res.json()) as ConflictResponse;
    throw new ConflictError(body.error, body.current);
  }
  if (!res.ok) throw new Error(await errorMessage(res, `Failed to save plan (${res.status})`));

  return (await res.json()) as PlanResponse;
}
