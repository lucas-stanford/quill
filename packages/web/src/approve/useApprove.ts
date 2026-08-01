import type { AnnotationsApi } from "../annotations";
import type { TrackedChangesApi } from "../tracking";
import type { ReviewSummary, TicketPlan } from "../types";

export interface UseApproveOptions {
  enabled: boolean;
  annotations: AnnotationsApi;
  tracking: TrackedChangesApi;
}

export interface ApproveApi {
  /** Unresolved comments and pending tracked changes, for the confirm step. */
  openComments: number;
  pendingChanges: number;
  /** Lazily loaded ferricket breakdown preview. */
  ticketPlan: TicketPlan | null;
  loadTicketPlan: () => void;
  approve: (createTickets: boolean) => void;
  cancel: () => void;
  busy: boolean;
  summary: ReviewSummary | null;
  error: string | null;
}

/** STUB — replaced by the approve workstream. */
export function useApprove(_options: UseApproveOptions): ApproveApi {
  return {
    openComments: 0,
    pendingChanges: 0,
    ticketPlan: null,
    loadTicketPlan: () => {},
    approve: () => {},
    cancel: () => {},
    busy: false,
    summary: null,
    error: null,
  };
}
