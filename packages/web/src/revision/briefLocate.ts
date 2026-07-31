/**
 * revision/briefLocate.ts
 *
 * Putting a reviewer's edit back on the map.
 *
 * A `TrackedChange` carries the text that was struck or typed, but no position:
 * the tracking plugin holds positions in ProseMirror coordinates, which mean
 * nothing to an agent reading markdown. So the brief has to find each edit in
 * the plan text itself, which buys two things the agent cannot work without:
 *
 *   - **context** — a short excerpt showing where the edit sits, so "delete
 *     'the backfill'" is not a search-and-replace over four paragraphs;
 *   - **replacement pairing** — a deletion and an insertion that touch are one
 *     decision (the reviewer typed over a selection). Reporting them as two
 *     unrelated events invites the agent to delete a sentence *and* bolt the
 *     new one on somewhere else.
 *
 * Matching runs in the normalized space that M3's anchoring already defines
 * (whitespace collapsed, lower-cased, mapped back to raw offsets), so an edit
 * still matches across the line wrapping the markdown serializer applies. The
 * deep imports are deliberate: `annotations/index` also exports React
 * components, and this module must stay pure so it can be unit tested and run
 * anywhere the brief travels.
 */

import { prepareDocument, resolveAnchorIn } from "../annotations/anchor";
import type { BriefEdit } from "../types";

/** Half-open range of raw offsets into the plan markdown. */
export interface Span {
  start: number;
  end: number;
}

/** Characters of plan text shown either side of an edit in its context. */
export const EDIT_CONTEXT_CHARS = 90;

/**
 * Longest edit reproduced whole inside a context excerpt. Beyond this the
 * middle is elided — the full text is already in `BriefEdit.text`, and a
 * context that is mostly the edit itself has stopped being context.
 */
const MAX_EDIT_IN_CONTEXT = 200;

/**
 * How much plan text may sit between a deletion and an insertion for them to
 * still count as one replacement. Zero would miss the common cases: markdown
 * emphasis markers (`**`) and the space the editor leaves behind both land in
 * the gap, and the tracking plugin records the two halves as separate ranges.
 */
const REPLACEMENT_GAP_CHARS = 4;

type Prepared = ReturnType<typeof prepareDocument>;

/** Where an edit sits in the plan, and what it was paired with. */
export interface EditPlacement {
  /** Raw offsets into the markdown, or null when the text was not found. */
  span: Span | null;
  /** Index of the edit this one forms a replacement with, or -1. */
  partner: number;
}

/** An edit, or a deletion and insertion read as the single decision they are. */
export type BriefEditItem =
  | { kind: "insertion" | "deletion"; edit: BriefEdit; context?: string }
  | { kind: "replacement"; removed: BriefEdit; added: BriefEdit; context?: string };

function rawRange(doc: Prepared, start: number, end: number): Span {
  const rawStart = doc.toRaw[start] ?? doc.rawLength;
  const rawEnd = (doc.toRaw[end - 1] ?? doc.rawLength - 1) + 1;
  return { start: rawStart, end: Math.min(rawEnd, doc.rawLength) };
}

/**
 * Find one edit's text in the plan.
 *
 * The cursor walks forward with the edits, which arrive in document order, so
 * two identical sentences struck in two places land on their own occurrence
 * instead of both matching the first. A search from the top is the fallback for
 * a caller that hands them over out of order, and M3's fuzzy resolver is the
 * last resort for text the markdown syntax has broken up (`**bold**`).
 */
function locate(doc: Prepared, text: string, cursor: number): { span: Span; next: number } | null {
  const needle = prepareDocument(text).text;
  if (!needle) return null;

  let at = doc.text.indexOf(needle, cursor);
  if (at < 0) at = doc.text.indexOf(needle);
  if (at >= 0) {
    return { span: rawRange(doc, at, at + needle.length), next: at + needle.length };
  }

  const fuzzy = resolveAnchorIn(doc, { quote: text, prefix: "", suffix: "" });
  if (!fuzzy) return null;
  return { span: { start: fuzzy.start, end: fuzzy.end }, next: cursor };
}

