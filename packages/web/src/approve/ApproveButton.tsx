import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ApproveApi } from "./useApprove";
import { describeFindings } from "./verify";

/** Enough to see the shape of the problem without becoming a report. */
const MAX_SHOWN = 6;
import { shapeOf } from "./outcome";
import "./approve.css";

/** FROZEN PROP CONTRACT — rendered in the title bar. */
export interface ApproveButtonProps {
  approve: ApproveApi;
}

export function ApproveButton({ approve }: ApproveButtonProps) {
  const [open, setOpen] = useState(false);
  const [createTickets, setCreateTickets] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const { loadTicketPlan, summary, verify } = approve;

  const openDialog = useCallback(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setOpen(true);
    loadTicketPlan();
    // The last look at the document, taken at the moment finishing is asked
    // for — so it is about the text that will actually be written.
    verify();
  }, [loadTicketPlan, verify]);

  const close = useCallback(() => {
    setOpen(false);
    returnFocus.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    node?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const focusable = node.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled])",
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, close]);

  if (summary) return <ReviewEnded summary={summary} />;

  const { openComments, pendingChanges, ticketPlan, busy, findings } = approve;
  const fixable = findings.filter((finding) => finding.fixable).length;
  const leaving = openComments + pendingChanges;
  const { epics, tasks } = shapeOf(ticketPlan);

  return (
    <>
      <button type="button" className="approve-trigger" onClick={openDialog}>
        Approve
      </button>

      {open && (
        <div className="approve-scrim" onMouseDown={close}>
          <div
            className="approve-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            ref={dialogRef}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 className="approve-title" id={titleId}>
              Approve this plan?
            </h2>

            {leaving > 0 ? (
              <p className="approve-warning">
                You are leaving{" "}
                {openComments > 0 && (
                  <strong>
                    {openComments} unresolved comment{openComments === 1 ? "" : "s"}
                  </strong>
                )}
                {openComments > 0 && pendingChanges > 0 && " and "}
                {pendingChanges > 0 && (
                  <strong>
                    {pendingChanges} unreviewed change{pendingChanges === 1 ? "" : "s"}
                  </strong>
                )}{" "}
                behind. Approving does not resolve them.
              </p>
            ) : (
              <p className="approve-clean">Nothing is left unresolved.</p>
            )}

            {findings.length > 0 && (
              /*
               * The last look before the one irreversible step. Debris that
               * survives to here becomes an empty ticket or, for a fence
               * nobody closed, swallows every milestone under it — so it is
               * shown as the document's own lines, with the line numbers, and
               * the reviewer decides.
               */
              <div className="approve-verify" role="group" aria-label="Problems found">
                <p className="approve-verify-head">{describeFindings(findings)}</p>
                <ul className="approve-verify-list">
                  {findings.slice(0, MAX_SHOWN).map((finding) => (
                    <li
                      key={`${finding.kind}:${finding.line}`}
                      className="approve-verify-item"
                      data-fixable={finding.fixable || undefined}
                    >
                      <span className="approve-verify-line">line {finding.line}</span>
                      <span className="approve-verify-message">{finding.message}</span>
                    </li>
                  ))}
                </ul>
                {findings.length > MAX_SHOWN && (
                  <p className="approve-verify-more">
                    and {findings.length - MAX_SHOWN} more
                  </p>
                )}
                {fixable > 0 && (
                  <button type="button" className="approve-verify-fix" onClick={approve.clean}>
                    Clear {fixable === findings.length ? "them" : `the ${fixable} clearable`} for me
                  </button>
                )}
              </div>
            )}

            <label className="approve-tickets">
              <input
                type="checkbox"
                checked={createTickets}
                disabled={ticketPlan?.available === false}
                onChange={(e) => setCreateTickets(e.target.checked)}
              />
              <span>
                <span className="approve-tickets-label">Break the plan into tickets</span>
                <span className="approve-tickets-detail">
                  {ticketPlan === null
                    ? "Checking for ferricket…"
                    : ticketPlan.available
                      ? `${epics} epic${epics === 1 ? "" : "s"}, ${tasks} task${tasks === 1 ? "" : "s"}`
                      : ticketPlan.reason}
                </span>
              </span>
            </label>

            <div className="approve-actions">
              <button type="button" className="approve-secondary" onClick={close}>
                Keep reviewing
              </button>
              <button
                type="button"
                className="approve-danger"
                onClick={() => approve.cancel()}
                disabled={busy}
              >
                Cancel review
              </button>
              <button
                type="button"
                className="approve-primary"
                data-autofocus
                onClick={() => approve.approve(createTickets)}
                disabled={busy}
              >
                {busy ? "Approving…" : "Approve"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The server is gone by now, so the document can no longer save. Say so
 * deliberately rather than leaving the reviewer editing a dead page.
 */
function ReviewEnded({ summary }: { summary: ApproveApi["summary"] }) {
  if (!summary) return null;
  const approved = summary.outcome === "approved";
  return (
    <div className="approve-scrim approve-scrim--final">
      <div className="approve-dialog" role="alertdialog" aria-modal="true">
        <h2 className="approve-title">{approved ? "Plan approved" : "Review cancelled"}</h2>
        <p className="approve-final-body">
          {approved
            ? "The plan is saved and the terminal has control again."
            : "Nothing was approved. The plan is unchanged on disk."}
        </p>
        {summary.tickets && summary.tickets.length > 0 && (
          <p className="approve-final-tickets">
            {summary.tickets.length} ticket{summary.tickets.length === 1 ? "" : "s"} created —{" "}
            <code>fer ui</code> to see the board.
          </p>
        )}
        {summary.error && <p className="approve-final-error">{summary.error}</p>}
        {summary.planPath && <p className="approve-final-path">{summary.planPath}</p>}
        <p className="approve-final-hint">You can close this tab.</p>
      </div>
    </div>
  );
}
