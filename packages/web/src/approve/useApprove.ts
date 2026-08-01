import { useCallback, useEffect, useRef, useState } from "react";
import type { AnnotationsApi } from "../annotations";
import type { TrackedChangesApi } from "../tracking";
import { fetchTicketPlan, finishReview } from "../api";
import { summaryForLostConnection, unreachableTicketPlan } from "./outcome";
import type { ReviewOutcome, ReviewSummary, TicketPlan } from "../types";

export interface UseApproveOptions {
  enabled: boolean;
  annotations: AnnotationsApi;
  tracking: TrackedChangesApi;
}

export interface ApproveApi {
  openComments: number;
  pendingChanges: number;
  ticketPlan: TicketPlan | null;
  loadTicketPlan: () => void;
  approve: (createTickets: boolean) => void;
  cancel: () => void;
  busy: boolean;
  summary: ReviewSummary | null;
  error: string | null;
}

/**
 * The server exits immediately after answering, so the response can arrive as
 * the connection is torn down. A transport error on a finish request is
 * therefore the expected shape of success, not a failure — reporting it as one
 * would show a network error at the exact moment the review worked.
 */
export function useApprove({ enabled, annotations, tracking }: UseApproveOptions): ApproveApi {
  const [ticketPlan, setTicketPlan] = useState<TicketPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [error] = useState<string | null>(null);
  const finishing = useRef(false);

  const openComments = enabled ? annotations.forBrief().length : 0;
  const pendingChanges = enabled ? tracking.changes.length : 0;

  const loadTicketPlan = useCallback(() => {
    if (!enabled) return;
    fetchTicketPlan()
      .then(setTicketPlan)
      .catch((e: unknown) => setTicketPlan(unreachableTicketPlan(e)));
  }, [enabled]);

  const finish = useCallback(
    (outcome: ReviewOutcome, createTickets: boolean) => {
      if (finishing.current) return;
      finishing.current = true;
      setBusy(true);

      finishReview(outcome, createTickets)
        .then(setSummary)
        .catch(() => setSummary(summaryForLostConnection(outcome, openComments)))
        .finally(() => setBusy(false));
    },
    [openComments],
  );

  const approve = useCallback(
    (createTickets: boolean) => finish("approved", createTickets),
    [finish],
  );
  const cancel = useCallback(() => finish("cancelled", false), [finish]);

  useEffect(() => {
    if (!summary) return;
    // Nothing can be saved once the server is gone; stop warning about it.
    const block = (e: BeforeUnloadEvent) => e.stopImmediatePropagation();
    window.addEventListener("beforeunload", block, true);
    return () => window.removeEventListener("beforeunload", block, true);
  }, [summary]);

  return {
    openComments,
    pendingChanges,
    ticketPlan,
    loadTicketPlan,
    approve,
    cancel,
    busy,
    summary,
    error,
  };
}
