/**
 * tracking/diff.ts
 *
 * The diff behind `applyRevision`. Pure, DOM-free and ProseMirror-free so it
 * can be unit tested on its own — it is the highest-risk logic in the lane.
 *
 * ── Why a two-level diff ────────────────────────────────────────────────────
 *
 * An AI revision arrives as a whole new markdown file. Diffing the two files as
 * raw text produces a change per soft-wrapped line, and diffing them as trees
 * produces "every block replaced" the moment a sentence moves. Neither reads
 * like an edit a person made, and a reviewer who is shown a catastrophic diff
 * for a one-word change stops reading revisions altogether.
 *
 * So the diff runs at two levels:
 *
 *   1. **Blocks.** A Myers diff over block keys (`type` + plain text) aligns the
 *      two documents. Equal blocks are untouched — no change is emitted for
 *      them, ever. A moved paragraph therefore costs exactly one deletion and
 *      one insertion of that paragraph, not a rewrite of everything after it.
 *   2. **Words.** A delete run that is immediately followed by an insert run is
 *      the shape of "this block was edited in place". Those blocks are paired
 *      up by similarity and diffed again at word level, so changing one word
 *      marks one word.
 *
 * Pairing is deliberately only attempted for runs that sit at the *same* place
 * in the block stream. A block that merely moved shows up as a deletion here
 * and an insertion there, never adjacent, so it is never mistaken for a rewrite
 * of whatever now sits in its place.
 */

export type DiffOpType = "equal" | "insert" | "delete";

/** A run of text that is unchanged, inserted or deleted. */
export interface WordOp {
  type: DiffOpType;
  text: string;
}

/**
 * One top-level block, reduced to what the diff compares.
 *
 * `node` is an opaque payload the caller can hang the block's source node off;
 * the diff only ever passes it through.
 */
export interface DiffBlock<N = unknown> {
  /** Node type name, so a paragraph never silently becomes a heading. */
  type: string;
  /** The block's plain text, in document order. */
  text: string;
  node?: N;
}

/** An edit to the old document, addressed by old block index. */
export type DocOp<N = unknown> =
  | { type: "modify"; oldIndex: number; ops: WordOp[] }
  | { type: "delete"; oldIndex: number }
  | { type: "insert"; beforeOldIndex: number; block: DiffBlock<N> };

interface Run<T> {
  type: DiffOpType;
  values: T[];
}

/**
 * Two blocks are paired as an in-place edit above this word overlap. Below it
 * they are reported as a wholesale delete plus insert, which is both more
 * honest and easier to reject.
 */
const SIMILARITY_THRESHOLD = 0.4;

/**
 * Myers is O(ND); beyond this the two sequences share nothing worth aligning
 * and we fall back to "replaced", which is exactly what the reviewer would
 * conclude anyway.
 */
const MAX_EDIT_DISTANCE = 3000;

// ─── Sequence diff (Myers) ──────────────────────────────────────────────────

/**
 * Minimal edit script between two sequences, as runs.
 *
 * Common prefixes and suffixes are peeled off first: it costs a linear scan and
 * turns the usual case (one word differs in the middle of a document) into a
 * problem small enough that the O(ND) core never breaks a sweat.
 */
export function diffSequences<T>(a: readonly T[], b: readonly T[]): Run<T>[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const runs: Run<T>[] = [];
  if (start > 0) runs.push({ type: "equal", values: a.slice(0, start) });
  runs.push(...myers(a.slice(start, endA), b.slice(start, endB)));
  if (endA < a.length) runs.push({ type: "equal", values: a.slice(endA) });

  return coalesce(runs);
}

function myers<T>(a: readonly T[], b: readonly T[]): Run<T>[] {
  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0) return [{ type: "insert", values: [...b] }];
  if (b.length === 0) return [{ type: "delete", values: [...a] }];

  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (max > MAX_EDIT_DISTANCE) {
    return [
      { type: "delete", values: [...a] },
      { type: "insert", values: [...b] },
    ];
  }

  // One slot of headroom on each side so the k ± 1 probes below never fall off
  // the end of the array.
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(a, b, trace, offset);
    }
  }

  /* c8 ignore next 4 -- unreachable: an edit script always exists within `max` */
  return [
    { type: "delete", values: [...a] },
    { type: "insert", values: [...b] },
  ];
}

/**
 * Walk the recorded frontiers backwards, turning each move into an op.
 * `trace[d]` is the frontier *before* round `d`, which is what decides whether
 * round `d` arrived here by inserting or by deleting.
 */
function backtrack<T>(
  a: readonly T[],
  b: readonly T[],
  trace: Int32Array[],
  offset: number,
): Run<T>[] {
  const reversed: Run<T>[] = [];
  let x = a.length;
  let y = b.length;

  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;
    const prevK =
      k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
        ? k + 1
        : k - 1;
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      reversed.push({ type: "equal", values: [a[x - 1]] });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) {
        reversed.push({ type: "insert", values: [b[y - 1]] });
      } else {
        reversed.push({ type: "delete", values: [a[x - 1]] });
      }
    }
    x = prevX;
    y = prevY;
  }

  return coalesce(reversed.reverse());
}

function coalesce<T>(runs: Run<T>[]): Run<T>[] {
  const out: Run<T>[] = [];
  for (const run of runs) {
    if (run.values.length === 0) continue;
    const last = out[out.length - 1];
    if (last && last.type === run.type) last.values.push(...run.values);
    else out.push({ type: run.type, values: [...run.values] });
  }
  return out;
}

