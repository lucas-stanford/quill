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
 */

import { marked } from "marked";
import type { Token as MarkedToken, Tokens } from "marked";
import type { JSONContent } from "@tiptap/react";
import { SourceMap, detectWrapWidth } from "./source";
import { canonicalKey, canonicalItemKey } from "./serialize";

// ─── Types ─────────────────────────────────────────────────────────────────

type MarkSpec = { type: string; attrs?: Record<string, unknown> };
type AnyToken = MarkedToken;

// ─── Inline (leaf) parser ───────────────────────────────────────────────────

function parseInline(
  tokens: AnyToken[],
  inheritedMarks: MarkSpec[] = [],
): JSONContent[] {
  const result: JSONContent[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case "text": {
        const tok = token as Tokens.Text;
        if (tok.tokens && tok.tokens.length > 0) {
          result.push(...parseInline(tok.tokens as AnyToken[], inheritedMarks));
        } else {
          const text = tok.text.replace(/\n/g, " ");
          if (text) {
            const node: JSONContent = { type: "text", text };
            if (inheritedMarks.length > 0) node.marks = inheritedMarks;
            result.push(node);
          }
        }
        break;
      }
      case "escape": {
        const tok = token as Tokens.Escape;
        if (tok.text) {
          const node: JSONContent = { type: "text", text: tok.text };
          if (inheritedMarks.length > 0) node.marks = inheritedMarks;
          result.push(node);
        }
        break;
      }
      case "strong": {
        const tok = token as Tokens.Strong;
        result.push(
          ...parseInline(tok.tokens as AnyToken[], [
            ...inheritedMarks,
            { type: "bold" },
          ]),
        );
        break;
      }
      case "em": {
        const tok = token as Tokens.Em;
        result.push(
          ...parseInline(tok.tokens as AnyToken[], [
            ...inheritedMarks,
            { type: "italic" },
          ]),
        );
        break;
      }
      case "del": {
        const tok = token as Tokens.Del;
        result.push(
          ...parseInline(tok.tokens as AnyToken[], [
            ...inheritedMarks,
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
            marks: [...inheritedMarks, { type: "code" }],
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
          ...parseInline(tok.tokens as AnyToken[], [
            ...inheritedMarks,
            linkMark,
          ]),
        );
        break;
      }
      case "br": {
        result.push({ type: "hardBreak" });
        break;
      }
    }
  }

  return result;
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
    case "space":
    default:
      return [];
  }
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
      case "list":
      case "blockquote":
      case "code":
      case "hr": {
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
  const source = new SourceMap(detectWrapWidth(collectWrapSamples(tokens)));

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
