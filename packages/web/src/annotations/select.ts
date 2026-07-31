import type { Comment } from "../types";

/**
 * Selection rules for the comment set, kept pure so they can be tested without
 * a DOM or an editor. `useAnnotations` is the only caller.
 */

/** Document position of a comment's anchor, or undefined when it is orphaned. */
export type PositionOf = (comment: Comment) => number | undefined;

/**
 * Document order, with orphans last (they have no position) and creation time
 * as the tiebreak so the rail is stable while two comments share a line.
 */
export function orderComments(comments: readonly Comment[], positionOf: PositionOf): Comment[] {
  const rank = (c: Comment): number => positionOf(c) ?? Number.MAX_SAFE_INTEGER;
  return [...comments].sort(
    (a, b) => rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt),
  );
}

/** Comments whose anchor no longer resolves; the tray shows these. */
export function selectOrphans(ordered: readonly Comment[]): Comment[] {
  return ordered.filter((c) => c.orphaned === true);
}

/**
 * Union of what this session holds and what the sidecar holds, used when a
 * write finds the file has moved on (a late-starting server, or an agent that
 * wrote the sidecar while the page was open).
 *
 * Local wins for threads both sides know about — what is on screen is what the
 * reviewer just touched. Threads only the server knows about are adopted
 * rather than overwritten, unless this session deleted them, because deleting
 * is an explicit act and must stick. Returns `null` when the server adds
 * nothing, so callers can skip a pointless state update.
 */
export function mergeRemoteComments(
  remote: readonly Comment[],
  local: readonly Comment[],
  deletedLocally: ReadonlySet<string> = new Set(),
): Comment[] | null {
  const known = new Set(local.map((c) => c.id));
  const adopted = remote.filter((c) => !known.has(c.id) && !deletedLocally.has(c.id));
  if (adopted.length === 0) return null;
  return [...local, ...adopted];
}

/**
 * The set M4 turns into a revision brief.
 *
 * Resolved threads are settled business and must never reach the AI. Orphans
 * do reach it: the reviewer's instruction still stands even when the text it
 * pointed at has moved, and dropping it would silently lose review intent.
 */
export function selectForBrief(ordered: readonly Comment[]): Comment[] {
  return ordered.filter((c) => !c.resolved);
}
