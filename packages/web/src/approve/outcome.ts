import type { ReviewOutcome, ReviewSummary, TicketPlan } from "../types";

/**
 * The server exits as soon as it has answered a finish request, so the
 * connection dying is the expected shape of success rather than a failure.
 * Reporting it as an error would show a network failure at the exact moment
 * the review worked.
 */
export function summaryForLostConnection(
  outcome: ReviewOutcome,
  openComments: number,
): ReviewSummary {
  return { outcome, planPath: "", revision: "", openComments };
}

/** A preview we could not fetch is an unavailable handoff, not a dead end. */
export function unreachableTicketPlan(reason: unknown): TicketPlan {
  return {
    available: false,
    tickets: [],
    reason: reason instanceof Error ? reason.message : "Could not reach the server",
  };
}

export interface HandoffShape {
  epics: number;
  tasks: number;
}

export function shapeOf(plan: TicketPlan | null): HandoffShape {
  if (!plan) return { epics: 0, tasks: 0 };
  const epics = plan.tickets.filter((t) => t.parent === undefined).length;
  return { epics, tasks: plan.tickets.length - epics };
}
