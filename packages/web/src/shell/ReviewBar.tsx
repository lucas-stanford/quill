import { useCallback, useRef, useState } from "react";
import type { TrackedChangesApi } from "../tracking";
import { bulkAnnouncement, summarizeChanges } from "./reviewSummary";
import "./ReviewBar.css";

export interface ReviewBarProps {
  /** Absent until the plan is ready. */
  tracking?: TrackedChangesApi;
}

/**
 * shell/ReviewBar.tsx
 *
 * The bar that appears when there are tracked changes to work through: how
 * many there are, next/previous, accept all, reject all.
 *
 * **Where it sits.** Pinned to the bottom of the canvas as an overlay, not a
 * row. The ribbon already overlays the top of the canvas (see .ribbon-slot in
 * AppShell.css); a second bar up there would either fight it for the same band
 * or force the canvas to reserve more space and shove the document down the
 * moment a revision landed. At the bottom the two can never collide, the bar
 * is closest to where the eye is while reading, and — being out of flow — it
 * cannot move the page by a pixel. It is mounted at all times and slides on
 * `transform` alone, the pattern M3 established for the ribbon.
 *
 * **Reject all.** This is the reason the revision is trustworthy: it is what
 * makes a bad rewrite reversible, so it is a first-class button, in the
 * deletion colour, labelled with what it will actually do. When the reviewer
 * has edits of their own it is scoped to the AI's changes so their work is not
 * collateral damage (see reviewSummary.ts). Every bulk action is announced.
 */
export function ReviewBar({ tracking }: ReviewBarProps) {
  const [message, setMessage] = useState("");
  const summary = summarizeChanges(tracking?.changes ?? []);
  const hidden = summary.total === 0;

  /*
   * Keep the last non-empty summary for the ~200 ms the bar is sliding out,
   * so the count does not flash "0 changes" on its way off screen.
   */
  const lastRef = useRef(summary);
  if (!hidden) lastRef.current = summary;
  const shown = hidden ? lastRef.current : summary;

  const acceptAll = useCallback(() => {
    if (!tracking) return;
    setMessage(bulkAnnouncement("accept", summary));
    tracking.acceptAll();
  }, [tracking, summary]);

  const rejectAll = useCallback(() => {
    if (!tracking) return;
    setMessage(bulkAnnouncement("reject", summary));
    tracking.rejectAll(summary.rejectAuthor);
  }, [tracking, summary]);

  return (
    <>
      {/* Outside the bar, so a bulk action that empties it is still announced. */}
      <div className="review-bar-live" aria-live="polite" aria-atomic="true">
        {message}
      </div>

      <div
        className="review-bar-slot"
        data-hidden={hidden || undefined}
        inert={hidden}
        aria-hidden={hidden || undefined}
      >
        <div className="review-bar" role="region" aria-label="Tracked changes">
          <span className="review-bar-count" title={shown.kindLabel}>
            <span
              className="review-bar-dot"
              data-author={shown.ai > 0 ? "ai" : "human"}
              aria-hidden="true"
            />
            <strong className="review-bar-total">{shown.countLabel}</strong>
            {shown.authorLabel && (
              <span className="review-bar-author">{shown.authorLabel}</span>
            )}
          </span>

          <span className="review-bar-sep" aria-hidden="true" />

          <span className="review-bar-nav">
            <button
              type="button"
              className="review-bar-step"
              onClick={() => tracking?.goToPrevious()}
              aria-label="Go to previous change"
              title="Previous change  ⌥↑"
            >
              <ChevronIcon direction="up" />
            </button>
            <button
              type="button"
              className="review-bar-step"
              onClick={() => tracking?.goToNext()}
              aria-label="Go to next change"
              title="Next change  ⌥↓"
            >
              <ChevronIcon direction="down" />
            </button>
          </span>

          <span className="review-bar-sep" aria-hidden="true" />

          <button
            type="button"
            className="review-bar-btn review-bar-btn--accept"
            onClick={acceptAll}
            title={shown.acceptHint}
          >
            <CheckIcon />
            {shown.acceptLabel}
          </button>
          <button
            type="button"
            className="review-bar-btn review-bar-btn--reject"
            onClick={rejectAll}
            title={shown.rejectHint}
          >
            <UndoIcon />
            {shown.rejectLabel}
          </button>
        </div>
      </div>
    </>
  );
}

/* ── Icons ──────────────────────────────────────────────────── */

const STROKE = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 16 16",
  width: "13",
  height: "13",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.8",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
};

function ChevronIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <svg {...STROKE} width="12" height="12">
      {direction === "down" ? <path d="M3.5 6 8 10.5 12.5 6" /> : <path d="M3.5 10 8 5.5 12.5 10" />}
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg {...STROKE} width="12" height="12">
      <path d="M3 8.6 6.2 11.8 13 5" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg {...STROKE} width="12" height="12">
      {/* Arrow curving back to the left — "put it back the way it was" */}
      <path d="M2.6 5.4h6.6a4 4 0 1 1 0 8H5.6" />
      <path d="M5.2 2.4 2.4 5.4l2.8 3" />
    </svg>
  );
}
