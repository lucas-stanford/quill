/**
 * markdown/parse.ts
 *
 * Converts a Markdown string to a Tiptap JSONContent tree using marked.lexer()
 * as the tokenizer — no DOM dependency, works in Node and the browser.
 *
 * The resulting JSON is fully compatible with editor.commands.setContent().
 *
 * Parsing also records the exact source text of every top-level block and every
 * list item into a `SourceMap`. Soft wraps carry no meaning, so the tree alone
 * can never reproduce them; keeping the source is the only way a save can leave
 * untouched blocks byte-identical. See `source.ts` for how entries are keyed.
 *
 * ── Nothing is dropped ──────────────────────────────────────────────────────
 *
 * A token this parser has no node for used to produce no node at all. That is
 * not a rendering gap, it is data loss: the construct leaves the document, and
 * the autosave a second later writes the document back over the user's file
 * without it. GFM tables were the loud case — a whole table, gone from disk on
 * the first keystroke anywhere in the plan.
 *
 * So every token now produces something. Tables become table nodes. Anything
 * still unmodelled — an HTML block, a link reference definition, an inline tag,
 * an image — becomes its own literal source text, which both keeps it visible
 * and registers it in the source map, so an untouched one is re-emitted
 * byte-for-byte and an edited one degrades to text rather than vanishing.
 */

import { marked } from "marked";
import type { Token as MarkedToken, Tokens } from "marked";
import type { JSONContent } from "@tiptap/react";
import { SourceMap, detectWrapWidth } from "./source";
import { canonicalKey, canonicalItemKey } from "./serialize";
import { normalizeAlign } from "./table";

// ─── Types ─────────────────────────────────────────────────────────────────

type MarkSpec = { type: string; attrs?: Record<string, unknown> };
type AnyToken = MarkedToken;

// ─── Inline (leaf) parser ───────────────────────────────────────────────────

/**
 * Inline HTML tags this parser understands as marks.
 *
 * Deliberately only the tag the *serializer* emits. Every other tag is carried
 * through as literal text, which keeps its bytes exactly; turning `<b>x</b>`
 * into a bold mark would silently rewrite it as `**x**` the next time that
 * paragraph was rebuilt.
 */
const HTML_MARK_TAGS: Record<string, string> = { "<u>": "underline" };
const HTML_MARK_CLOSERS: Record<string, string> = { "</u>": "underline" };

