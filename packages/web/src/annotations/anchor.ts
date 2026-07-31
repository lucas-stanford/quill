/**
 * annotations/anchor.ts
 *
 * Text-quote anchoring, in the spirit of the W3C Web Annotation model.
 *
 * A comment never stores a position. It stores the exact text it was attached
 * to plus a window of surrounding context, and is re-anchored against the
 * current document every time the document changes. That is what lets a comment
 * survive the AI rewording the paragraph around it (M4).
 *
 * Resolution order, strictly:
 *   1. exact quote occurrence whose prefix AND suffix also match  -> "context"
 *   2. exact quote occurrence, disambiguated by context overlap   -> "quote"
 *   3. fuzzy quote match at or above FUZZY_MIN_SIMILARITY         -> "fuzzy"
 *   4. nothing — the caller orphans the comment.
 *
 * A mis-attached comment is worse than a lost one (CONTRACT.md invariant 3), so
 * every ambiguous outcome resolves to *nothing*: if two candidates are equally
 * good, the comment orphans rather than picking one.
 *
 * Everything here is pure and DOM-free so it can be unit tested directly.
 */

import type { TextAnchor } from "../types";

/** Characters of context captured either side of a new anchor. */
export const CONTEXT_CHARS = 48;

/**
 * Shortest normalized quote eligible for fuzzy matching. Below this a quote
 * carries too little signal — "the" would fuzzy-match almost anything — so
 * short quotes must match exactly or orphan.
 */
export const FUZZY_MIN_QUOTE_CHARS = 6;

/**
 * Character-level similarity a fuzzy candidate must reach, i.e. at most 20% of
 * the quote's characters may have changed. Chosen deliberately stricter than
 * the 0.75 that text-quote implementations commonly use, because Quill's
 * invariant prefers an orphan over a mis-attachment: 20% absorbs typo fixes,
 * punctuation and casing churn, and one changed word in a sentence, while a
 * genuinely rewritten sentence lands well below it and orphans.
 */
export const FUZZY_MIN_SIMILARITY = 0.8;

export type AnchorStrategy = "context" | "quote" | "fuzzy";

export interface AnchorMatch {
  /** Offsets into the *raw* document text passed to the resolver. */
  start: number;
  end: number;
  strategy: AnchorStrategy;
  /** 1 for the exact strategies; 0..1 for fuzzy. */
  similarity: number;
}

/**
 * Whitespace-collapsed, lower-cased view of a string, with a per-character map
 * back to raw offsets. Matching runs in normalized space so re-wrapped source,
 * block boundaries and casing changes do not break an anchor; the result is
 * mapped back to raw offsets, which is what the caller turns into positions.
 */
export interface NormalizedText {
  text: string;
  /** toRaw[i] is the raw offset of normalized character i. */
  toRaw: number[];
  /** Length of the raw string, so an end offset can be clamped. */
  rawLength: number;
}

function isWhitespace(code: number): boolean {
  return code === 32 || (code >= 9 && code <= 13) || code === 0x00a0;
}

/** Collapses whitespace runs to one space, lower-cases, and drops edge space. */
export function normalizeText(raw: string): NormalizedText {
  let text = "";
  const toRaw: number[] = [];
  let wsStart = -1;

  for (let i = 0; i < raw.length; i++) {
    if (isWhitespace(raw.charCodeAt(i))) {
      if (wsStart < 0) wsStart = i;
      continue;
    }
    if (wsStart >= 0) {
      if (text.length > 0) {
        text += " ";
        toRaw.push(wsStart);
      }
      wsStart = -1;
    }
    const ch = raw[i]!;
    const lower = ch.toLowerCase();
    // Keep the mapping 1:1 — a few code points grow when lower-cased.
    text += lower.length === 1 ? lower : ch;
    toRaw.push(i);
  }

  return { text, toRaw, rawLength: raw.length };
}

/** Maps a normalized [start, end) range back to raw offsets. */
function toRawRange(doc: NormalizedText, start: number, end: number): [number, number] {
  if (end <= start) {
    const at = doc.toRaw[start] ?? doc.rawLength;
    return [at, at];
  }
  const rawStart = doc.toRaw[start] ?? doc.rawLength;
  const rawEnd = (doc.toRaw[end - 1] ?? doc.rawLength - 1) + 1;
  return [rawStart, Math.min(rawEnd, doc.rawLength)];
}

function findAll(haystack: string, needle: string, limit = 512): number[] {
  const found: number[] = [];
  if (!needle) return found;
  let at = haystack.indexOf(needle);
  while (at >= 0 && found.length < limit) {
    found.push(at);
    at = haystack.indexOf(needle, at + 1);
  }
  return found;
}

