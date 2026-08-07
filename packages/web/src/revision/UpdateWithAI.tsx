/**
 * revision/UpdateWithAI.tsx
 *
 * The button that closes the loop, and everything the user needs to know while
 * it is working.
 *
 * Shape: a split button. The main half sends what is already pending in one
 * click — the common case, and the count is on the button so nobody sends an
 * empty brief by accident. With nothing pending it is disabled, because a
 * request that cannot change anything hands the model a document it was not
 * asked to touch. The caret half stays live and opens a small instruction
 * popover: a note of your own is a thing worth sending on its own, and it is
 * the way out of the disabled state.
 *
 * In flight, the button is replaced in place by a status pill with a cancel
 * button. Nothing covers the document: the agent works, the user keeps reading.
 * Everything transient (the popover, the outcome notice) is absolutely
 * positioned out of the title bar's flow, so no state of this control can move
 * the chrome or the page.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { BriefPoll, OptionPoll, OptionTarget } from "../types";
import type { RevisionApi } from "./useRevision";
import {
  canSend,
  describePending,
  isRefusal,
  presentRevision,
  updateButtonHint,
} from "./status";
import "./UpdateWithAI.css";

/** FROZEN PROP CONTRACT — rendered in the title bar. */
export interface UpdateWithAIProps {
  revision: RevisionApi;
  /** Number of unresolved comments plus reviewer edits awaiting the agent. */
  pendingCount: number;
  /**
   * Rounds of candidates already answered. Only used to tell the agent what it
   * has offered before, so a second round never repeats a name the reviewer has
   * already seen and passed on.
   */
  existingPolls?: readonly OptionPoll[];
}

/** How long the "applied"/"cancelled" pill stays before the button returns. */
const DONE_NOTICE_MS = 6000;
const QUIET_NOTICE_MS = 3000;

/** Ids only have to be unique within one options file; a timestamp does it. */
function newPollId(): string {
  return `p${Date.now().toString(36)}${Math.floor(Math.random() * 4096).toString(36)}`;
}

/** Whether a past round answered the question this one is asking. */
function sameTarget(poll: OptionPoll, target: OptionTarget): boolean {
  const answered = poll.target ?? { kind: "title" as const };
  if (answered.kind !== target.kind) return false;
  // Every title round is about the same thing — the document — whatever it was
  // called at the time.
  if (target.kind === "title") return true;
  return answered.kind === "text" && answered.value === target.value;
}

/** Every candidate already offered for this target, including the dropped ones. */
function offered(polls: readonly OptionPoll[], target: OptionTarget): string[] {
  const seen: string[] = [];
  for (const poll of polls) {
    if (!sameTarget(poll, target)) continue;
    for (const option of poll.options) {
      if (!seen.includes(option.value)) seen.push(option.value);
    }
  }
  return seen;
}

/** What the reviewer is about to ask for, in their own terms. */
function describePollAsk(naming: string): string {
  const subject = naming.trim();
  return subject === ""
    ? "Candidates for the project's title. Taking one rewrites the document's heading."
    : `Candidates for “${subject}”. Taking one replaces every mention of it in the plan.`;
}

