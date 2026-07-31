/**
 * markdown/serialize.ts
 *
 * Serializes a Tiptap JSONContent document tree back to Markdown.
 * DOM-free: walks the JSONContent tree, no ProseMirror Node objects required.
 *
 * ── Formatting is preserved, not reinvented ─────────────────────────────────
 *
 * Markdown soft wraps are semantically invisible, so a tree walk alone cannot
 * put them back and every save would reflow the entire file. When a `SourceMap`
 * from `parseMarkdown()` is supplied, each block is first looked up by its
 * canonical form; an untouched block is emitted as the exact bytes it was
 * parsed from. Only blocks the user actually changed are rebuilt, and those are
 * re-wrapped to the document's prevailing width so their diff stays local.
 *
 * Falling back to a rebuild is always safe. Emitting the wrong stored source is
 * not, so every lookup is an exact match on canonical content or nothing.
 *
 * Normalisations applied to rebuilt blocks only:
 *   - Prose is soft-wrapped to the detected width (never inside code spans,
 *     links or escapes, and never so that a line opens a new block).
 *   - Bullet markers always use "-" regardless of the original "*" / "+".
 *   - Headings always use ATX style ("## Heading"), never setext.
 *   - Ordered-list indices use the node's `start` attribute.
 *   - Code-block content strips one trailing "\n" if present (marked adds one).
 *   - Tables are re-emitted column-aligned, with one alignment marker per
 *     column and every cell pipe escaped. An untouched table never reaches
 *     this path, so hand-aligned tables keep their own spacing.
 *   - The document ends with exactly one trailing newline.
 */

import type { JSONContent } from "@tiptap/react";
import type { SourceEntry, SourceMap, SourceSession } from "./source";
import type { ColumnAlign } from "./table";
import { escapeCellText, normalizeAlign, renderGfmTable } from "./table";
import { wrapMarkdown } from "./wrap";

// ─── Types ─────────────────────────────────────────────────────────────────

type MarkJSON = { type: string; attrs?: Record<string, unknown> };

interface SerializeContext {
  /** Column to wrap prose at; 0 disables wrapping (canonical form). */
  wrap: number;
  /** Verbatim source lookup for this pass, when one is available. */
  session?: SourceSession;
}

/** Context used to compute canonical keys: no wrapping, no source reuse. */
const CANONICAL: SerializeContext = { wrap: 0 };

export interface SerializeOptions {
  /** Formatting memory from `parseMarkdown()`; enables verbatim output. */
  source?: SourceMap | null;
}

// ─── Escaping ───────────────────────────────────────────────────────────────