function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * How much of the anchor's recorded context still surrounds a candidate, in
 * characters. Used to choose between repeated occurrences of the same quote.
 */
function contextScore(
  text: string,
  start: number,
  end: number,
  prefix: string,
  suffix: string,
): number {
  const before = text.slice(Math.max(0, start - prefix.length), start);
  const after = text.slice(end, end + suffix.length);
  return commonSuffixLength(before, prefix) + commonPrefixLength(after, suffix);
}

const WORD_RE = /[\p{L}\p{N}]{3,}/gu;

/**
 * Context is compared in normalized space, but the whitespace *between* the
 * context and the quote carries meaning: normalization drops a string's edge
 * whitespace, so a prefix captured as "…step 4: " would arrive as "…step 4:"
 * and fail to line up against "…step 4: run the backfill". Put the boundary
 * space back before comparing.
 */
function normalizeSide(raw: string, side: "prefix" | "suffix"): string {
  const text = normalizeText(raw).text;
  if (!text) return "";
  if (side === "prefix") return /\s$/.test(raw) ? `${text} ` : text;
  return /^\s/.test(raw) ? ` ${text}` : text;
}

function countOccurrences(haystack: string, needle: string, cap = 64): number {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at >= 0 && count < cap) {
    count++;
    at = haystack.indexOf(needle, at + 1);
  }
  return count;
}

/**
 * Cheap candidate generation for the fuzzy pass: find where the quote's rarest
 * words still appear and line the quote up against each of them. Without this,
 * fuzzy matching would have to run an edit-distance sweep over the whole
 * document, which is far too slow to run on every document change.
 */
function candidateStarts(text: string, quote: string, maxCandidates = 48): number[] {
  const words: Array<{ word: string; offset: number; count: number }> = [];
  for (const match of quote.matchAll(WORD_RE)) {
    const word = match[0];
    const offset = match.index ?? 0;
    const count = countOccurrences(text, word);
    if (count > 0) words.push({ word, offset, count });
  }
  if (words.length === 0) return [];

  // Rarest first: a word that appears once pins the quote almost exactly.
  words.sort((a, b) => a.count - b.count || b.word.length - a.word.length);

  const starts = new Set<number>();
  for (const { word, offset } of words.slice(0, 5)) {
    for (const at of findAll(text, word, 40)) {
      starts.add(Math.max(0, at - offset));
      if (starts.size >= maxCandidates) return [...starts];
    }
  }
  return [...starts];
}

interface WindowMatch {
  start: number;
  end: number;
  distance: number;
}

/**
 * Best approximate occurrence of `pattern` inside text[from, to), by Levenshtein
 * distance with a free start and a free end. Returns null when nothing in the
 * window is within `maxDistance` edits.
 *
 * Classic two-row DP; the parallel `*Start` rows carry the alignment's start
 * offset so the matched range can be reported, and the per-row minimum lets the
 * scan bail out as soon as the window cannot possibly qualify.
 */
function bestMatchInWindow(
  text: string,
  from: number,
  to: number,
  pattern: string,
  maxDistance: number,
): WindowMatch | null {
  const m = pattern.length;
  const n = to - from;
  if (m === 0 || n <= 0) return null;

  let prev = new Int32Array(n + 1);
  let prevStart = new Int32Array(n + 1);
  let cur = new Int32Array(n + 1);
  let curStart = new Int32Array(n + 1);

  for (let j = 0; j <= n; j++) {
    prev[j] = 0; // free start: a match may begin anywhere in the window
    prevStart[j] = j;
  }

  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    curStart[0] = 0;
    let rowMin = cur[0];
    const patternChar = pattern[i - 1];

    for (let j = 1; j <= n; j++) {
      const cost = patternChar === text[from + j - 1] ? 0 : 1;
      let best = prev[j - 1]! + cost;
      let bestStart = prevStart[j - 1]!;

      const skipText = cur[j - 1]! + 1;
      if (skipText < best) {
        best = skipText;
        bestStart = curStart[j - 1]!;
      }
      const skipPattern = prev[j]! + 1;
      if (skipPattern < best) {
        best = skipPattern;
        bestStart = prevStart[j]!;
      }

      cur[j] = best;
      curStart[j] = bestStart;
      if (best < rowMin) rowMin = best;
    }

    if (rowMin > maxDistance) return null;

    [prev, cur] = [cur, prev];
    [prevStart, curStart] = [curStart, prevStart];
  }

  let bestJ = -1;
  let bestDistance = maxDistance + 1;
  for (let j = 0; j <= n; j++) {
    if (prev[j]! < bestDistance) {
      bestDistance = prev[j]!;
      bestJ = j;
    }
  }
  if (bestJ < 0) return null;

  return { start: from + prevStart[bestJ]!, end: from + bestJ, distance: bestDistance };
}

