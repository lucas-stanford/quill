/**
 * tracking/ranges.ts
 *
 * Bookkeeping for the document ranges a tracked change covers. Pure integer
 * arithmetic, kept away from ProseMirror so it can be tested directly.
 *
 * Two rules run through all of it:
 *
 *   - **Neighbouring changes by the same author, of the same kind, are one
 *     change.** Typing ten characters is one insertion in the review list, not
 *     ten, and it accepts or rejects as one thing.
 *   - **A change never overlaps another change of a different kind.** Text that
 *     is both "just inserted" and "now deleted" has no coherent meaning; the
 *     insertion is simply removed instead (see `splitAgainst`).
 */

import type { ChangeAuthor } from "../types";

export type ChangeKind = "insertion" | "deletion";

export interface Interval {
  from: number;
  to: number;
}

/** A tracked change, as positions in the current document. */
export interface TrackedRange extends Interval {
  id: string;
  author: ChangeAuthor;
  kind: ChangeKind;
}

let counter = 0;

/** Stable, unique-per-session id for a change. */
export function newChangeId(): string {
  counter += 1;
  return `tc-${counter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Test seam: makes ids deterministic across a test run. */
export function resetChangeIds(): void {
  counter = 0;
}

/**
 * Sort, drop empties, and fuse touching ranges that describe the same change.
 *
 * Fusing keeps the *earliest* id so a change the user has already hovered does
 * not get a new identity every keystroke.
 */
export function normalizeRanges(ranges: readonly TrackedRange[]): TrackedRange[] {
  const sorted = ranges
    .filter((range) => range.to > range.from)
    .slice()
    .sort((a, b) => a.from - b.from || a.to - b.to);

  const out: TrackedRange[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    const fusable =
      last !== undefined &&
      last.kind === range.kind &&
      last.author === range.author &&
      range.from <= last.to;

    if (fusable) last.to = Math.max(last.to, range.to);
    else out.push({ ...range });
  }
  return out;
}

/** Clamp every range into `[0, docSize]`, dropping any that collapsed. */
export function clampRanges(
  ranges: readonly TrackedRange[],
  docSize: number,
): TrackedRange[] {
  const out: TrackedRange[] = [];
  for (const range of ranges) {
    const from = Math.max(0, Math.min(range.from, docSize));
    const to = Math.max(0, Math.min(range.to, docSize));
    if (to > from) out.push({ ...range, from, to });
  }
  return out;
}

/** The parts of `base` that no interval in `holes` covers, in order. */
export function subtractIntervals(
  base: Interval,
  holes: readonly Interval[],
): Interval[] {
  const sorted = holes
    .filter((hole) => hole.to > base.from && hole.from < base.to)
    .slice()
    .sort((a, b) => a.from - b.from);

  const out: Interval[] = [];
  let cursor = base.from;
  for (const hole of sorted) {
    if (hole.from > cursor) out.push({ from: cursor, to: Math.min(hole.from, base.to) });
    cursor = Math.max(cursor, hole.to);
    if (cursor >= base.to) break;
  }
  if (cursor < base.to) out.push({ from: cursor, to: base.to });
  return out.filter((interval) => interval.to > interval.from);
}

/** The parts of `base` that at least one interval in `others` covers. */
export function intersectIntervals(
  base: Interval,
  others: readonly Interval[],
): Interval[] {
  const overlaps = others
    .map((other) => ({
      from: Math.max(base.from, other.from),
      to: Math.min(base.to, other.to),
    }))
    .filter((interval) => interval.to > interval.from)
    .sort((a, b) => a.from - b.from);

  const out: Interval[] = [];
  for (const overlap of overlaps) {
    const last = out[out.length - 1];
    if (last && overlap.from <= last.to) last.to = Math.max(last.to, overlap.to);
    else out.push({ ...overlap });
  }
  return out;
}

export interface SplitDeletion {
  /** Already inserted by this author and still pending: really remove it. */
  remove: Interval[];
  /** Original text: keep it, struck through, until someone decides. */
  strike: Interval[];
}

/**
 * Decide what deleting `[from, to)` actually means.
 *
 * Backspacing over text you just typed should take it away — Word does this,
 * and leaving a strike-through over your own unaccepted insertion would ask the
 * reviewer to adjudicate an edit that never reached the document. Everything
 * else is struck instead of removed. Text already marked as deleted is skipped
 * so pressing Backspace twice does not stack two changes on one word.
 */
export function splitDeletion(
  target: Interval,
  ranges: readonly TrackedRange[],
  author: ChangeAuthor,
): SplitDeletion {
  const ownInsertions = ranges.filter(
    (range) => range.kind === "insertion" && range.author === author,
  );
  const deletions = ranges.filter((range) => range.kind === "deletion");

  const remove = intersectIntervals(target, ownInsertions);
  const strike = subtractIntervals(target, [...ownInsertions, ...deletions]);
  return { remove, strike };
}
