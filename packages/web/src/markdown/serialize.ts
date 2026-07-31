/**
 * markdown/serialize.ts
 *
 * Serializes a Tiptap JSONContent document tree back to Markdown.
 * DOM-free: walks the JSONContent tree, no ProseMirror Node objects required.
 *
 * Normalisations (stable after first pass):
 *   - Soft-wrap newlines inside paragraphs/list-items are removed (one long line).
 *   - Bullet markers always use "-" regardless of the original "*" / "+".
 *   - Headings always use ATX style ("## Heading"), never setext.
 *   - Ordered-list indices use the node's `start` attribute.
 *   - Code-block content strips one trailing "\n" if present (marked adds one).
 *   - The document ends with exactly one trailing newline.
 */

import type { JSONContent } from "@tiptap/react";

// ─── Types ─────────────────────────────────────────────────────────────────

type MarkJSON = { type: string; attrs?: Record<string, unknown> };

// ─── Escaping ───────────────────────────────────────────────────────────────

// Characters that are markdown-significant in plain inline text.
// We only escape the minimal set to avoid visual noise in the output.
const ESCAPE_REGEX = /([\\`*_[\]~])/g;

function escapeText(text: string): string {
  return text.replace(ESCAPE_REGEX, "\\$1");
}

// ─── Inline serialisation ───────────────────────────────────────────────────

export function serializeInline(nodes: JSONContent[] | undefined): string {
  if (!nodes?.length) return "";
  return nodes.map(serializeInlineNode).join("");
}

function serializeInlineNode(node: JSONContent): string {
  if (node.type === "hardBreak") return "  \n";
  if (node.type !== "text") return "";

  const text = node.text ?? "";
  const marks: MarkJSON[] = node.marks ?? [];
  return applyMarks(text, marks);
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

  let result = escapeText(text);

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

  return result;
}

// ─── Block serialisation ────────────────────────────────────────────────────

/**
 * Serialise a single block node.
 * `depth` is non-zero only inside list items (controls bullet indentation).
 */
export function serializeBlock(node: JSONContent, depth = 0): string {
  const children = node.content ?? [];

  switch (node.type) {
    case "heading": {
      const level = Math.min((node.attrs?.level as number) ?? 1, 6);
      const hashes = "#".repeat(level);
      return `${hashes} ${serializeInline(children)}\n\n`;
    }

    case "paragraph": {
      const text = serializeInline(children);
      return text ? `${text}\n\n` : "";
    }

    case "codeBlock": {
      const lang = (node.attrs?.language as string | null | undefined) ?? "";
      const raw = children.map((n) => n.text ?? "").join("");
      // marked always appends \n when serialising to HTML; strip one trailing \n
      // so the round-trip is stable (our fenced block already supplies the \n
      // before the closing fence).
      const code = raw.replace(/\n$/, "");
      return `\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
    }

    case "blockquote": {
      const inner = children.map((n) => serializeBlock(n)).join("");
      const trimmed = inner.trimEnd();
      const prefixed = trimmed
        .split("\n")
        .map((l) => (l ? `> ${l}` : ">"))
        .join("\n");
      return `${prefixed}\n\n`;
    }

    case "horizontalRule":
      return `---\n\n`;

    case "bulletList": {
      const items = children
        .map((item) => serializeListItem(item, "-", depth))
        .join("");
      // Top-level list: add a blank line after; nested: no extra newline
      return depth === 0 ? `${items}\n` : items;
    }

    case "orderedList": {
      const start = (node.attrs?.start as number) ?? 1;
      const items = children
        .map((item, i) => serializeListItem(item, `${start + i}.`, depth))
        .join("");
      return depth === 0 ? `${items}\n` : items;
    }

    default:
      return "";
  }
}

function serializeListItem(
  item: JSONContent,
  marker: string,
  depth: number,
): string {
  const children = item.content ?? [];
  const indent = "  ".repeat(depth);
  let result = "";
  let firstParagraph = true;

  for (const child of children) {
    if (child.type === "paragraph") {
      const text = serializeInline(child.content);
      if (firstParagraph) {
        result += `${indent}${marker} ${text}\n`;
        firstParagraph = false;
      } else {
        // Continuation paragraph inside the same list item
        result += `\n${indent}  ${text}\n`;
      }
    } else if (child.type === "bulletList" || child.type === "orderedList") {
      // Nested list — indent one more level
      result += serializeBlock(child, depth + 1);
    }
    // Other block types inside list items (blockquote, code) are rare;
    // fall through to serializeBlock if needed.
  }

  return result;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Serialise a Tiptap JSONContent document tree to a Markdown string.
 *
 * The output is the canonical ("normalised") form:
 *   - No setext headings; no triple+ blank lines.
 *   - Trailing empty paragraphs (from TrailingNode) are silently dropped.
 *   - The result ends with exactly one newline.
 */
export function docToMarkdown(doc: JSONContent): string {
  if (doc.type !== "doc") return "";

  const parts = (doc.content ?? []).map((node) => serializeBlock(node));
  let result = parts.join("");

  // Collapse any accidental triple+ newlines
  result = result.replace(/\n{3,}/g, "\n\n");
  // Strip trailing whitespace and ensure exactly one trailing newline
  result = result.trimEnd() + "\n";

  return result;
}