function parseInline(
  tokens: AnyToken[],
  inheritedMarks: MarkSpec[] = [],
): JSONContent[] {
  const result: JSONContent[] = [];
  // Marks opened by an inline HTML tag, which applies to the siblings that
  // follow it rather than to a subtree of its own.
  const open: MarkSpec[] = [];
  const marksHere = (): MarkSpec[] =>
    open.length > 0 ? [...inheritedMarks, ...open] : inheritedMarks;

  const closers = new Set(
    tokens
      .filter((t) => t.type === "html")
      .map((t) => (t as Tokens.Tag).raw.trim().toLowerCase()),
  );

  for (const token of tokens) {
    switch (token.type) {
      case "text": {
        const tok = token as Tokens.Text;
        if (tok.tokens && tok.tokens.length > 0) {
          result.push(...parseInline(tok.tokens as AnyToken[], marksHere()));
        } else {
          const text = tok.text.replace(/\n/g, " ");
          if (text) result.push(withMarks({ type: "text", text }, marksHere()));
        }
        break;
      }
      case "escape": {
        const tok = token as Tokens.Escape;
        if (tok.text) {
          result.push(withMarks({ type: "text", text: tok.text }, marksHere()));
        }
        break;
      }
      case "strong": {
        const tok = token as Tokens.Strong;
        result.push(
          ...parseInline(tok.tokens as AnyToken[], [
            ...marksHere(),
            { type: "bold" },
          ]),
        );
        break;
      }
      case "em": {
        const tok = token as Tokens.Em;
        result.push(
          ...parseInline(tok.tokens as AnyToken[], [
            ...marksHere(),
            { type: "italic" },
          ]),
        );
        break;
      }
      case "del": {
        const tok = token as Tokens.Del;
        result.push(
          ...parseInline(tok.tokens as AnyToken[], [
            ...marksHere(),
            { type: "strike" },
          ]),
        );
        break;
      }
      case "codespan": {
        const tok = token as Tokens.Codespan;
        if (tok.text) {
          result.push({
            type: "text",
            text: tok.text,
            marks: [...marksHere(), { type: "code" }],
          });
        }
        break;
      }
      case "link": {
        const tok = token as Tokens.Link;
        const linkMark: MarkSpec = {
          type: "link",
          attrs: { href: tok.href, title: tok.title ?? null },
        };
        result.push(
          ...parseInline(tok.tokens as AnyToken[], [...marksHere(), linkMark]),
        );
        break;
      }
      case "br": {
        result.push({ type: "hardBreak" });
        break;
      }
      case "image": {
        // No image node exists in this schema, and a construct we cannot model
        // must never simply disappear — that is how a plan loses content on the
        // next autosave. An image is spelled as its own markdown instead: a "!"
        // followed by link-marked text is exactly `![alt](src)`, so it survives
        // a rebuild byte-for-byte and stays visible and clickable meanwhile.
        const tok = token as Tokens.Image;
        const alt = tok.text ?? "";
        if (alt) {
          result.push(withMarks({ type: "text", text: "!" }, marksHere()));
          result.push(
            withMarks({ type: "text", text: alt }, [
              ...marksHere(),
              {
                type: "link",
                attrs: { href: tok.href, title: tok.title ?? null },
              },
            ]),
          );
        } else if (tok.raw) {
          // An empty alt leaves no text to carry the link mark, so the raw
          // markdown is kept as literal text: visible, and never lost.
          result.push(withMarks({ type: "text", text: tok.raw }, marksHere()));
        }
        break;
      }
      case "html": {
        const raw = (token as Tokens.Tag).raw ?? "";
        const tag = raw.trim().toLowerCase();

        // `<u>` is the one tag we also emit, so it is read back as the mark it
        // came from — otherwise pressing the underline key would survive a save
        // and then be lost on the next load. Only when its closer is actually
        // present; an unbalanced tag stays literal text.
        const opens = HTML_MARK_TAGS[tag];
        if (opens && closers.has(`</${tag.slice(1)}`)) {
          open.push({ type: opens });
          break;
        }
        const closes = HTML_MARK_CLOSERS[tag];
        if (closes && open.length > 0 && open[open.length - 1].type === closes) {
          open.pop();
          break;
        }

        // Any other inline HTML the schema has no mark for. Kept as literal
        // text so the tags round-trip untouched instead of being stripped.
        if (raw) result.push(withMarks({ type: "text", text: raw }, marksHere()));
        break;
      }
    }
  }

  return result;
}

function withMarks(node: JSONContent, marks: MarkSpec[]): JSONContent {
  return marks.length > 0 ? { ...node, marks } : node;
}

// ─── Block parser ───────────────────────────────────────────────────────────