// Characters that are markdown-significant in plain inline text.
// We only escape the minimal set to avoid visual noise in the output.
const ESCAPE_REGEX = /([\\`*_[\]~])/g;

function escapeText(text: string): string {
  return text.replace(ESCAPE_REGEX, "\\$1");
}

// ─── Inline serialisation ───────────────────────────────────────────────────

function markSignature(marks: MarkJSON[]): string {
  if (marks.length === 0) return "";
  return JSON.stringify(
    [...marks]
      .sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))
      .map((m) => [m.type, m.attrs ?? null]),
  );
}

/**
 * Serialise inline content.
 *
 * Adjacent text nodes carrying identical marks are joined before the markup is
 * applied. ProseMirror merges such nodes itself, so grouping keeps our output
 * identical whether the tree came from our parser or from `getJSON()` — which
 * is what makes canonical keys stable across a load. It also stops us emitting
 * `**a****b**` for a run the parser happened to split in two.
 */
export function serializeInline(nodes: JSONContent[] | undefined): string {
  if (!nodes?.length) return "";

  let out = "";
  let runText = "";
  let runMarks: MarkJSON[] | null = null;
  let runSignature = "";

  const flush = () => {
    if (runMarks !== null && runText !== "") out += applyMarks(runText, runMarks);
    runText = "";
    runMarks = null;
    runSignature = "";
  };

  for (const node of nodes) {
    if (node.type === "hardBreak") {
      flush();
      out += "  \n";
      continue;
    }
    if (node.type !== "text") continue;

    const marks: MarkJSON[] = node.marks ?? [];
    const signature = markSignature(marks);
    if (runMarks !== null && signature === runSignature) {
      runText += node.text ?? "";
    } else {
      flush();
      runMarks = marks;
      runSignature = signature;
      runText = node.text ?? "";
    }
  }
  flush();

  return out;
}

function applyMarks(text: string, marks: MarkJSON[]): string {
  const hasCode = marks.some((m) => m.type === "code");

  if (hasCode) {
    // Inline code: no escaping; choose a delimiter that doesn't appear in text
    const delim = text.includes("`") ? "``" : "`";
    const needsPad = text.startsWith("`") || text.endsWith("`");
    const pad = needsPad ? " " : "";
    return `${delim}${pad}${text}${pad}${delim}`;
  }

  // Emphasis delimiters have to hug their text: `** bold **` is not emphasis at
  // all, so any surrounding whitespace is pushed outside the markers.
  const leading = /^\s*/.exec(text)?.[0] ?? "";
  const trailing = /\s*$/.exec(text)?.[0] ?? "";
  const core = text.slice(leading.length, text.length - trailing.length);
  if (core === "") return text;

  let result = escapeText(core);

  const hasBold = marks.some((m) => m.type === "bold");
  const hasItalic = marks.some((m) => m.type === "italic");
  const hasStrike = marks.some((m) => m.type === "strike");
  const hasUnderline = marks.some((m) => m.type === "underline");
  const linkMark = marks.find((m) => m.type === "link");

  if (hasStrike) result = `~~${result}~~`;

  if (hasBold && hasItalic) {
    result = `***${result}***`;
  } else if (hasBold) {
    result = `**${result}**`;
  } else if (hasItalic) {
    result = `*${result}*`;
  }

  if (hasUnderline) result = `<u>${result}</u>`;

  if (linkMark) {
    const href = (linkMark.attrs?.href as string) ?? "";
    const title = linkMark.attrs?.title
      ? ` "${linkMark.attrs.title as string}"`
      : "";
    result = `[${result}](${href}${title})`;
  }

  return `${leading}${result}${trailing}`;
}

// ─── Canonical keys ─────────────────────────────────────────────────────────

/**
 * The canonical (normalised, unwrapped) markdown for a top-level block.
 *
 * This doubles as the `SourceMap` key. Because it describes the block's meaning
 * rather than its JSON shape, it comes out identical whether computed from our
 * parser's output or from ProseMirror's `getJSON()`, and two blocks share a key
 * only when they are semantically the same block.
 */
export function canonicalKey(node: JSONContent): string {
  return serializeNode(node, "", CANONICAL);
}

/** Canonical form of a list item, deliberately excluding its bullet marker. */
export function canonicalItemKey(item: JSONContent): string {
  return (item.content ?? [])
    .map((child) => serializeNode(child, "", CANONICAL))
    .join("");
}

// ─── Block serialisation ────────────────────────────────────────────────────

/**
 * Serialise a single block node in canonical form.
 * `depth` is non-zero only inside list items (controls bullet indentation).
 */
export function serializeBlock(node: JSONContent, depth = 0): string {
  return serializeNode(node, "  ".repeat(depth), CANONICAL);
}

/** `indent` is the literal whitespace every line of this block sits behind. */
function serializeNode(
  node: JSONContent,
  indent: string,
  ctx: SerializeContext,
): string {
  const children = node.content ?? [];
  const width = ctx.wrap;

  switch (node.type) {
    case "heading": {
      const level = Math.min((node.attrs?.level as number) ?? 1, 6);
      const hashes = "#".repeat(level);
      // Headings stay on one line — a wrapped heading would turn its own tail
      // into a separate paragraph.
      return `${indent}${hashes} ${serializeInline(children)}\n\n`;
    }

    case "paragraph": {
      const text = serializeInline(children);
      if (!text) return "";
      return `${wrapMarkdown(text, width, indent, indent)}\n\n`;
    }

    case "codeBlock": {
      const lang = (node.attrs?.language as string | null | undefined) ?? "";
      const raw = children.map((n) => n.text ?? "").join("");
      // marked always appends \n when serialising to HTML; strip one trailing \n
      // so the round-trip is stable (our fenced block already supplies the \n
      // before the closing fence). The body is emitted untouched: no wrapping,
      // no escaping — every space in an ASCII diagram is load-bearing.
      const code = raw.replace(/\n$/, "");
      const body = indent ? indentLines(code, indent) : code;
      return `${indent}\`\`\`${lang}\n${body}\n${indent}\`\`\`\n\n`;
    }

    case "blockquote": {
      const quoteWidth = width > 2 ? width - indent.length - 2 : width;
      const inner = children
        .map((n) => serializeNode(n, "", { ...ctx, wrap: quoteWidth }))
        .join("");
      const prefixed = inner
        .trimEnd()
        .split("\n")
        .map((l) => (l ? `${indent}> ${l}` : `${indent}>`))
        .join("\n");
      return `${prefixed}\n\n`;
    }

    case "horizontalRule":
      return `${indent}---\n\n`;

    case "table": {
      const body = renderGfmTable(tableRows(node), tableAligns(node));
      if (!body) return "";
      return `${indent ? indentLines(body, indent) : body}\n\n`;
    }

    case "bulletList": {
      const items = children
        .map((item) => serializeListItem(item, "-", indent, ctx))
        .join("");
      // Top-level list: add a blank line after; nested: no extra newline
      return indent === "" ? `${items}\n` : items;
    }

    case "orderedList": {
      const start = (node.attrs?.start as number) ?? 1;
      const items = children
        .map((item, i) => serializeListItem(item, `${start + i}.`, indent, ctx))
        .join("");
      return indent === "" ? `${items}\n` : items;
    }

    default:
      return "";
  }
}

