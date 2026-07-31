/**
 * markdown/parse.ts
 *
 * Converts a Markdown string to a Tiptap JSONContent tree using marked.lexer()
 * as the tokenizer — no DOM dependency, works in Node and the browser.
 *
 * The resulting JSON is fully compatible with editor.commands.setContent().
 */

import { marked } from "marked";
import type { Token as MarkedToken, Tokens } from "marked";
import type { JSONContent } from "@tiptap/react";

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

/**
 * Parse a Markdown string into a Tiptap JSONContent document tree.
 * DOM-free: uses marked.lexer() only, no HTML intermediate.
 */
export function markdownToJSON(markdown: string): JSONContent {
  const tokens = marked.lexer(markdown, { gfm: true, breaks: false });
  const content: JSONContent[] = [];

  for (const token of tokens as AnyToken[]) {
    content.push(...parseBlock(token));
  }

  if (content.length === 0) {
    content.push({ type: "paragraph", content: [] });
  }

  return { type: "doc", content };
}