function parseBlock(token: AnyToken): JSONContent[] {
  switch (token.type) {
    case "heading": {
      const tok = token as Tokens.Heading;
      return [
        {
          type: "heading",
          attrs: { level: tok.depth },
          content: parseInline(tok.tokens as AnyToken[]),
        },
      ];
    }
    case "paragraph": {
      const tok = token as Tokens.Paragraph;
      return [
        {
          type: "paragraph",
          content: parseInline(tok.tokens as AnyToken[]),
        },
      ];
    }
    case "code": {
      const tok = token as Tokens.Code;
      const lang = tok.lang || null;
      const text = tok.text;
      return [
        {
          type: "codeBlock",
          attrs: { language: lang },
          content: text ? [{ type: "text", text }] : [],
        },
      ];
    }
    case "blockquote": {
      const tok = token as Tokens.Blockquote;
      const innerContent: JSONContent[] = [];
      for (const t of (tok.tokens ?? []) as AnyToken[]) {
        innerContent.push(...parseBlock(t));
      }
      return [{ type: "blockquote", content: innerContent }];
    }
    case "hr": {
      return [{ type: "horizontalRule" }];
    }
    case "list": {
      const tok = token as Tokens.List;
      const isOrdered = tok.ordered;
      const start = typeof tok.start === "number" ? tok.start : 1;
      const items: JSONContent[] = tok.items.map((item) => parseListItem(item));
      return [
        {
          type: isOrdered ? "orderedList" : "bulletList",
          attrs: isOrdered ? { start } : {},
          content: items,
        },
      ];
    }
    case "table": {
      const tok = token as Tokens.Table;
      // GFM states alignment once, in the delimiter row. It is copied onto
      // every cell of the column because that is where the node schema keeps
      // it; the serializer folds it back to one marker per column.
      const aligns = (tok.align ?? []).map(normalizeAlign);
      const rows: JSONContent[] = [];

      const header = (tok.header ?? []).map((cell, i) =>
        parseTableCell("tableHeader", cell, aligns[i] ?? null),
      );
      if (header.length === 0) return preservedBlock(token);
      rows.push({ type: "tableRow", content: header });

      for (const row of tok.rows ?? []) {
        rows.push({
          type: "tableRow",
          content: row.map((cell, i) =>
            parseTableCell("tableCell", cell, aligns[i] ?? null),
          ),
        });
      }

      return [{ type: "table", content: rows }];
    }
    case "space":
      return [];
    case "text": {
      const tok = token as Tokens.Text;
      const inlineToks = (tok.tokens ?? []) as AnyToken[];
      if (inlineToks.length > 0) {
        return [{ type: "paragraph", content: parseInline(inlineToks) }];
      }
      return preservedBlock(token);
    }
    default:
      // Anything this schema cannot model — an HTML block, a link reference
      // definition, a construct a future `marked` invents. Dropping it is the
      // bug this lane exists to kill: the block would vanish from the document
      // and the next autosave would erase it from the user's file. Kept as its
      // own literal source instead, which also registers it in the source map
      // so an untouched one is re-emitted byte-for-byte.
      return preservedBlock(token);
  }
}

function parseTableCell(
  type: "tableCell" | "tableHeader",
  cell: Tokens.TableCell,
  align: ReturnType<typeof normalizeAlign>,
): JSONContent {
  const resolved = align ?? normalizeAlign(cell.align);
  const node: JSONContent = {
    type,
    content: [
      { type: "paragraph", content: parseInline((cell.tokens ?? []) as AnyToken[]) },
    ],
  };
  if (resolved) node.attrs = { align: resolved };
  return node;
}

/**
 * A block we have no node for, carried through as its own source text.
 *
 * Lines become hard breaks so the block keeps its shape on screen and, more
 * importantly, so a rebuild cannot silently glue them into one line.
 */
function preservedBlock(token: AnyToken): JSONContent[] {
  const raw = (token.raw ?? "").replace(/\n+$/, "");
  if (!raw.trim()) return [];

  const content: JSONContent[] = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) content.push({ type: "hardBreak" });
    if (lines[i]) content.push({ type: "text", text: lines[i] });
  }
  return [{ type: "paragraph", content }];
}

