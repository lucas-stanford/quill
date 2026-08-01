/**
 * shell/reviewSummary.ts
 *
 * What the review bar says about the changes in the document.
 *
 * Split out from the component so the counting, the pluralisation and — the
 * part that matters — *what Reject all is scoped to* are provable in a test.
 * Rejecting the reviewer's own edits along with the AI's would be a data-loss
 * bug dressed up as a label.
 */

import type { TrackedChange } from "../tracking";
import type { ChangeAuthor } from "../types";

export interface ReviewSummary {
  total: number;
  ai: number;
  human: number;
  insertions: number;
  deletions: number;
  /** "12 changes" */
  countLabel: string;
  /** "8 from the AI" — null when there is nothing to distinguish. */
  authorLabel: string | null;
  /** Breakdown for the bar's tooltip. */
  kindLabel: string;
  /** Author passed to `rejectAll` — undefined means everything. */
  rejectAuthor: ChangeAuthor | undefined;
  rejectLabel: string;
  rejectHint: string;
  acceptLabel: string;
  acceptHint: string;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function summarizeChanges(changes: readonly TrackedChange[]): ReviewSummary {
  /*
   * Zero-width ranges are not reviewable: nothing is highlighted, next/previous
   * has nowhere to go, and "1 change" the user cannot find is worse than
   * silence. They turn up after an external reload replaces the document and
   * the plugin maps a range onto itself. Accept all / Reject all still act on
   * the tracking state as a whole, so nothing is stranded.
   */
  const reviewable = changes.filter((change) => change.text !== "");

  const ai = reviewable.filter((change) => change.author === "ai").length;
  const human = reviewable.length - ai;
  const insertions = reviewable.filter((change) => change.kind === "insertion").length;
  const deletions = reviewable.length - insertions;

  /*
   * Reject all is the escape hatch for a bad rewrite, so when the reviewer has
   * edits of their own it is scoped to the AI's changes: the whole rewrite
   * goes, their work stays. With nothing of their own in the document the two
   * are the same set, and the plainer label is the honest one.
   */
  const mixed = ai > 0 && human > 0;
  const rejectAuthor: ChangeAuthor | undefined = ai > 0 && mixed ? "ai" : undefined;

  return {
    total: reviewable.length,
    ai,
    human,
    insertions,
    deletions,
    countLabel: plural(reviewable.length, "change", "changes"),
    authorLabel: mixed ? `${ai} from the AI` : ai > 0 ? "from the AI" : null,
    kindLabel: `${plural(insertions, "insertion", "insertions")}, ${plural(
      deletions,
      "deletion",
      "deletions",
    )}`,
    rejectAuthor,
    rejectLabel: mixed ? "Reject all AI changes" : "Reject all",
    rejectHint: mixed
      ? `Undo the AI's ${plural(ai, "change", "changes")} and restore the document as it was before the revision. Your own edits are kept.`
      : "Undo every change and restore the document exactly as it was.",
    acceptLabel: "Accept all",
    acceptHint: mixed
      ? "Accept every change in the document — the AI's and your own."
      : "Accept every change in the document.",
  };
}

/** Said out loud after a bulk action, so the result is never silent. */
export function bulkAnnouncement(
  action: "accept" | "reject",
  summary: ReviewSummary,
): string {
  const count = action === "reject" && summary.rejectAuthor === "ai" ? summary.ai : summary.total;
  return action === "accept"
    ? `Accepted ${plural(count, "change", "changes")}.`
    : `Rejected ${plural(count, "change", "changes")}. The document is back as it was.`;
}
