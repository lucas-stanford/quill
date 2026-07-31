/**
 * roundtrip-check.mjs
 *
 * Verifies Markdown round-trip fidelity for PLAN.md.
 *
 * This script is a CHECKED-IN verification tool — it proves the serializer
 * produces idempotent output and documents exactly which constructs normalise.
 *
 * Usage (from repo root):
 *   node packages/web/src/markdown/__check__/roundtrip-check.mjs
 *
 * Exit code 0 = idempotent (second round-trip identical to first).
 * Exit code 1 = not idempotent or parse error.
 */

import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { diffLines } from "./diff.mjs";

const require = createRequire(import.meta.url);

// ── Locate packages ──────────────────────────────────────────────────────────

// Walk up to repo root (roundtrip-check.mjs is 5 levels deep in the tree)
import { resolve, dirname } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, "../../../../..");   // /…/roundtrip

// We need to load marked from the package tree
const markedMod = resolve(pkgRoot, "node_modules/.pnpm/marked@18.0.7/node_modules/marked/lib/marked.esm.js");

const { marked } = await import(markedMod);

// ── Inline the serialiser/parser logic ──────────────────────────────────────
// The TypeScript source can't be imported directly in Node (no transpiler).
// We inline equivalent plain-JS implementations here — kept in sync with the
// .ts sources by hand.  If they diverge, update this script to match.

// ── parse (markdown → JSONContent) ──────────────────────────────────────────

function parseInline(tokens, inheritedMarks = []) {
  const result = [];
  for (const token of tokens) {
    switch (token.type) {
      case "text": {
        if (token.tokens && token.tokens.length > 0) {
          result.push(...parseInline(token.tokens, inheritedMarks));
        } else {
          const text = token.text.replace(/\n/g, " ");
          if (text) {
            const node = { type: "text", text };
            if (inheritedMarks.length > 0) node.marks = inheritedMarks;
            result.push(node);
          }
        }
        break;
      }
      case "escape": {
        const text = token.text;
        if (text) {
          const node = { type: "text", text };
          if (inheritedMarks.length > 0) node.marks = inheritedMarks;
          result.push(node);
        }
        break;
      }
      case "strong":
        result.push(...parseInline(token.tokens ?? [], [...inheritedMarks, { type: "bold" }]));
        break;
      case "em":
        result.push(...parseInline(token.tokens ?? [], [...inheritedMarks, { type: "italic" }]));
        break;
      case "del":
        result.push(...parseInline(token.tokens ?? [], [...inheritedMarks, { type: "strike" }]));
        break;
      case "codespan": {
        if (token.text) {
          result.push({ type: "text", text: token.text, marks: [...inheritedMarks, { type: "code" }] });
        }
        break;
      }
      case "link": {
        const linkMark = { type: "link", attrs: { href: token.href, title: token.title ?? null } };
        result.push(...parseInline(token.tokens ?? [], [...inheritedMarks, linkMark]));
        break;
      }
      case "br":
        result.push({ type: "hardBreak" });
        break;
    }
  }
  return result;
}

function parseListItem(item) {
  const content = [];
  const tokens = item.tokens ?? [];
  for (const token of tokens) {
    switch (token.type) {
      case "text": {
        const inlineToks = token.tokens ?? [];
        if (inlineToks.length > 0) {
          content.push({ type: "paragraph", content: parseInline(inlineToks) });
        } else {
          const text = token.text.replace(/\n/g, " ");
          if (text) content.push({ type: "paragraph", content: [{ type: "text", text }] });
        }
        break;
      }
      case "paragraph":
        content.push({ type: "paragraph", content: parseInline(token.tokens ?? []) });
        break;
      case "list":
      case "blockquote":
      case "code":
      case "hr":
        content.push(...parseBlock(token));
        break;
    }
  }
  if (content.length === 0 || content[0].type !== "paragraph") {
    content.unshift({ type: "paragraph", content: [] });
  }
  return { type: "listItem", content };
}