export function UpdateWithAI({
  revision,
  pendingCount,
  existingPolls = [],
}: UpdateWithAIProps) {
  const { status, error, note, resolvedCount, start, cancel } = revision;
  /*
   * `pendingCount` is what is waiting to go; once a run is under way it is the
   * denominator for what has come back. It falls as notes are closed live, so
   * the total is reconstructed from the two halves rather than read from a
   * count that is being decremented underneath the sentence describing it.
   */
  const presentation = presentRevision(status, error, {
    note,
    resolved: resolvedCount,
    sent: pendingCount + resolvedCount,
  });
  /** Idle with a message: nothing was sent, and the words say why. */
  const refusal = isRefusal(status, error);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [noticeShown, setNoticeShown] = useState(false);
  /** The naming request being composed, if the reviewer asked for one. */
  const [askNames, setAskNames] = useState(false);
  const [naming, setNaming] = useState("");
  const [nameSteering, setNameSteering] = useState("");

  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mainButtonRef = useRef<HTMLButtonElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  /** Focus is returned to whatever opened the popover when it closes. */
  const returnFocusRef = useRef<HTMLElement | null>(null);
  /** Kept so "Try again" re-sends what the user actually asked for. */
  const lastInstructionRef = useRef<string | undefined>(undefined);

  const dialogTitleId = useId();
  const instructionId = useId();

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    // After the popover unmounts, or focus lands on a node on its way out.
    window.requestAnimationFrame(() => target?.focus());
  }, []);

  const openDialog = useCallback(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDialogOpen(true);
  }, []);

  // Focus into the popover on open.
  useEffect(() => {
    if (dialogOpen) textareaRef.current?.focus();
  }, [dialogOpen]);

  /*
   * Sending swaps the button for the in-flight pill, and finishing swaps it
   * back — so the control the user was standing on is removed from under them.
   * If that dropped focus on the body, put it on whatever replaced it. Focus
   * anywhere else (the editor, a comment) is the user's, and is left alone.
   */
  const wasBusyRef = useRef(presentation.busy);
  useEffect(() => {
    const swapped = wasBusyRef.current !== presentation.busy;
    wasBusyRef.current = presentation.busy;
    if (!swapped) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    if (presentation.busy) {
      cancelButtonRef.current?.focus();
      return;
    }
    // The main half can come back disabled: a revision that lands leaves AI
    // changes pending and nothing of the reviewer's left to send.
    const main = mainButtonRef.current;
    (main && !main.disabled ? main : moreButtonRef.current)?.focus();
  }, [presentation.busy]);

  // Escape closes wherever focus is; a click outside dismisses it.
  useEffect(() => {
    if (!dialogOpen) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeDialog();
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      closeDialog();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [dialogOpen, closeDialog]);

  /*
   * The outcome notice. "Applied" and "Cancelled" fade themselves out so the
   * button comes back without a click; a failure — and a refusal to send an
   * empty brief — stays until it is dismissed or retried, because a message
   * the user never saw is a dead end.
   */
  useEffect(() => {
    if (presentation.busy || (status === "idle" && !refusal)) {
      setNoticeShown(false);
      return;
    }
    setNoticeShown(true);
    if (status === "failed" || refusal) return;
    const timer = window.setTimeout(
      () => setNoticeShown(false),
      status === "done" ? DONE_NOTICE_MS : QUIET_NOTICE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [status, refusal, presentation.busy]);

  const send = useCallback(
    (note?: string, polls?: readonly BriefPoll[]) => {
      const trimmed = note?.trim() ? note.trim() : undefined;
      lastInstructionRef.current = trimmed;
      setInstruction("");
      // Pressing send on a refusal that is already showing leaves the hook's
      // state untouched, so nothing would re-render the notice back in.
      if (refusal) setNoticeShown(true);
      start(trimmed, polls);
    },
    [refusal, start],
  );

  const onPrimary = useCallback(() => send(), [send]);

  /** The naming request as the dialog currently stands, if there is one. */
  const composePoll = useCallback((): BriefPoll[] => {
    if (!askNames) return [];
    const subject = naming.trim();
    const target: OptionTarget =
      subject === "" ? { kind: "title" } : { kind: "text", value: subject };
    const poll: BriefPoll = {
      id: newPollId(),
      subject: subject === "" ? "project name" : subject,
      target,
      // What has been offered for THIS target already, so a second round never
      // hands back a name the reviewer has seen and passed on.
      exclude: offered(existingPolls, target),
    };
    if (poll.exclude?.length === 0) delete poll.exclude;
    const steering = nameSteering.trim();
    if (steering) poll.steering = steering;
    return [poll];
  }, [askNames, naming, nameSteering, existingPolls]);

  const onDialogSubmit = useCallback(() => {
    const polls = composePoll();
    if (!canSend(pendingCount, instruction) && polls.length === 0) return;
    closeDialog();
    send(instruction, polls);
    setAskNames(false);
    setNaming("");
    setNameSteering("");
  }, [closeDialog, composePoll, instruction, pendingCount, send]);

  const onTextareaKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        onDialogSubmit();
      }
    },
    [onDialogSubmit],
  );

  const sendable = canSend(pendingCount, instruction) || askNames;

  return (
    <div className="uwai" ref={rootRef}>
      {/* Present at all times so status changes are announced, not injected. */}
      <div className="uwai-live" aria-live="polite" aria-atomic="true">
        {presentation.announcement}
      </div>

      {presentation.busy ? (
        <div className="uwai-flight">
          <Spinner />
          <span className="uwai-flight-label">{presentation.label}</span>
          <button type="button" className="uwai-cancel" onClick={cancel} ref={cancelButtonRef}>
            Cancel
          </button>
        </div>
      ) : (
        <div
          className={`uwai-split${canSend(pendingCount, "") ? "" : " uwai-split--empty"}`}
          title={updateButtonHint(pendingCount)}
        >
          <button
            type="button"
            className="uwai-main"
            ref={mainButtonRef}
            title={updateButtonHint(pendingCount)}
            disabled={!canSend(pendingCount, "")}
            onClick={onPrimary}
          >
            <SparkleIcon />
            <span>Update with AI</span>
            <span
              className={`uwai-count${pendingCount > 0 ? "" : " uwai-count--empty"}`}
              title={describePending(pendingCount)}
            >
              {pendingCount}
            </span>
          </button>
          <button
            type="button"
            className="uwai-more"
            ref={moreButtonRef}
            aria-label="Add an instruction for the agent"
            title={
              canSend(pendingCount, "")
                ? "Add an instruction…"
                : "Nothing is pending — add an instruction…"
            }
            aria-haspopup="dialog"
            aria-expanded={dialogOpen}
            onClick={() => (dialogOpen ? closeDialog() : openDialog())}
          >
            <CaretIcon />
          </button>
        </div>
      )}

      {noticeShown && (
        <div
          className={`uwai-notice uwai-notice--${presentation.tone}`}
          role={status === "failed" || refusal ? "alert" : undefined}
        >
          <span className="uwai-notice-icon" aria-hidden="true">
            {status === "done" ? (
              <CheckIcon />
            ) : status === "failed" || refusal ? (
              <AlertIcon />
            ) : null}
          </span>
          <span className="uwai-notice-text">{presentation.label}</span>
          {(status === "failed" || refusal) && (
            <span className="uwai-notice-actions">
              <button
                type="button"
                className="uwai-notice-btn"
                onClick={() => {
                  if (refusal) {
                    setNoticeShown(false);
                    openDialog();
                  } else {
                    send(lastInstructionRef.current);
                  }
                }}
              >
                {refusal ? "Add an instruction…" : "Try again"}
              </button>
              <button
                type="button"
                className="uwai-notice-btn"
                onClick={() => setNoticeShown(false)}
              >
                Dismiss
              </button>
            </span>
          )}
        </div>
      )}

      {dialogOpen && (
        <div
          className="uwai-dialog"
          ref={dialogRef}
          role="dialog"
          aria-modal={false}
          aria-labelledby={dialogTitleId}
        >
          <h2 className="uwai-dialog-title" id={dialogTitleId}>
            Update with AI
          </h2>
          <p className="uwai-dialog-summary">
            {describePending(pendingCount)}
            {pendingCount > 0 ? ". The rewrite comes back as tracked changes." : ""}
          </p>
          {pendingCount === 0 && (
            <p className="uwai-dialog-warning">
              No unresolved comments and no edits, so there is nothing for the agent to
              act on. Add an instruction below to tell it what to change.
            </p>
          )}
          <label className="uwai-dialog-label" htmlFor={instructionId}>
            Instruction <span className="uwai-dialog-optional">(optional)</span>
          </label>
          <textarea
            id={instructionId}
            ref={textareaRef}
            className="uwai-dialog-input"
            rows={3}
            value={instruction}
            placeholder="e.g. Tighten the rollout section and add a rollback step."
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={onTextareaKeyDown}
          />

          {/*
           * Naming is review. "What do we call this?" comes up reading the same
           * paragraph as everything else in this dialog, so it is asked here and
           * answered in the same round — the candidates come back with the
           * revision and sit at the end of the comments.
           */}
          <div className="uwai-poll">
            <label className="uwai-poll-toggle">
              <input
                type="checkbox"
                checked={askNames}
                onChange={(event) => setAskNames(event.target.checked)}
              />
              Ask for name candidates
            </label>
            {askNames && (
              <div className="uwai-poll-fields">
                <input
                  className="uwai-poll-input"
                  type="text"
                  value={naming}
                  placeholder="What to rename — blank means the project title"
                  onChange={(event) => setNaming(event.target.value)}
                  aria-label="What to name"
                />
                <input
                  className="uwai-poll-input"
                  type="text"
                  value={nameSteering}
                  placeholder="Steering, optional — “one word, weird west”"
                  onChange={(event) => setNameSteering(event.target.value)}
                  aria-label="Steering for the names"
                />
                <p className="uwai-poll-hint">{describePollAsk(naming)}</p>
              </div>
            )}
          </div>

          <div className="uwai-dialog-actions">
            <span className="uwai-dialog-hint" aria-hidden="true">
              ⌘↵ to send
            </span>
            <button type="button" className="uwai-dialog-btn" onClick={closeDialog}>
              Cancel
            </button>
            <button
              type="button"
              className="uwai-dialog-btn uwai-dialog-btn--primary"
              onClick={onDialogSubmit}
              disabled={!sendable}
              title={
                sendable
                  ? "Send to the agent"
                  : "Add an instruction — there is nothing pending to send"
              }
            >
              Send to AI
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Icons ──────────────────────────────────────────────────── */

function SparkleIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="currentColor"
      aria-hidden="true"
    >
      {/* Four-point star plus a small companion — the conventional "AI" mark */}
      <path d="M6.4 1.3 7.5 4.4 10.6 5.5 7.5 6.6 6.4 9.7 5.3 6.6 2.2 5.5 5.3 4.4 Z" />
      <path d="M11.8 8.6 12.4 10.3 14.1 10.9 12.4 11.5 11.8 13.2 11.2 11.5 9.5 10.9 11.2 10.3 Z" />
    </svg>
  );
}

function CaretIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 6 8 10.5 12.5 6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.6 6.2 11.8 13 5" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.4" />
      <line x1="8" y1="4.8" x2="8" y2="8.8" />
      <line x1="8" y1="11.2" x2="8.01" y2="11.2" />
    </svg>
  );
}

/**
 * Motion says "still working" without a progress bar we cannot honestly fill —
 * the agent reports no percentage. Under prefers-reduced-motion the ring stops
 * and the label carries the meaning on its own.
 */
function Spinner() {
  return (
    <svg
      className="uwai-spinner"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" opacity="0.25" />
      <path d="M14 8a6 6 0 0 0-6-6" />
    </svg>
  );
}
