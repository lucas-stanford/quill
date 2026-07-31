/**
 * annotations/docText.ts
 *
 * A flat text view of the ProseMirror document, plus the map back to positions.
 *
 * Anchors match against text, but decorations and selections need positions, so
 * every text node is recorded with both its document position and its offset in
 * the flat string. Block boundaries become a newline, which normalization in
 * anchor.ts then collapses — so a quote is free to span a block boundary and a
 * re-wrapped paragraph still matches.
 */

import type { Node as PMNode } from "@tiptap/pm/model";

interface Segment {
  /** Document position of the segment's first character. */
  from: number;
  /** Offset of the segment's first character in the flat text. */
  start: number;
  length: number;
}

export interface DocText {
  text: string;
  /** Document position for a flat-text offset. */
  posAt(offset: number, edge?: "start" | "end"): number;
  /** Flat-text offset for a document position. */
  offsetAt(pos: number, edge?: "start" | "end"): number;
}

const EMPTY: DocText = {
  text: "",
  posAt: () => 0,
  offsetAt: () => 0,
};

export function buildDocText(doc: PMNode | null | undefined): DocText {
  if (!doc) return EMPTY;

  const segments: Segment[] = [];
  let text = "";

  doc.descendants((node, pos) => {
    if (node.isText) {
      const value = node.text ?? "";
      if (value) {
        segments.push({ from: pos, start: text.length, length: value.length });
        text += value;
      }
      return false;
    }
    if (node.type.name === "hardBreak") {
      if (text.length > 0 && !text.endsWith("\n")) text += "\n";
      return false;
    }
    if (node.isBlock && text.length > 0 && !text.endsWith("\n")) {
      text += "\n";
    }
    return true;
  });

  /** Index of the last segment starting at or before `offset`, or -1. */
  function segmentForOffset(offset: number): number {
    let lo = 0;
    let hi = segments.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segments[mid]!.start <= offset) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }

  function posAt(offset: number, edge: "start" | "end" = "start"): number {
    if (segments.length === 0) return 0;
    const clamped = Math.max(0, Math.min(offset, text.length));
    const index = segmentForOffset(clamped);
    if (index < 0) return segments[0]!.from;

    const segment = segments[index]!;
    const within = clamped - segment.start;
    if (within <= segment.length) return segment.from + within;

    // The offset lands in a block separator, which has no position of its own.
    if (edge === "end") return segment.from + segment.length;
    const next = segments[index + 1];
    return next ? next.from : segment.from + segment.length;
  }

  function offsetAt(pos: number, edge: "start" | "end" = "start"): number {
    if (segments.length === 0) return 0;
    let lo = 0;
    let hi = segments.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segments[mid]!.from <= pos) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (found < 0) return 0;

    const segment = segments[found]!;
    const within = pos - segment.from;
    if (within <= segment.length) return segment.start + within;

    // Between two text nodes: bias outwards so a selection keeps its width.
    if (edge === "end") return segment.start + segment.length;
    const next = segments[found + 1];
    return next ? next.start : segment.start + segment.length;
  }

  return { text, posAt, offsetAt };
}

/** Trims whitespace off a flat-text range without losing its offsets. */
export function trimRange(text: string, start: number, end: number): [number, number] {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text[s]!)) s++;
  while (e > s && /\s/.test(text[e - 1]!)) e--;
  return [s, e];
}
