import type {
  AnnotationsResponse,
  ConflictResponse,
  PlanResponse,
  RevisionBrief,
  RevisionState,
  Sidecar,
} from "./types";

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

/** Loads the review sidecar. A missing sidecar is not an error. */
export async function fetchAnnotations(): Promise<AnnotationsResponse> {
  const res = await fetch("/api/annotations");
  if (!res.ok) {
    throw new Error(await errorMessage(res, `Failed to load annotations (${res.status})`));
  }
  return (await res.json()) as AnnotationsResponse;
}

/** Writes the review sidecar. Rejected with 409 if it changed on disk. */
export async function saveAnnotations(
  sidecar: Sidecar,
  revision: string,
): Promise<AnnotationsResponse> {
  const res = await fetch("/api/annotations", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sidecar, revision }),
  });
  if (!res.ok) {
    throw new Error(await errorMessage(res, `Failed to save annotations (${res.status})`));
  }
  return (await res.json()) as AnnotationsResponse;
}

/** Asks for a revision. Returns the id to poll. */
export async function requestRevision(brief: RevisionBrief): Promise<RevisionState> {
  const res = await fetch("/api/revision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brief }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, `Failed to request a revision (${res.status})`));
  return (await res.json()) as RevisionState;
}

/** Polls the current revision. */
export async function fetchRevision(): Promise<RevisionState> {
  const res = await fetch("/api/revision");
  if (!res.ok) throw new Error(await errorMessage(res, `Failed to read revision state (${res.status})`));
  return (await res.json()) as RevisionState;
}

/** Cancels an in-flight revision. */
export async function cancelRevision(): Promise<void> {
  await fetch("/api/revision", { method: "DELETE" });
}
