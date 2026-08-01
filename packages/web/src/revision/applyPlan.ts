/**
 * revision/applyPlan.ts
 *
 * Deciding what to do with a finished revision.
 *
 * A revision must arrive as tracked changes — never as plain content — because
 * that is the only thing that makes a bad rewrite one click from being undone
 * (CONTRACT.md invariant 4). Two things can get in the way:
 *
 *   1. The same terminal state being seen twice. `GET /api/revision` keeps
 *      reporting `done`, so a stray extra poll, a re-render or a second run
 *      must not land the rewrite on top of itself.
 *
 *   2. The attached-mode reload. The parent agent rewrites PLAN.md on disk, so
 *      the M2 watcher fires and `App` may swap the document out from under us —
 *      wiping the pending review markup and leaving the AI's rewrite in the
 *      page as ordinary text with nothing to accept or reject. `App.tsx` and
 *      `live/` are frozen, so this cannot be prevented from here; it can be
 *      detected (the `markdown` App loaded us with changes) and undone.
 *
 * This module is pure so both cases can be proven in a unit test.
 */

/** Trailing whitespace and line endings are not a difference in a plan file. */
export function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

export function sameDocument(a: string, b: string): boolean {
  return normalizeMarkdown(a) === normalizeMarkdown(b);
}

export type ApplyDecision =
  /** Land the rewrite as tracked changes against the document on screen. */
  | { kind: "apply"; markdown: string }
  /**
   * The document was reloaded to the agent's rewrite while we waited, so the
   * rewrite is already on screen as plain text. Put the pre-revision document
   * back, then land the rewrite on top of it as tracked changes.
   */
  | { kind: "rebuild"; baseline: string; markdown: string }
  | { kind: "skip"; reason: "already-applied" }
  | { kind: "empty" };

export interface ApplyInput {
  /** Revision id from the server. */
  id: string;
  /** The rewritten plan, when the server produced one. */
  markdown: string | undefined;
  /** Id of the revision already applied to this document, if any. */
  appliedId: string | null;
  /** The document App had loaded when the revision was requested. */
  baseline: string;
  /** The document App has loaded now. Differs from `baseline` after a reload. */
  current: string;
}

export function decideApply({
  id,
  markdown,
  appliedId,
  baseline,
  current,
}: ApplyInput): ApplyDecision {
  if (appliedId !== null && appliedId === id) return { kind: "skip", reason: "already-applied" };
  if (!markdown || markdown.trim() === "") return { kind: "empty" };

  // Nothing reloaded: the ordinary path.
  if (sameDocument(current, baseline)) return { kind: "apply", markdown };

  /*
   * The reload delivered exactly this revision. Diffing it against itself would
   * produce no tracked changes at all, leaving the user with an unreviewable
   * rewrite — so rebuild from the baseline instead.
   */
  if (sameDocument(current, markdown)) return { kind: "rebuild", baseline, markdown };

  /*
   * Something else changed the file while we waited (a hand edit, a different
   * agent). Diff against what is actually on screen: the user gets an honest,
   * reviewable diff, and rejecting it restores what they can see rather than
   * something they never had.
   */
  return { kind: "apply", markdown };
}