/** True when nothing but whitespace and markdown punctuation separates two spans. */
function touching(markdown: string, a: Span, b: Span): boolean {
  const from = Math.min(a.end, b.end);
  const to = Math.max(a.start, b.start);
  if (to <= from) return true;
  const gap = markdown.slice(from, to);
  if (gap.trim() === "") return true;
  return gap.length <= REPLACEMENT_GAP_CHARS && /^[*_~`\s]+$/.test(gap);
}

/**
 * Locate every edit and pair the ones that are really a replacement.
 *
 * Pairing is greedy and left to right over neighbours in document order: an
 * edit belongs to at most one replacement, so a strike, a retype and a second
 * strike do not collapse into one confused instruction.
 */
export function placeEdits(markdown: string, edits: readonly BriefEdit[]): EditPlacement[] {
  const doc = prepareDocument(markdown);
  const placements: EditPlacement[] = [];

  let cursor = 0;
  for (const edit of edits) {
    const found = locate(doc, edit.text, cursor);
    if (found) cursor = found.next;
    placements.push({ span: found?.span ?? null, partner: -1 });
  }

  for (let i = 0; i + 1 < edits.length; i++) {
    const left = edits[i]!;
    const right = edits[i + 1]!;
    if (left.kind === right.kind) continue;
    if (placements[i]!.partner !== -1 || placements[i + 1]!.partner !== -1) continue;

    const a = placements[i]!.span;
    const b = placements[i + 1]!.span;
    if (!a || !b || !touching(markdown, a, b)) continue;

    placements[i]!.partner = i + 1;
    placements[i + 1]!.partner = i;
  }

  return placements;
}

/** The two spans as one, so a replacement gets a single shared excerpt. */
export function unionSpan(a: Span, b: Span | null): Span {
  if (!b) return a;
  return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * A one-line excerpt of the plan around `span`, with the edit itself left in
 * place so the agent can see the words either side of it rather than having to
 * re-derive where they are.
 */
export function editContext(markdown: string, span: Span): string {
  const leftFrom = Math.max(0, span.start - EDIT_CONTEXT_CHARS);
  let left = markdown.slice(leftFrom, span.start);
  const rightTo = Math.min(markdown.length, span.end + EDIT_CONTEXT_CHARS);
  let right = markdown.slice(span.end, rightTo);

  // Never start or end mid-word: a half word reads as a typo in the plan.
  if (leftFrom > 0) {
    const cut = left.search(/\s/);
    left = cut >= 0 ? left.slice(cut + 1) : left;
  }
  if (rightTo < markdown.length) {
    const cut = right.search(/\s\S*$/);
    right = cut >= 0 ? right.slice(0, cut) : right;
  }

  const body = markdown.slice(span.start, span.end);
  const middle =
    body.length <= MAX_EDIT_IN_CONTEXT
      ? body
      : `${body.slice(0, MAX_EDIT_IN_CONTEXT / 2)} […] ${body.slice(-MAX_EDIT_IN_CONTEXT / 2)}`;

  const excerpt = collapse(`${left}${middle}${right}`);
  if (!excerpt) return "";
  const lead = leftFrom > 0 ? "…" : "";
  const tail = rightTo < markdown.length ? "…" : "";
  return `${lead}${excerpt}${tail}`;
}

/**
 * The edits as the agent should read them: replacements folded into one item,
 * everything else passed through in document order.
 *
 * Derived from the brief alone — markdown plus edit texts — so the bridge can
 * render a prompt from a brief it received as JSON, with no access to the
 * editor that produced it.
 */
export function pairBriefEdits(
  markdown: string,
  edits: readonly BriefEdit[],
): BriefEditItem[] {
  const placements = placeEdits(markdown, edits);
  const items: BriefEditItem[] = [];
  const used = new Set<number>();

  for (let i = 0; i < edits.length; i++) {
    if (used.has(i)) continue;
    const edit = edits[i]!;
    const partner = placements[i]!.partner;

    if (partner > i) {
      const other = edits[partner]!;
      used.add(partner);
      const removed = edit.kind === "deletion" ? edit : other;
      const added = edit.kind === "deletion" ? other : edit;
      items.push({
        kind: "replacement",
        removed,
        added,
        context: removed.context ?? added.context,
      });
      continue;
    }

    items.push({ kind: edit.kind, edit, context: edit.context });
  }

  return items;
}