function parseListItem(item: Tokens.ListItem): JSONContent {
  const content: JSONContent[] = [];
  const tokens = (item.tokens ?? []) as AnyToken[];

  for (const token of tokens) {
    switch (token.type) {
      case "text": {
        const tok = token as Tokens.Text;
        const inlineToks = (tok.tokens ?? []) as AnyToken[];
        if (inlineToks.length > 0) {
          content.push({ type: "paragraph", content: parseInline(inlineToks) });
        } else {
          const text = tok.text.replace(/\n/g, " ");
          if (text) {
            content.push({
              type: "paragraph",
              content: [{ type: "text", text }],
            });
          }
        }
        break;
      }
      case "paragraph": {
        const tok = token as Tokens.Paragraph;
        content.push({
          type: "paragraph",
          content: parseInline(tok.tokens as AnyToken[]),
        });
        break;
      }
      default: {
        // Lists, quotes, code, rules, tables — and anything unrecognised, which
        // `parseBlock` preserves rather than drops.
        content.push(...parseBlock(token));
        break;
      }
    }
  }

  if (content.length === 0 || content[0].type !== "paragraph") {
    content.unshift({ type: "paragraph", content: [] });
  }

  return { type: "listItem", content };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** A parsed plan: the editor document plus the formatting it came from. */
export interface ParsedPlan {
  /** Tiptap JSONContent tree, ready for `setContent()`. */
  doc: JSONContent;
  /** Original source text of each block, for drift-free serialisation. */
  source: SourceMap;
}

/**
 * Parse a Markdown string into a Tiptap document *and* its formatting memory.
 *
 * `marked` hands back a `raw` string per token that is the exact slice of the
 * input it was produced from — concatenating every token's `raw` reproduces the
 * file byte for byte. We split each block's `raw` into the block itself and the
 * blank lines that followed it, so a verbatim replay restores both the block
 * and its spacing.
 */
export function parseMarkdown(markdown: string): ParsedPlan {
  const tokens = marked.lexer(markdown, {
    gfm: true,
    breaks: false,
  }) as AnyToken[];

  const content: JSONContent[] = [];
  const source = new SourceMap({
    wrapWidth: detectWrapWidth(collectWrapSamples(tokens)),
    ...detectListStyle(tokens),
  });

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === "space") continue;

    const nodes = parseBlock(token);
    if (nodes.length === 0) continue;

    // A block's own trailing newlines plus any following blank-line tokens are
    // the separator; `raw + sep` is exactly the source span it occupied.
    const rawFull = token.raw;
    const raw = rawFull.replace(/\n+$/, "");
    let sep = rawFull.slice(raw.length);
    for (let j = i + 1; j < tokens.length && tokens[j].type === "space"; j++) {
      sep += tokens[j].raw;
    }

    // Only register when the token produced exactly one node, so the stored
    // source is unambiguously the source of that node.
    if (nodes.length === 1) {
      source.addBlock(canonicalKey(nodes[0]), { raw, sep });
      if (token.type === "list") {
        registerListItems(source, token as Tokens.List, nodes[0]);
      }
    }

    content.push(...nodes);
  }

  if (content.length === 0) {
    content.push({ type: "paragraph", content: [] });
  }

  return { doc: { type: "doc", content }, source };
}

/**
 * Parse a Markdown string into a Tiptap JSONContent document tree.
 * DOM-free: uses marked.lexer() only, no HTML intermediate.
 */
export function markdownToJSON(markdown: string): JSONContent {
  return parseMarkdown(markdown).doc;
}

// ─── Source registration ────────────────────────────────────────────────────

/** Record each list item's source, and recurse into nested lists. */
function registerListItems(
  source: SourceMap,
  token: Tokens.List,
  node: JSONContent,
): void {
  const items = node.content ?? [];
  // Positional pairing is only trusted here, at the instant of parsing, where
  // item i of the token provably produced item i of the node.
  if (items.length !== token.items.length) return;

  for (let i = 0; i < items.length; i++) {
    const rawFull = token.items[i].raw;
    const raw = rawFull.replace(/\n+$/, "");
    source.addItem(canonicalItemKey(items[i]), {
      raw,
      sep: rawFull.slice(raw.length),
    });
    registerNestedLists(source, token.items[i], items[i]);
  }
}

function registerNestedLists(
  source: SourceMap,
  itemToken: Tokens.ListItem,
  itemNode: JSONContent,
): void {
  const listTokens = ((itemToken.tokens ?? []) as AnyToken[]).filter(
    (t) => t.type === "list",
  ) as Tokens.List[];
  const listNodes = (itemNode.content ?? []).filter(
    (n) => n.type === "bulletList" || n.type === "orderedList",
  );
  if (listTokens.length !== listNodes.length) return;
  for (let i = 0; i < listTokens.length; i++) {
    registerListItems(source, listTokens[i], listNodes[i]);
  }
}

/**
 * Multi-line prose blocks, which are the only evidence of the author's wrap
 * width. Code fences, headings and tables are excluded — their line lengths say
 * nothing about how prose was wrapped.
 */
function collectWrapSamples(tokens: AnyToken[]): string[] {
  const samples: string[] = [];
  for (const token of tokens) {
    if (token.type === "paragraph") {
      samples.push(token.raw);
    } else if (token.type === "list") {
      for (const item of (token as Tokens.List).items) samples.push(item.raw);
    } else if (token.type === "blockquote") {
      samples.push(
        token.raw
          .split("\n")
          .map((l) => l.replace(/^\s*>\s?/, ""))
          .join("\n"),
      );
    }
  }
  return samples;
}

// ─── List style ─────────────────────────────────────────────────────────────

/**
 * How the author writes lists, so a rebuilt one does not announce itself.
 *
 * A serializer has to pick *some* bullet and *some* nesting width. Picking a
 * fixed one means that the first edit anywhere in a list written the other way
 * rewrites every line of it — an untouched-content diff, which is the drift
 * invariant 2 exists to prevent. So the file's own habit is measured instead,
 * the same way the wrap width already is.
 */