function parseBlock(token) {
  switch (token.type) {
    case "heading":
      return [{ type: "heading", attrs: { level: token.depth }, content: parseInline(token.tokens ?? []) }];
    case "paragraph":
      return [{ type: "paragraph", content: parseInline(token.tokens ?? []) }];
    case "code": {
      const lang = token.lang || null;
      const text = token.text;
      return [{ type: "codeBlock", attrs: { language: lang }, content: text ? [{ type: "text", text }] : [] }];
    }
    case "blockquote": {
      const innerContent = [];
      for (const t of token.tokens ?? []) innerContent.push(...parseBlock(t));
      return [{ type: "blockquote", content: innerContent }];
    }
    case "hr":
      return [{ type: "horizontalRule" }];
    case "list": {
      const isOrdered = token.ordered;
      const start = typeof token.start === "number" ? token.start : 1;
      const items = token.items.map(parseListItem);
      return [{ type: isOrdered ? "orderedList" : "bulletList", attrs: isOrdered ? { start } : {}, content: items }];
    }
    case "space":
    default:
      return [];
  }
}

function markdownToJSON(markdown) {
  const tokens = marked.lexer(markdown, { gfm: true, breaks: false });
  const content = [];
  for (const token of tokens) content.push(...parseBlock(token));
  if (content.length === 0) content.push({ type: "paragraph", content: [] });
  return { type: "doc", content };
}

// ── serialize (JSONContent → markdown) ─────────────────────────────────────

const ESCAPE_REGEX = /([\\`*_[\]~])/g;
function escapeText(text) { return text.replace(ESCAPE_REGEX, "\\$1"); }

function serializeInline(nodes) {
  if (!nodes?.length) return "";
  return nodes.map(n => {
    if (n.type === "hardBreak") return "  \n";
    if (n.type !== "text") return "";
    const text = n.text ?? "";
    const marks = n.marks ?? [];
    return applyMarks(text, marks);
  }).join("");
}

function applyMarks(text, marks) {
  if (marks.some(m => m.type === "code")) {
    const delim = text.includes("`") ? "``" : "`";
    const pad = (text.startsWith("`") || text.endsWith("`")) ? " " : "";
    return `${delim}${pad}${text}${pad}${delim}`;
  }
  let result = escapeText(text);
  const hasBold = marks.some(m => m.type === "bold");
  const hasItalic = marks.some(m => m.type === "italic");
  const hasStrike = marks.some(m => m.type === "strike");
  const linkMark = marks.find(m => m.type === "link");

  if (hasStrike) result = `~~${result}~~`;
  if (hasBold && hasItalic) result = `***${result}***`;
  else if (hasBold) result = `**${result}**`;
  else if (hasItalic) result = `*${result}*`;
  if (marks.some(m => m.type === "underline")) result = `<u>${result}</u>`;
  if (linkMark) {
    const href = linkMark.attrs?.href ?? "";
    const title = linkMark.attrs?.title ? ` "${linkMark.attrs.title}"` : "";
    result = `[${result}](${href}${title})`;
  }
  return result;
}

function serializeBlock(node, depth = 0) {
  const children = node.content ?? [];
  switch (node.type) {
    case "heading": {
      const level = Math.min(node.attrs?.level ?? 1, 6);
      return `${"#".repeat(level)} ${serializeInline(children)}\n\n`;
    }
    case "paragraph": {
      const text = serializeInline(children);
      return text ? `${text}\n\n` : "";
    }
    case "codeBlock": {
      const lang = node.attrs?.language ?? "";
      const raw = children.map(n => n.text ?? "").join("");
      const code = raw.replace(/\n$/, "");
      return `\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
    }
    case "blockquote": {
      const inner = children.map(n => serializeBlock(n)).join("");
      const trimmed = inner.trimEnd();
      const prefixed = trimmed.split("\n").map(l => l ? `> ${l}` : ">").join("\n");
      return `${prefixed}\n\n`;
    }
    case "horizontalRule":
      return `---\n\n`;
    case "bulletList": {
      const items = children.map(item => serializeListItem(item, "-", depth)).join("");
      return depth === 0 ? `${items}\n` : items;
    }
    case "orderedList": {
      const start = node.attrs?.start ?? 1;
      const items = children.map((item, i) => serializeListItem(item, `${start + i}.`, depth)).join("");
      return depth === 0 ? `${items}\n` : items;
    }
    default: return "";
  }
}

