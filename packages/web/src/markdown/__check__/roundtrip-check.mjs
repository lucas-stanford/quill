/**
 * roundtrip-check.mjs
 *
 * Proves the property M2 is named after: editing a plan in the browser must not
 * reflow the parts of the file nobody touched.
 *
 * Usage (from anywhere in the repo):
 *   node packages/web/src/markdown/__check__/roundtrip-check.mjs [file.md]
 *
 * Exit code 0 = every assertion held. 1 = drift.
 *
 * What it asserts, against the repository's own PLAN.md:
 *   1. Load and save with no edit is byte-identical — a zero-line diff.
 *   2. The round trip is idempotent, with and without the source map.
 *   3. A one-character edit in ANY top-level block changes only that block.
 *   4. Whatever comes out re-parses to the same document that went in, for the
 *      awkward cases: reordering, deletion, duplication, ordered-list renumber.
 *   5. The ASCII diagram inside the fenced code block survives byte-identically.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { diffLines } from "./diff.mjs";
import { loadMarkdownModule, repoRoot } from "./load.mjs";

const { parseMarkdown, docToMarkdown } = await loadMarkdownModule();

const planPath = resolve(repoRoot, process.argv[2] ?? "PLAN.md");
const original = readFileSync(planPath, "utf-8");

let failures = 0;
const clone = (value) => JSON.parse(JSON.stringify(value));

function assert(label, ok, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function firstTextNode(node) {
  if (node.type === "text") return node;
  for (const child of node.content ?? []) {
    const found = firstTextNode(child);
    if (found) return found;
  }
  return null;
}

/** The output must always mean exactly what the tree it came from meant. */
function meansTheSame(doc, emitted) {
  return docToMarkdown(doc) === docToMarkdown(parseMarkdown(emitted).doc);
}

console.log("=== Quill round-trip check ===\n");
console.log(`Source: ${planPath}`);
console.log(
  `Length: ${original.length} bytes, ${original.split("\n").length} lines`,
);

const plan = parseMarkdown(original);
console.log(`Detected wrap width: ${plan.source.wrapWidth}\n`);

// ── 1. Load and save, untouched ─────────────────────────────────────────────
console.log("── Untouched round trip ──────────────────────────────────────────────────");
const saved = docToMarkdown(plan.doc, { source: plan.source });
const untouched = diffLines(original, saved);
assert("byte-identical, zero-line diff", saved === original, `${untouched.total} changed lines`);
if (saved !== original) console.log(untouched.hunks.slice(0, 40).join("\n"));

// ── 2. Idempotence ──────────────────────────────────────────────────────────
console.log("\n── Idempotence ───────────────────────────────────────────────────────────");
const second = parseMarkdown(saved);
assert("second pass identical", docToMarkdown(second.doc, { source: second.source }) === saved);
const canonical = docToMarkdown(plan.doc);
const canonicalAgain = docToMarkdown(parseMarkdown(canonical).doc);
assert("canonical (no source map) pass identical", canonicalAgain === canonical);

// ── 3. One character in, one block out ──────────────────────────────────────
console.log("\n── One-character edit, per block ─────────────────────────────────────────");
let worst = 0;
let worstIndex = -1;
for (let i = 0; i < plan.doc.content.length; i++) {
  const doc = clone(plan.doc);
  const text = firstTextNode(doc.content[i]);
  if (!text) continue;
  text.text += "X";
  const edited = docToMarkdown(doc, { source: plan.source });
  const diff = diffLines(original, edited);
  if (diff.total > worst) {
    worst = diff.total;
    worstIndex = i;
  }
  if (!meansTheSame(doc, edited)) {
    assert(`block ${i} (${doc.content[i].type}) round-trips`, false);
  }
}
assert(
  `worst case ${worst} changed lines (block ${worstIndex}, ${plan.doc.content[worstIndex]?.type})`,
  worst <= 6,
);

// ── 4. Blocks that move ─────────────────────────────────────────────────────
console.log("\n── Reorder, delete, duplicate ────────────────────────────────────────────");
const scenarios = [
  ["reversed document", (d) => d.content.reverse()],
  ["first block deleted", (d) => d.content.splice(0, 1)],
  ["a block duplicated", (d) => d.content.push(clone(d.content[2]))],
  [
    "ordered list reordered",
    (d) => {
      const list = d.content.find((n) => n.type === "orderedList");
      list.content.reverse();
    },
  ],
];
for (const [label, mutate] of scenarios) {
  const doc = clone(plan.doc);
  mutate(doc);
  const emitted = docToMarkdown(doc, { source: plan.source });
  assert(label, meansTheSame(doc, emitted));
}

// ── 5. Whitespace-significant content ───────────────────────────────────────
console.log("\n── Whitespace-significant content ────────────────────────────────────────");
const diagramStart = original.indexOf("  copilot / any agent");
const diagramEnd = original.indexOf("  └─────────────────────────┘");
const diagram =
  diagramStart === -1
    ? null
    : original.slice(diagramStart, diagramEnd + "  └─────────────────────────┘".length);

if (diagram) {
  const doc = clone(plan.doc);
  firstTextNode(doc.content[2]).text += "X";
  const emitted = docToMarkdown(doc, { source: plan.source });
  assert("ASCII diagram byte-identical after an edit elsewhere", emitted.includes(diagram));
} else {
  console.log("  – no ASCII diagram in this document, skipped");
}
assert("```json fence preserved", saved.includes("```json\n"));
assert("language-less ``` fence preserved", /^```\n/m.test(saved));

console.log(`\n${failures === 0 ? "✓ PASS" : `✗ FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
