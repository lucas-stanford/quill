import type { PlanChangedEvent } from "../types";

export interface UseLivePlanOptions {
  /** Only connect once the plan has loaded. */
  enabled: boolean;
  /** Fired when the file on disk changes. Never fired for our own writes. */
  onChanged: (event: PlanChangedEvent) => void;
}

/**
 * STUB — replaced by the sync workstream.
 * Subscribes to GET /api/live (SSE) and reports external changes to the plan.
 */
export function useLivePlan(_options: UseLivePlanOptions): void {
  // no-op until the sync lane lands
}