// ─── Word diff ──────────────────────────────────────────────────────────────

const LEADING_PUNCTUATION = /^[("'‘“[{«]+/;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}"'’”»…]+$/;

/**
 * Words, the whitespace between them, and the punctuation clinging to them are
 * all separate tokens.
 *
 * Keeping the gaps as tokens of their own is what stops "quick" -> "slow" from
 * swallowing the spaces on either side and reporting the whole phrase as
 * rewritten. Peeling the punctuation off is what stops "bad." -> "miserable."
 * from striking and re-typing a full stop that never moved.
 */
export function tokenizeWords(text: string): string[] {
  const tokens: string[] = [];
  for (const chunk of text.match(/\s+|\S+/g) ?? []) {
    if (/^\s/.test(chunk)) {
      tokens.push(chunk);
      continue;
    }

    let core = chunk;
    const lead = LEADING_PUNCTUATION.exec(core)?.[0];
    if (lead && lead.length < core.length) {
      tokens.push(lead);
      core = core.slice(lead.length);
    }

    const trail = TRAILING_PUNCTUATION.exec(core)?.[0];
    if (trail && trail.length < core.length) {
      tokens.push(core.slice(0, core.length - trail.length), trail);
    } else {
      tokens.push(core);
    }
  }
  return tokens;
}

/** Word-level diff of two strings, as a flat run of equal/insert/delete text. */
export function diffWords(oldText: string, newText: string): WordOp[] {
  if (oldText === newText) {
    return oldText ? [{ type: "equal", text: oldText }] : [];
  }
  return diffSequences(tokenizeWords(oldText), tokenizeWords(newText))
    .map((run) => ({ type: run.type, text: run.values.join("") }))
    .filter((op) => op.text !== "");
}

// ─── Document diff ──────────────────────────────────────────────────────────

function blockKey(block: DiffBlock): string {
  return `${block.type}\u0000${block.text}`;
}

function comparableWords(text: string): string[] {
  const words: string[] = [];
  for (const raw of text.toLowerCase().match(/\S+/g) ?? []) {
    const word = raw
      .replace(LEADING_PUNCTUATION, "")
      .replace(TRAILING_PUNCTUATION, "");
    words.push(word || raw);
  }
  return words;
}

/**
 * Word overlap of two blocks, as a Dice coefficient over the multiset of words.
 * Cheap, order-insensitive, and good enough to tell "this paragraph was edited"
 * from "this paragraph was replaced by a different one". Punctuation is ignored
 * so that requoting or repunctuating a sentence does not read as a rewrite.
 */
export function similarity(a: string, b: string): number {
  const wordsA = comparableWords(a);
  const wordsB = comparableWords(b);
  if (wordsA.length === 0 && wordsB.length === 0) return 1;
  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  const remaining = new Map<string, number>();
  for (const word of wordsA) remaining.set(word, (remaining.get(word) ?? 0) + 1);

  let common = 0;
  for (const word of wordsB) {
    const left = remaining.get(word) ?? 0;
    if (left > 0) {
      common++;
      remaining.set(word, left - 1);
    }
  }
  return (2 * common) / (wordsA.length + wordsB.length);
}

/**
 * Diff two documents block by block, refining edited blocks down to words.
 *
 * Every returned op is addressed against the OLD document, so a caller holding
 * the old document can apply them without re-deriving anything. Identical
 * documents return no ops at all.
 */
export function diffDocuments<N>(
  oldBlocks: readonly DiffBlock<N>[],
  newBlocks: readonly DiffBlock<N>[],
): DocOp<N>[] {
  const runs = diffSequences(oldBlocks.map(blockKey), newBlocks.map(blockKey));
  const out: DocOp<N>[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];

    if (run.type === "equal") {
      oldIndex += run.values.length;
      newIndex += run.values.length;
      continue;
    }

    if (run.type === "insert") {
      for (let j = 0; j < run.values.length; j++) {
        out.push({
          type: "insert",
          beforeOldIndex: oldIndex,
          block: newBlocks[newIndex + j],
        });
      }
      newIndex += run.values.length;
      continue;
    }

    // A delete run directly followed by an insert run is the shape of blocks
    // edited in place. Anything else is a straight removal.
    const next = runs[i + 1];
    const deletes = run.values.length;
    const inserts = next?.type === "insert" ? next.values.length : 0;
    const paired = Math.min(deletes, inserts);

    for (let j = 0; j < paired; j++) {
      const before = oldBlocks[oldIndex + j];
      const after = newBlocks[newIndex + j];
      const editedInPlace =
        before.type === after.type &&
        before.text !== after.text &&
        similarity(before.text, after.text) >= SIMILARITY_THRESHOLD;

      if (editedInPlace) {
        out.push({
          type: "modify",
          oldIndex: oldIndex + j,
          ops: diffWords(before.text, after.text),
        });
      } else {
        // Struck first, replacement after: it reads like a diff.
        out.push({ type: "delete", oldIndex: oldIndex + j });
        out.push({
          type: "insert",
          beforeOldIndex: oldIndex + j + 1,
          block: after,
        });
      }
    }

    for (let j = paired; j < deletes; j++) {
      out.push({ type: "delete", oldIndex: oldIndex + j });
    }
    for (let j = paired; j < inserts; j++) {
      out.push({
        type: "insert",
        beforeOldIndex: oldIndex + deletes,
        block: newBlocks[newIndex + j],
      });
    }

    oldIndex += deletes;
    newIndex += inserts;
    if (inserts > 0) i++;
  }

  return out;
}