function indentLines(text: string, indent: string): string {
  return text
    .split("\n")
    .map((l) => (l ? indent + l : l))
    .join("\n");
}

// ─── Tables ─────────────────────────────────────────────────────────────────

/**
 * Cell text for one row, with merged cells expanded back into columns.
 *
 * GFM cannot express a colspan, so a merged cell is emitted in its first column
 * followed by empty ones. That loses the merge and keeps the text — the right
 * way round, since a table the user never merged is unaffected and a merged one
 * degrades instead of dropping its content.
 */
function tableRowCells(row: JSONContent): string[] {
  const cells: string[] = [];
  for (const cell of row.content ?? []) {
    cells.push(tableCellText(cell));
    for (let i = 1; i < cellSpan(cell); i++) cells.push("");
  }
  return cells;
}

function cellSpan(cell: JSONContent): number {
  const span = Number(cell.attrs?.colspan ?? 1);
  return Number.isFinite(span) && span > 1 ? Math.floor(span) : 1;
}

/**
 * A cell's blocks flattened to one line of inline markdown.
 *
 * Cell content is always canonical: never wrapped, because a newline would end
 * the row, and never re-indented, because a cell has no column of its own.
 */
function tableCellText(cell: JSONContent): string {
  const parts: string[] = [];
  for (const child of cell.content ?? []) {
    const text =
      child.type === "paragraph"
        ? serializeInline(child.content)
        : serializeNode(child, "", CANONICAL).trim();
    if (text) parts.push(text);
  }
  return escapeCellText(parts.join(" "));
}

/**
 * One alignment per column, headers first.
 *
 * The schema stores alignment per cell, GFM stores it once per column, so the
 * first cell that states an alignment wins. Rows are visited in document order
 * and the header row is first, which makes the header the authority whenever it
 * has an opinion — matching what the delimiter row meant on the way in.
 */
function tableAligns(node: JSONContent): ColumnAlign[] {
  const aligns: ColumnAlign[] = [];
  for (const row of node.content ?? []) {
    let column = 0;
    for (const cell of row.content ?? []) {
      const align = normalizeAlign(cell.attrs?.align);
      const span = cellSpan(cell);
      for (let i = 0; i < span; i++, column++) {
        if (align && !aligns[column]) aligns[column] = align;
      }
    }
  }
  return aligns;
}

function tableRows(node: JSONContent): string[][] {
  return (node.content ?? [])
    .filter((row) => row.type === "tableRow")
    .map(tableRowCells);
}

