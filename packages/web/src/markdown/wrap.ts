/**
 * markdown/wrap.ts
 *
 * Soft-wraps re-serialized prose to the document's prevailing width.
 *
 * A block that the user genuinely edited cannot be emitted from stored source,
 * so it has to be rebuilt from the tree. Emitting it as one enormous line would
 * make that block's diff unreadable, so we re-wrap it instead — matching the
 * surrounding document so the change stays local to the words that moved.
 *
 * Two things must never happen:
 *   - A break inside a construct where a newline changes meaning: inline code
 *     spans, link syntax, escapes.
 *   - A continuation line that starts with something the parser would read as a
 *     new block (`#`, `- `, `1.`, `>`, a fence, a rule, a table pipe). Markdown
 *     lazy continuation would silently turn that into a heading or a list.
 *
 * Callers must never wrap fenced code, tables or anything else whitespace
 * significant; this module is only ever handed inline prose.
 */

import { textWidth } from "./source";

/** A word plus the exact whitespace that preceded it. */
interface Piece {
  sep: string;
  word: string;
}

/**
 * Words that would start a new block if they landed at the beginning of a line.
 * Matched against a whole word, so `*emphasis*` and `-hyphen` are not caught —
 * only the real block openers are.
 */
const BLOCK_OPENER =
  /^(?:#{1,6}$|[-*+]$|\d{1,9}[.)]$|>|`{3,}|~{3,}|-{3,}$|_{3,}$|\*{3,}$|={3,}$|\|)/;

/** Marks the character ranges a line break must not fall inside. */
function protectedMask(text: string): Uint8Array {
  const mask = new Uint8Array(text.length);
  const protect = (start: number, end: number) => {
    for (let i = start; i < end && i < mask.length; i++) mask[i] = 1;
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === "\\" && i + 1 < text.length) {
      protect(i, i + 2);
      i += 2;
      continue;
    }

    if (ch === "`") {
      let run = 0;
      while (text[i + run] === "`") run++;
      const close = text.indexOf("`".repeat(run), i + run);
      if (close !== -1) {
        protect(i, close + run);
        i = close + run;
        continue;
      }
      i += run;
      continue;
    }

    if (ch === "[") {
      const end = linkEnd(text, i);
      if (end !== -1) {
        protect(i, end);
        i = end;
        continue;
      }
    }

    i++;
  }

  return mask;
}

/** End index (exclusive) of a `[label](destination)` starting at `start`, or -1. */
function linkEnd(text: string, start: number): number {
  let depth = 0;
  let i = start;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0 || text[i + 1] !== "(") return -1;

  let parens = 0;
  for (let j = i + 1; j < text.length; j++) {
    const ch = text[j];
    if (ch === "\\") {
      j++;
      continue;
    }
    if (ch === "(") parens++;
    else if (ch === ")") {
      parens--;
      if (parens === 0) return j + 1;
    }
  }
  return -1;
}

function splitPieces(text: string): Piece[] {
  const mask = protectedMask(text);
  const pieces: Piece[] = [];
  let sep = "";
  let word = "";

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ((ch === " " || ch === "\t") && mask[i] === 0) {
      if (word) {
        pieces.push({ sep, word });
        sep = "";
        word = "";
      }
      sep += ch;
    } else {
      word += ch;
    }
  }
  if (word) pieces.push({ sep, word });
  return pieces;
}

function wrapSegment(
  segment: string,
  width: number,
  firstPrefix: string,
  contPrefix: string,
): string {
  const trailing = /[ \t]+$/.exec(segment)?.[0] ?? "";
  const body = trailing ? segment.slice(0, segment.length - trailing.length) : segment;

  const pieces = splitPieces(body);
  if (pieces.length === 0) return firstPrefix + body + trailing;

  const lines: string[] = [];
  let current = firstPrefix + pieces[0].sep + pieces[0].word;

  for (let i = 1; i < pieces.length; i++) {
    const { sep, word } = pieces[i];
    const candidate = current + sep + word;
    const overflows = width > 0 && textWidth(candidate) > width;
    // Never break before a word that would open a block on the next line, and
    // never emit a line that holds nothing but its own prefix.
    if (overflows && !BLOCK_OPENER.test(word) && current.trim() !== "") {
      lines.push(current);
      current = contPrefix + word;
    } else {
      current = candidate;
    }
  }

  lines.push(current + trailing);
  return lines.join("\n");
}

/**
 * Wrap already-serialized inline markdown to `width` columns.
 *
 * `firstPrefix` is prepended to the first line and `contPrefix` to every
 * continuation line; both count towards the width. Hard breaks (a line ending
 * in two spaces) are preserved and start a fresh wrapping run. A width of 0 or
 * less disables wrapping entirely, which is what canonical-form callers want.
 */
export function wrapMarkdown(
  text: string,
  width: number,
  firstPrefix = "",
  contPrefix = "",
): string {
  if (!text) return firstPrefix;
  if (width <= 0) {
    return text
      .split("\n")
      .map((line, i) => (i === 0 ? firstPrefix : contPrefix) + line)
      .join("\n");
  }
  return text
    .split("\n")
    .map((segment, i) =>
      wrapSegment(segment, width, i === 0 ? firstPrefix : contPrefix, contPrefix),
    )
    .join("\n");
}
