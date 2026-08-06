import type {
  AnnotationsResponse,
  CompanionDocument,
  CompanionList,
  ConflictResponse,
  PlanResponse,
  ExamplesResponse,
  RevisionBrief,
  RevisionScope,
  RevisionState,
  ReviewOutcome,
  ReviewSummary,
  Sidecar,
  TicketPlan,
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
export async function requestRevision(
  brief: RevisionBrief,
  prompt: string,
): Promise<RevisionState> {
  const res = await fetch("/api/revision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brief, prompt }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, `Failed to request a revision (${res.status})`));
  return (await res.json()) as RevisionState;
}

/**
 * Asks the agent to act on one section of a companion.
 *
 * The same endpoint and the same queue file as a plan revision, with the
 * routing attached: one channel means one request in flight, which is the
 * behaviour you want — an agent should not be rewriting the plan and re-running
 * research in the same moment.
 */
export async function requestSectionRevision(
  brief: RevisionBrief,
  prompt: string,
  scope: RevisionScope,
): Promise<RevisionState> {
  const res = await fetch("/api/revision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brief, prompt, target: "research", scope }),
  });
  if (!res.ok) {
    throw new Error(await errorMessage(res, `Failed to request a revision (${res.status})`));
  }
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

/** Previews the ferricket breakdown without creating anything. */
export async function fetchTicketPlan(): Promise<TicketPlan> {
  const res = await fetch("/api/tickets/preview");
  if (!res.ok) throw new Error(await errorMessage(res, `Failed to preview tickets (${res.status})`));
  return (await res.json()) as TicketPlan;
}

/** Ends the review and releases the CLI. */
export async function finishReview(
  outcome: ReviewOutcome,
  createTickets = false,
): Promise<ReviewSummary> {
  const res = await fetch("/api/review/finish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outcome, createTickets }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, `Failed to finish the review (${res.status})`));
  return (await res.json()) as ReviewSummary;
}

/* ── Companion documents ─────────────────────────────────────────────────
   Read-only, so there is no revision, no save and no conflict to handle. */

/** The companions that exist beside the plan right now. */
export async function fetchCompanions(): Promise<CompanionList> {
  const res = await fetch("/api/companions");
  if (!res.ok) {
    throw new Error(await errorMessage(res, `Failed to list companions (${res.status})`));
  }
  return (await res.json()) as CompanionList;
}

/** Thrown when a companion write is rejected because the file moved. */
export class CompanionConflictError extends Error {
  readonly current: CompanionDocument;
  constructor(message: string, current: CompanionDocument) {
    super(message);
    this.name = "CompanionConflictError";
    this.current = current;
  }
}

/** One companion's current contents. Re-read on every open, never cached. */
export async function fetchCompanion(name: string): Promise<CompanionDocument> {
  const res = await fetch(`/api/companions/${encodeURIComponent(name)}`);
  if (!res.ok) {
    throw new Error(await errorMessage(res, `Failed to load ${name} (${res.status})`));
  }
  return (await res.json()) as CompanionDocument;
}

/**
 * Writes a companion. `revision` is what the edit was based on; the server
 * rejects the write with 409 if the file changed underneath it — which here
 * usually means the agent answered a re-run while you were typing.
 */
export async function saveCompanion(
  name: string,
  markdown: string,
  revision: string,
): Promise<CompanionDocument> {
  const res = await fetch(`/api/companions/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown, revision }),
  });

  if (res.status === 409) {
    const body = (await res.json()) as { error?: string; current: CompanionDocument };
    throw new CompanionConflictError(body.error ?? "The file changed on disk", body.current);
  }
  if (!res.ok) {
    throw new Error(await errorMessage(res, `Failed to save ${name} (${res.status})`));
  }
  return (await res.json()) as CompanionDocument;
}

/* ── Examples ────────────────────────────────────────────────────────────
   The gallery reads the manifest and writes back keep/cut decisions. The
   images themselves are served from `research/examples/` by name. */

export async function fetchExamples(): Promise<ExamplesResponse> {
  const res = await fetch("/api/examples");
  if (!res.ok) throw new Error(await errorMessage(res, `Failed to load examples (${res.status})`));
  return (await res.json()) as ExamplesResponse;
}

export async function saveExamples(
  manifest: ExamplesResponse["manifest"],
  revision: string,
): Promise<ExamplesResponse> {
  const res = await fetch("/api/examples", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ manifest, revision }),
  });
  if (res.status === 409) {
    // The agent added examples while a cut was in flight. Its copy is newer,
    // so the caller reloads rather than clobbering what just arrived.
    const body = (await res.json()) as { current: ExamplesResponse };
    return body.current;
  }
  if (!res.ok) throw new Error(await errorMessage(res, `Failed to save examples (${res.status})`));
  return (await res.json()) as ExamplesResponse;
}

/** Where an example's picture is served from. */
export function exampleImageUrl(image: string): string {
  return `/api/examples/media/${encodeURIComponent(image)}`;
}