function serializeListItem(item, marker, depth) {
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
        result += `\n${indent}  ${text}\n`;
      }
    } else if (child.type === "bulletList" || child.type === "orderedList") {
      result += serializeBlock(child, depth + 1);
    }
  }
  return result;
}

function docToMarkdown(doc) {
  if (doc.type !== "doc") return "";
  const parts = (doc.content ?? []).map(node => serializeBlock(node));
  let result = parts.join("").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const planPath = resolve(pkgRoot, "PLAN.md");
const original = readFileSync(planPath, "utf-8");

console.log("=== Quill round-trip check ===\n");
console.log(`Source: ${planPath}`);
console.log(`Length: ${original.length} bytes, ${original.split("\n").length} lines\n`);

// First round-trip
const json1 = markdownToJSON(original);
const pass1 = docToMarkdown(json1);

// Second round-trip (must be identical to pass1 — idempotence)
const json2 = markdownToJSON(pass1);
const pass2 = docToMarkdown(json2);

// ── Diff pass1 vs original ────────────────────────────────────────────────────
console.log("── Pass 1: original → parse → serialize ─────────────────────────────────");
const diff1 = diffLines(original, pass1);
if (diff1.length === 0) {
  console.log("✓ Byte-identical to original (no normalization needed)\n");
} else {
  console.log(`${diff1.length} line(s) changed (normalization — expected):`);
  diff1.forEach(({ lineNo, original: orig, result }) => {
    const origTrunc = orig.length > 100 ? orig.slice(0, 97) + "…" : orig;
    const resTrunc = result.length > 100 ? result.slice(0, 97) + "…" : result;
    console.log(`  Line ~${lineNo}:`);
    console.log(`    - ${JSON.stringify(origTrunc)}`);
    console.log(`    + ${JSON.stringify(resTrunc)}`);
  });
  console.log();
}

// ── Diff pass2 vs pass1 ──────────────────────────────────────────────────────
console.log("── Pass 2: serialized → parse → serialize (idempotence check) ───────────");
const diff2 = diffLines(pass1, pass2);
if (diff2.length === 0) {
  console.log("✓ Idempotent — second round-trip is byte-identical to first\n");
} else {
  console.error("✗ NOT idempotent — second pass differs from first:");
  diff2.forEach(({ lineNo, original: orig, result }) => {
    console.error(`  Line ~${lineNo}:`);
    console.error(`    - ${JSON.stringify(orig)}`);
    console.error(`    + ${JSON.stringify(result)}`);
  });
  console.log();
}

// ── ASCII diagram spot-check ─────────────────────────────────────────────────
console.log("── ASCII diagram preservation ────────────────────────────────────────────");
const diagramLines = [
  "  ┌─────────────────────────┐        ┌──────────────────────┐",
  "  │  quill  (node CLI)      │        │  PLAN.md             │  ← source of truth",
  "  └───────────┬─────────────┘",
];
let diagramOk = true;
for (const line of diagramLines) {
  if (pass1.includes(line)) {
    console.log(`  ✓ ${line.trim().slice(0, 60)}`);
  } else {
    console.error(`  ✗ MISSING: ${line}`);
    diagramOk = false;
  }
}

// ── Code block language tags ─────────────────────────────────────────────────
console.log("\n── Code block language tags ──────────────────────────────────────────────");
const hasJsonFence = pass1.includes("```json\n");
const hasNoLangFence = (pass1.match(/^```\n/m) !== null);
console.log(`  ${hasJsonFence ? "✓" : "✗"} \`\`\`json block preserved`);
console.log(`  ${hasNoLangFence ? "✓" : "✗"} language-less \`\`\` block preserved`);

// ── Exit ─────────────────────────────────────────────────────────────────────
const ok = diff2.length === 0 && diagramOk && hasJsonFence && hasNoLangFence;
console.log(`\n${ok ? "✓ PASS" : "✗ FAIL"}`);
process.exit(ok ? 0 : 1);
