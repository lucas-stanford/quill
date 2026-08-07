/**
 * revision/status.ts
 *
 * The words. Kept out of the component so the copy for every state is one
 * table that can be read — and tested — at a glance, and so the in-flight,
 * done and failed states can never fall out of step with what is announced to
 * a screen reader.
 */

import type { RevisionStatus } from "../types";

export type RevisionTone = "idle" | "busy" | "success" | "error" | "neutral";

export interface RevisionPresentation {
  /** Short label shown in the pill. */
  label: string;
  /** Full sentence for the aria-live region. Empty means "say nothing". */
  announcement: string;
  tone: RevisionTone;
  /** True while the agent owns the request and cancelling is meaningful. */
  busy: boolean;
}

/** What the agent has said about the work so far, as the copy needs it. */
export interface RevisionProgressCopy {
  /** Its own line about what it is doing now. */
  note: string | null;
  /** How many of the notes that went out it has reported dealt with. */
  resolved: number;
  /** How many went out. */
  sent: number;
}

/** The pill while the agent is working, given whatever it has told us. */
function workingLabel(progress: RevisionProgressCopy | undefined): string {
  const note = progress?.note?.trim();
  if (note) return note;
  if (progress && progress.sent > 0 && progress.resolved > 0) {
    return `Rewriting — ${progress.resolved} of ${progress.sent} done`;
  }
  return "AI is rewriting…";
}

function workingAnnouncement(progress: RevisionProgressCopy | undefined): string {
  const note = progress?.note?.trim();
  const tail = "You can keep reading, or cancel.";
  if (note) return `${note} ${tail}`;
  if (progress && progress.sent > 0 && progress.resolved > 0) {
    return `The agent has dealt with ${progress.resolved} of ${progress.sent} notes. ${tail}`;
  }
  return `The agent is rewriting the plan. ${tail}`;
}

export function presentRevision(
  status: RevisionStatus,
  error: string | null,
  progress?: RevisionProgressCopy,
): RevisionPresentation {
  switch (status) {    case "queued":
      return {
        label: "Sending…",
        announcement: "Sending your comments and edits to the agent.",
        tone: "busy",
        busy: true,
      };
    case "working":
      /*
       * An agent that reports what it is doing gets to say so. "AI is
       * rewriting…" for eight minutes is indistinguishable from a hang, which
       * is the whole reason the reviewer reaches for Cancel on a revision that
       * was going to arrive.
       */
      return {
        label: workingLabel(progress),
        announcement: workingAnnouncement(progress),
        tone: "busy",
        busy: true,
      };
    case "done":
      return {
        label: "Applied as tracked changes",
        announcement:
          "The revision arrived and is marked up as tracked changes. Review them at the bottom of the page.",
        tone: "success",
        busy: false,
      };
    case "failed":
      return {
        label: error?.trim() ? error.trim() : "The revision failed.",
        announcement: `The revision failed. ${error?.trim() ?? ""}`.trim(),
        tone: "error",
        busy: false,
      };
    case "cancelled":
      return {
        label: "Cancelled",
        announcement: "The revision was cancelled. The document is untouched.",
        tone: "neutral",
        busy: false,
      };
    case "idle":
    default:
      /*
       * Idle with a message is a refusal, not a failure: the request was never
       * made, because the brief asked for nothing. Saying "the revision
       * failed" would blame the agent for a round trip it never saw.
       */
      if (error?.trim()) {
        return {
          label: error.trim(),
          announcement: error.trim(),
          tone: "error",
          busy: false,
        };
      }
      return { label: "Update with AI", announcement: "", tone: "idle", busy: false };
  }
}

/**
 * Nothing was sent because the brief was empty. Reached when review markup is
 * pending but none of it is the reviewer's — AI insertions and deletions from
 * an earlier round trip are proposals awaiting a decision, not instructions, so
 * `buildBrief` leaves them out and the brief can be empty while the button's
 * count is not.
 */
export const NOTHING_TO_SEND =
  "Nothing to send — the agent acts on your comments and edits, and none are " +
  "pending. AI changes on the page are yours to accept or reject; add an " +
  "instruction to ask for something else.";

/** True when the control is showing a local refusal rather than an outcome. */
export function isRefusal(status: RevisionStatus, error: string | null): boolean {
  return status === "idle" && !!error?.trim();
}

/** What the button's badge says about the review markup waiting to be sent. */
export function describePending(pendingCount: number): string {
  if (pendingCount <= 0) return "Nothing is pending";
  if (pendingCount === 1) return "1 comment or edit to send";
  return `${pendingCount} comments and edits to send`;
}

/** The same count as a phrase that reads inside a sentence. */
function pendingPhrase(pendingCount: number): string {
  return pendingCount === 1 ? "1 comment or edit" : `${pendingCount} comments and edits`;
}

/**
 * Sending with nothing pending and no instruction is a no-op the user should
 * be warned about rather than allowed to sit through.
 */
export function canSend(pendingCount: number, instruction: string): boolean {
  return pendingCount > 0 || instruction.trim() !== "";
}

/** Tooltip on the primary control. */
export function updateButtonHint(pendingCount: number): string {
  return canSend(pendingCount, "")
    ? `Send ${pendingPhrase(pendingCount)} to the agent and get the rewrite back as tracked changes`
    : "Nothing is pending — add an instruction to tell the agent what to change";
}

/**
 * A request that never reached the agent — no server, no endpoint, no network.
 * The server's own words are kept verbatim (they may be the only diagnosis
 * available) but a bare "Not found" tells the user nothing about what failed,
 * so the sentence around it is ours.
 */
export function transportFailure(message: string): string {
  const raw = message.trim();
  if (!raw) return "Could not reach the agent.";
  return `Could not reach the agent — ${raw}`;
}