function detectListStyle(tokens: AnyToken[]): {
  bullet: string;
  nestIndent: number;
} {
  const bullets = new Map<string, number>();
  const nests = new Map<number, number>();

  const visit = (list: Tokens.List): void => {
    for (const item of list.items) {
      const marker = markerOf(item.raw);
      if (!list.ordered && marker) {
        bullets.set(marker.char, (bullets.get(marker.char) ?? 0) + 1);
      }
      for (const child of (item.tokens ?? []) as AnyToken[]) {
        if (child.type !== "list") continue;
        const inner = child as Tokens.List;
        const first = inner.items[0];
        if (first && marker) {
          // marked dedents a nested item by the parent's marker width, so what
          // is left in front of it is the extra the author typed.
          const width = marker.width + leadingSpaces(first.raw);
          nests.set(width, (nests.get(width) ?? 0) + 1);
        }
        visit(inner);
      }
    }
  };

  for (const token of tokens) if (token.type === "list") visit(token as Tokens.List);

  return {
    bullet: mostCommon(bullets) ?? "-",
    nestIndent: mostCommon(nests) ?? 2,
  };
}

function markerOf(raw: string): { char: string; width: number } | null {
  const match = /^ *(?:([-*+])|\d{1,9}[.)]) +/.exec(raw);
  if (!match) return null;
  const bare = match[0].trimStart();
  return { char: match[1] ?? "", width: bare.length };
}

function leadingSpaces(text: string): number {
  return (/^ */.exec(text)?.[0] ?? "").length;
}

function mostCommon<T>(counts: Map<T, number>): T | undefined {
  let best: T | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

// ─── Alignment with the live editor ─────────────────────────────────────────

/**
 * Teach the source map ProseMirror's own spelling of each block.
 *
 * Loading a document through the schema can normalise it: default attributes
 * appear, adjacent text nodes merge. If any of that shifted a block's canonical
 * form, the entry recorded at parse time would never be found again and the
 * block would silently start reflowing. So immediately after `setContent` we
 * pair the tree we parsed with the tree the editor actually holds — a pairing
 * that is trustworthy at exactly this moment, because one was just built from
 * the other — and register the live key as an alias.
 *
 * Purely additive and content-preserving: an alias points at source that
 * round-trips to the same block, so a hit on either key is equally safe. If the
 * two trees do not line up one-for-one we do nothing at all and let the
 * parse-time keys stand.
 */
export function alignSource(plan: ParsedPlan, editorDoc: JSONContent): void {
  const parsed = meaningfulBlocks(plan.doc);
  const live = meaningfulBlocks(editorDoc);
  if (parsed.length === 0 || parsed.length !== live.length) return;

  for (let i = 0; i < parsed.length; i++) {
    plan.source.aliasBlock(canonicalKey(parsed[i]), canonicalKey(live[i]));
    alignListItems(plan.source, parsed[i], live[i]);
  }
}

function meaningfulBlocks(doc: JSONContent): JSONContent[] {
  return (doc.content ?? []).filter((node) => canonicalKey(node).trim() !== "");
}

function alignListItems(
  source: SourceMap,
  parsed: JSONContent,
  live: JSONContent,
): void {
  if (parsed.type !== live.type) return;
  if (parsed.type !== "bulletList" && parsed.type !== "orderedList") return;

  const parsedItems = parsed.content ?? [];
  const liveItems = live.content ?? [];
  if (parsedItems.length !== liveItems.length) return;

  for (let i = 0; i < parsedItems.length; i++) {
    source.aliasItem(
      canonicalItemKey(parsedItems[i]),
      canonicalItemKey(liveItems[i]),
    );
    const parsedNested = (parsedItems[i].content ?? []).filter(isList);
    const liveNested = (liveItems[i].content ?? []).filter(isList);
    if (parsedNested.length !== liveNested.length) continue;
    for (let j = 0; j < parsedNested.length; j++) {
      alignListItems(source, parsedNested[j], liveNested[j]);
    }
  }
}

function isList(node: JSONContent): boolean {
  return node.type === "bulletList" || node.type === "orderedList";
}