function serializeListItem(
  item: JSONContent,
  marker: string,
  indent: string,
  ctx: SerializeContext,
): string {
  const bullet = `${marker} `;
  // Continuation lines align with the item's text. That alignment is what makes
  // nested content belong to this item instead of interrupting the list, so it
  // follows the marker width rather than a fixed two spaces.
  const contIndent = indent + " ".repeat(bullet.length);

  const verbatim = reuseListItem(item, bullet, indent, ctx);
  if (verbatim !== null) return verbatim;

  const children = item.content ?? [];
  let result = "";
  let firstParagraph = true;

  for (const child of children) {
    if (child.type === "paragraph") {
      const text = serializeInline(child.content);
      if (firstParagraph) {
        result += `${wrapMarkdown(text, ctx.wrap, indent + bullet, contIndent)}\n`;
        firstParagraph = false;
      } else {
        // Continuation paragraph inside the same list item
        result += `\n${wrapMarkdown(text, ctx.wrap, contIndent, contIndent)}\n`;
      }
    } else if (child.type === "bulletList" || child.type === "orderedList") {
      result += serializeNode(child, contIndent, ctx);
    } else {
      const block = serializeNode(child, contIndent, ctx).trimEnd();
      if (block) result += `\n${block}\n`;
    }
  }

  if (firstParagraph) result += `${indent}${marker}\n`;

  return result;
}

/**
 * Emit a list item straight from its original source, or `null` to rebuild it.
 *
 * marked reports nested item source dedented to column 0, so stored text is
 * re-indented to the item's current depth. The bullet is checked against the
 * marker we are about to emit: if the item moved — a different depth, or a
 * different number after a reorder — the stored text no longer describes it and
 * we rebuild instead. Re-emitting a stale ordered-list number would change what
 * the document means, which is the one outcome worth being paranoid about.
 */
function reuseListItem(
  item: JSONContent,
  bullet: string,
  indent: string,
  ctx: SerializeContext,
): string | null {
  if (!ctx.session) return null;
  const entry = ctx.session.takeItem(canonicalItemKey(item));
  if (!entry || !entry.raw.startsWith(bullet)) return null;

  const body = indent ? indentLines(entry.raw, indent) : entry.raw;
  return body + (entry.sep.includes("\n") ? entry.sep : "\n");
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Serialise a Tiptap JSONContent document tree to a Markdown string.
 *
 * Pass the `SourceMap` produced by `parseMarkdown()` to keep every untouched
 * block byte-identical to the file it was loaded from. Without it the output is
 * the canonical form: correct, but reflowed.
 */
export function docToMarkdown(
  doc: JSONContent,
  options: SerializeOptions = {},
): string {
  if (doc.type !== "doc") return "";

  const source = options.source ?? null;
  const session = source ? source.session() : undefined;
  const ctx: SerializeContext = {
    wrap: source ? source.wrapWidth : 0,
    session,
  };

  const parts: string[] = [];
  let previous: SourceEntry | null = null;

  for (const node of doc.content ?? []) {
    const entry = session ? session.takeBlock(canonicalKey(node)) : undefined;
    const block = entry
      ? entry.raw
      : serializeNode(node, "", ctx).replace(/\n+$/, "");
    if (!block.trim()) continue;

    if (parts.length > 0) parts.push(separatorAfter(previous, entry));
    parts.push(block);
    previous = entry ?? null;
  }

  // Separators are assembled explicitly above rather than normalised by regex,
  // so blank lines inside a fenced code block survive untouched.
  return parts.join("").trimEnd() + "\n";
}

/**
 * Whitespace between two emitted blocks.
 *
 * The recorded separator is only replayed when the two blocks are still
 * neighbours in the order they were parsed in. Otherwise it describes a gap
 * that no longer exists — a document's final block records the bare newline at
 * end of file, and replaying that mid-document would let the next block lazily
 * continue the previous paragraph. A blank line is the safe universal answer.
 */
function separatorAfter(
  previous: SourceEntry | null,
  current: SourceEntry | undefined,
): string {
  if (!previous || !current) return "\n\n";
  const contiguous = current.seq === previous.seq + 1;
  return contiguous && previous.sep.includes("\n") ? previous.sep : "\n\n";
}
