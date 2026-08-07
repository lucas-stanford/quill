import { useCallback, useEffect, useRef, useState } from "react";
import type { AnnotationsApi } from "../annotations";
import type { TrackedChangesApi } from "../tracking";
import { fetchTicketPlan, finishReview } from "../api";
import { summaryForLostConnection, unreachableTicketPlan } from "./outcome";
import { cleanPlan, verifyPlan } from "./verify";
import type { Finding } from "./verify";
import type { ReviewOutcome, ReviewSummary, TicketPlan } from "../types";

export interface UseApproveOptions {
  enabled: boolean;
  annotations: AnnotationsApi;
  tracking: TrackedChangesApi;
  /**
   * The plan as it stands *right now*, including edits not yet saved.
   *
   * A callback rather than a value because `App` keeps unsaved text in a ref —
   * a document that re-rendered the shell on every keystroke would be a
   * different product. The pass reads it when it runs, which is the only
   * moment its answer matters.
   */
  getMarkdown?: () => string;
  /**
   * Apply a cleaned-up document. Goes through App's ordinary change path, so
   * clearing debris autosaves and is undoable like any other edit.
   */
  onClean?: (markdown: string) => void;
}

export interface ApproveApi {
  openComments: number;
  pendingChanges: number;
  /** What the verification pass found in the document about to be approved. */
  findings: Finding[];
  /** Run the pass. Called when the approve dialog opens. */
  verify: () => void;
  /** Clear the findings that need no judgement. */
  clean: () => void;
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
export function useApprove({
  enabled,
  annotations,
  tracking,
  getMarkdown,
  onClean,
}: UseApproveOptions): ApproveApi {
  const [ticketPlan, setTicketPlan] = useState<TicketPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [error] = useState<string | null>(null);
  const finishing = useRef(false);

  const openComments = enabled ? annotations.forBrief().length : 0;
  const pendingChanges = enabled ? tracking.changes.length : 0;

  const [findings, setFindings] = useState<Finding[]>([]);

  /*
   * Run when the dialog opens, not on every keystroke.
   *
   * It scans the markdown rather than walking the editor's document, because
   * the file is what gets approved and the check should be about that however
   * the debris got there. Once, at the moment the reviewer asks to finish, is
   * both the cheapest place to do a whole-document scan and the only place its
   * answer is about the document that will actually be written.
   */
  const verify = useCallback(() => {
    if (!enabled || !getMarkdown) {
      setFindings([]);
      return;
    }
    setFindings(verifyPlan(getMarkdown()));
  }, [enabled, getMarkdown]);

  const clean = useCallback(() => {
    if (!onClean || !getMarkdown) return;
    const markdown = getMarkdown();
    const next = cleanPlan(markdown);
    if (next !== markdown) onClean(next);
    // Re-read rather than assume: clearing is not a promise the rest is clean,
    // and the reviewer should see what is left rather than an empty list.
    setFindings(verifyPlan(next));
  }, [getMarkdown, onClean]);

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
    findings,
    verify,
    clean,
    ticketPlan,
    loadTicketPlan,
    approve,
    cancel,
    busy,
    summary,
    error,
  };
}