interface Candidate {
  start: number;
  end: number;
  distance: number;
  context: number;
}

function fuzzyResolve(
  doc: NormalizedText,
  quote: string,
  prefix: string,
  suffix: string,
): AnchorMatch | null {
  if (quote.length < FUZZY_MIN_QUOTE_CHARS) return null;

  const maxDistance = Math.floor(quote.length * (1 - FUZZY_MIN_SIMILARITY));
  if (maxDistance < 1) return null;

  const slack = maxDistance + 2;
  const seen = new Map<string, Candidate>();

  for (const start of candidateStarts(doc.text, quote)) {
    const from = Math.max(0, start - slack);
    const to = Math.min(doc.text.length, start + quote.length + slack);
    const match = bestMatchInWindow(doc.text, from, to, quote, maxDistance);
    if (!match) continue;
    const key = `${match.start}:${match.end}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      start: match.start,
      end: match.end,
      distance: match.distance,
      context: contextScore(doc.text, match.start, match.end, prefix, suffix),
    });
  }

  const candidates = [...seen.values()];
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => a.distance - b.distance || b.context - a.context);
  const best = candidates[0]!;
  const runnerUp = candidates[1];

  // Two equally good, non-overlapping readings of the same quote: refuse both.
  if (
    runnerUp &&
    runnerUp.distance === best.distance &&
    runnerUp.context === best.context &&
    !(runnerUp.start < best.end && best.start < runnerUp.end)
  ) {
    return null;
  }

  const [rawStart, rawEnd] = toRawRange(doc, best.start, best.end);
  return {
    start: rawStart,
    end: rawEnd,
    strategy: "fuzzy",
    similarity: 1 - best.distance / quote.length,
  };
}

/** Prepares a document once so many anchors can be resolved against it. */
export function prepareDocument(docText: string): NormalizedText {
  return normalizeText(docText);
}

/**
 * Builds an anchor for the text at [start, end) of `docText`. Nothing
 * positional is stored — only the quote and its surrounding context window.
 */
export function createAnchor(docText: string, start: number, end: number): TextAnchor {
  return {
    quote: docText.slice(start, end),
    prefix: docText.slice(Math.max(0, start - CONTEXT_CHARS), start),
    suffix: docText.slice(end, Math.min(docText.length, end + CONTEXT_CHARS)),
  };
}

/** Resolves an anchor against an already-normalized document. */
export function resolveAnchorIn(doc: NormalizedText, anchor: TextAnchor): AnchorMatch | null {
  const quote = normalizeText(anchor.quote).text;
  if (!quote) return null;
  if (!doc.text) return null;

  const prefix = normalizeSide(anchor.prefix, "prefix");
  const suffix = normalizeSide(anchor.suffix, "suffix");

  const occurrences = findAll(doc.text, quote);

  if (occurrences.length === 1) {
    const start = occurrences[0]!;
    const end = start + quote.length;
    const score = contextScore(doc.text, start, end, prefix, suffix);
    const full = prefix.length + suffix.length > 0 && score === prefix.length + suffix.length;
    const [rawStart, rawEnd] = toRawRange(doc, start, end);
    return {
      start: rawStart,
      end: rawEnd,
      strategy: full ? "context" : "quote",
      similarity: 1,
    };
  }

  if (occurrences.length > 1) {
    const scored = occurrences
      .map((start) => ({
        start,
        end: start + quote.length,
        score: contextScore(doc.text, start, start + quote.length, prefix, suffix),
      }))
      .sort((a, b) => b.score - a.score || a.start - b.start);

    const best = scored[0]!;
    const runnerUp = scored[1]!;
    // The quote appears more than once and context cannot separate the
    // candidates — orphan rather than guess.
    if (best.score === runnerUp.score) return null;

    const [rawStart, rawEnd] = toRawRange(doc, best.start, best.end);
    return {
      start: rawStart,
      end: rawEnd,
      strategy: best.score === prefix.length + suffix.length ? "context" : "quote",
      similarity: 1,
    };
  }

  return fuzzyResolve(doc, quote, prefix, suffix);
}

/** Convenience wrapper for a one-off resolve. */
export function resolveAnchor(docText: string, anchor: TextAnchor): AnchorMatch | null {
  return resolveAnchorIn(prepareDocument(docText), anchor);
}
