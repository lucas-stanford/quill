/**
 * markdown/source.ts
 *
 * The formatting memory of a loaded plan.
 *
 * Markdown soft wraps carry no meaning, so a serializer that only walks the
 * document tree cannot possibly put them back — every save would reflow the
 * whole file. The fix is to remember the exact source text of every block at
 * parse time and re-emit it verbatim for any block the user did not touch.
 *
 * ── How blocks are keyed ────────────────────────────────────────────────────
 *
 * Entries are keyed by the block's **canonical serialization** — the normalized,
 * unwrapped markdown the tree-walking serializer would produce for it. That key
 * has three properties we need:
 *
 *   1. It is computed by the same function at parse time and at save time, so
 *      it does not care whether the node came from our parser or from
 *      ProseMirror's `getJSON()` (which adds default attributes and merges
 *      adjacent text nodes).
 *   2. It is content-addressed, not positional, so inserting, deleting or
 *      reordering blocks cannot shift the mapping. A block edited and then
 *      edited back to its original text keys to the original entry again.
 *   3. Two entries can only collide when their blocks are *semantically
 *      identical*. The stored source of one therefore round-trips to the same
 *      document as the other, which makes a collision harmless: it can change
 *      soft wrapping, never meaning.
 *
 * Duplicate keys are kept as a list and handed out in document order, so a
 * document containing the same paragraph twice still reproduces both copies
 * byte-for-byte.
 *
 * ── Safety ─────────────────────────────────────────────────────────────────
 *
 * Re-serializing is always safe; emitting the wrong source text is not. Every
 * lookup that is not an exact key match returns `undefined` and the caller
 * falls back to normal serialization.
 */

/** The exact source text of one block, split from the whitespace that follows it. */
export interface SourceEntry {
  /** Source text of the block itself, trailing newlines removed. */
  raw: string;
  /**
   * The newlines and blank lines that separated it from the next block.
   *
   * Only meaningful next to the block that actually followed it in the file: a
   * final block's separator can be a bare "\n", which would swallow whatever
   * was emitted after it. Guarded by `seq`.
   */
  sep: string;
  /** Position of the block in the source, used to check that reuse is in context. */
  seq: number;
}

/** A source entry before it has been given its position in the file. */
export type SourceRecord = Omit<SourceEntry, "seq">;

/** Used when the source gives no evidence of a prevailing wrap width. */
export const DEFAULT_WRAP_WIDTH = 88;

const MIN_WRAP_WIDTH = 40;
const MAX_WRAP_WIDTH = 200;

type Bucket = Map<string, SourceEntry[]>;

function pushEntry(bucket: Bucket, key: string, entry: SourceEntry): void {
  const list = bucket.get(key);
  if (list) list.push(entry);
  else bucket.set(key, [entry]);
}

function takeEntry(
  bucket: Bucket,
  cursors: Map<string, number>,
  key: string,
): SourceEntry | undefined {
  if (!key) return undefined;
  const list = bucket.get(key);
  if (!list || list.length === 0) return undefined;
  const seen = cursors.get(key) ?? 0;
  cursors.set(key, seen + 1);
  // More copies in the document than in the source (a block was duplicated):
  // reuse the last known source. Same key means same content, so this only
  // ever affects wrapping.
  return list[Math.min(seen, list.length - 1)];
}

/**
 * One serialization pass over a document. Hands out stored source entries in
 * document order so repeated blocks line up with their original copies.
 */
export class SourceSession {
  private readonly blockCursors = new Map<string, number>();
  private readonly itemCursors = new Map<string, number>();
  private readonly blocks: Bucket;
  private readonly items: Bucket;

  constructor(blocks: Bucket, items: Bucket) {
    this.blocks = blocks;
    this.items = items;
  }

  /** Source for a top-level block whose canonical form is `key`, if known. */
  takeBlock(key: string): SourceEntry | undefined {
    return takeEntry(this.blocks, this.blockCursors, key);
  }

  /** Source for a list item whose canonical form is `key`, if known. */
  takeItem(key: string): SourceEntry | undefined {
    return takeEntry(this.items, this.itemCursors, key);
  }
}

/** Immutable record of a parsed document's original formatting. */
export class SourceMap {
  /** Wrap width to use for blocks that must be re-serialized. */
  readonly wrapWidth: number;

  private readonly blocks: Bucket = new Map();
  private readonly items: Bucket = new Map();
  private nextSeq = 0;

  constructor(wrapWidth: number = DEFAULT_WRAP_WIDTH) {
    this.wrapWidth = wrapWidth;
  }

  addBlock(key: string, record: SourceRecord): void {
    if (!key) return;
    pushEntry(this.blocks, key, { ...record, seq: this.nextSeq++ });
  }

  addItem(key: string, record: SourceRecord): void {
    if (!key) return;
    pushEntry(this.items, key, { ...record, seq: this.nextSeq++ });
  }

  /**
   * Register an additional key for source already stored under `fromKey`.
   *
   * Used to re-key entries against ProseMirror's own view of the document once
   * it has been loaded, so a harmless normalization inside the schema cannot
   * silently disable verbatim output. Purely additive: the original key keeps
   * working, and both keys describe the same content.
   */
  aliasBlock(fromKey: string, toKey: string): void {
    aliasIn(this.blocks, fromKey, toKey);
  }

  aliasItem(fromKey: string, toKey: string): void {
    aliasIn(this.items, fromKey, toKey);
  }

  /** True when nothing was recorded — every block will be re-serialized. */
  get isEmpty(): boolean {
    return this.blocks.size === 0 && this.items.size === 0;
  }

  session(): SourceSession {
    return new SourceSession(this.blocks, this.items);
  }
}

function aliasIn(bucket: Bucket, fromKey: string, toKey: string): void {
  if (!fromKey || !toKey || fromKey === toKey) return;
  const list = bucket.get(fromKey);
  if (!list) return;
  const existing = bucket.get(toKey);
  if (existing) {
    for (const entry of list) {
      if (!existing.some((e) => e.seq === entry.seq)) existing.push(entry);
    }
  } else {
    bucket.set(toKey, [...list]);
  }
}

/** Display width of a line, counted in code points rather than UTF-16 units. */
export function textWidth(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

/**
 * Infer the wrap width the author used, from blocks that actually wrapped.
 *
 * For a greedily wrapped block, every non-final line `L` whose next word has
 * length `k` tells us two things: the width is at least `L`, and the width is
 * less than `L + 1 + k` (otherwise that word would have fit). Intersecting
 * those bounds over the whole document pins the width down tightly. When the
 * evidence is thin or self-contradictory we fall back to a sane default rather
 * than guessing.
 */
export function detectWrapWidth(samples: string[]): number {
  let lowerBound = 0;
  let upperBound = Number.POSITIVE_INFINITY;
  let observations = 0;

  for (const sample of samples) {
    const lines = sample.replace(/\n+$/, "").split("\n");
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i];
      const nextWord = lines[i + 1].trim().split(/\s+/)[0] ?? "";
      if (!line.trim() || !nextWord) continue;
      lowerBound = Math.max(lowerBound, textWidth(line));
      upperBound = Math.min(upperBound, textWidth(line) + textWidth(nextWord));
      observations++;
    }
  }

  if (observations < 2 || lowerBound === 0) return DEFAULT_WRAP_WIDTH;

  const width = Number.isFinite(upperBound)
    ? Math.max(lowerBound, upperBound)
    : lowerBound;
  return Math.min(MAX_WRAP_WIDTH, Math.max(MIN_WRAP_WIDTH, width));
}
