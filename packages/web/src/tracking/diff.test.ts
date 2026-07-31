import { describe, expect, it } from "vitest";
import { diffDocuments, diffWords, similarity, tokenizeWords } from "./diff";
import type { DiffBlock, DocOp, WordOp } from "./diff";
import { markdownToJSON } from "../markdown";
import { jsonBlocks } from "./revision";

const para = (text: string): DiffBlock => ({ type: "paragraph", text });

/** The old text, reconstructed from the ops that describe it. */
function oldSide(ops: WordOp[]): string {
  return ops
    .filter((op) => op.type !== "insert")
    .map((op) => op.text)
    .join("");
}

/** The new text, reconstructed from the ops that describe it. */
function newSide(ops: WordOp[]): string {
  return ops
    .filter((op) => op.type !== "delete")
    .map((op) => op.text)
    .join("");
}

function ofType<T extends DocOp["type"]>(
  ops: DocOp[],
  type: T,
): Extract<DocOp, { type: T }>[] {
  return ops.filter((op): op is Extract<DocOp, { type: T }> => op.type === type);
}

describe("tokenizeWords", () => {
  it("keeps whitespace as tokens of its own", () => {
    expect(tokenizeWords("a  b")).toEqual(["a", "  ", "b"]);
    expect(tokenizeWords("")).toEqual([]);
  });
});

describe("diffWords", () => {
  it("reports nothing for identical text", () => {
    expect(diffWords("same text", "same text")).toEqual([
      { type: "equal", text: "same text" },
    ]);
  });

  it("changes one word without touching its neighbours", () => {
    const ops = diffWords("the quick brown fox", "the slow brown fox");

    expect(ops.filter((op) => op.type === "delete")).toEqual([
      { type: "delete", text: "quick" },
    ]);
    expect(ops.filter((op) => op.type === "insert")).toEqual([
      { type: "insert", text: "slow" },
    ]);
  });

  it("round-trips: the ops describe both sides exactly", () => {
    const pairs: Array<[string, string]> = [
      ["the quick brown fox", "the slow brown fox"],
      ["one two three", "one two three four five"],
      ["keep this", ""],
      ["", "brand new sentence"],
      ["a b c d e", "e d c b a"],
      ["Dual-write for the cutover.", "Dual-write for the whole cutover."],
    ];
    for (const [before, after] of pairs) {
      const ops = diffWords(before, after);
      expect(oldSide(ops)).toBe(before);
      expect(newSide(ops)).toBe(after);
    }
  });
});

describe("similarity", () => {
  it("scores an edited sentence high and an unrelated one low", () => {
    expect(similarity("we will pause writes", "we will not pause writes")).toBeGreaterThan(0.8);
    expect(similarity("we will pause writes", "ship the ferricket handoff")).toBe(0);
    expect(similarity("", "")).toBe(1);
  });
});

describe("diffDocuments", () => {
  const base = [
    para("Quill moves plan review into a document surface."),
    para("The agent writes PLAN.md and calls quill."),
    para("Comments live in a sidecar so the plan stays clean."),
  ];

  it("produces zero changes for identical input", () => {
    expect(diffDocuments(base, base)).toEqual([]);
    expect(diffDocuments([], [])).toEqual([]);
  });

  it("reports a single changed word as one in-place edit", () => {
    const revised = [
      base[0],
      para("The agent writes PLAN.md and runs quill."),
      base[2],
    ];

    const ops = diffDocuments(base, revised);
    expect(ops).toHaveLength(1);

    const [op] = ofType(ops, "modify");
    expect(op.oldIndex).toBe(1);
    expect(op.ops.filter((o) => o.type === "delete")).toEqual([
      { type: "delete", text: "calls" },
    ]);
    expect(op.ops.filter((o) => o.type === "insert")).toEqual([
      { type: "insert", text: "runs" },
    ]);
  });

  it("reports a sentence added to a paragraph as one insertion", () => {
    const revised = [
      base[0],
      para("The agent writes PLAN.md and calls quill. Then it blocks."),
      base[2],
    ];

    const ops = diffDocuments(base, revised);
    expect(ops).toHaveLength(1);

    const [op] = ofType(ops, "modify");
    expect(op.ops.filter((o) => o.type === "delete")).toEqual([]);
    expect(op.ops.filter((o) => o.type === "insert")).toEqual([
      { type: "insert", text: " Then it blocks." },
    ]);
  });

  it("reports a new paragraph as one insertion, anchored in place", () => {
    const added = para("Approval is not the end.");
    const ops = diffDocuments(base, [base[0], added, base[1], base[2]]);

    expect(ops).toHaveLength(1);
    const [op] = ofType(ops, "insert");
    expect(op.beforeOldIndex).toBe(1);
    expect(op.block.text).toBe(added.text);
  });

  it("reports a deleted paragraph as one deletion and leaves the rest alone", () => {
    const ops = diffDocuments(base, [base[0], base[2]]);

    expect(ops).toEqual([{ type: "delete", oldIndex: 1 }]);
  });

  it("reports a moved paragraph as one deletion and one insertion, not a rewrite", () => {
    const moved = [base[2], base[0], base[1]];
    const ops = diffDocuments(base, moved);

    // The two paragraphs that merely shifted position produce nothing at all.
    expect(ops).toHaveLength(2);
    expect(ofType(ops, "modify")).toHaveLength(0);

    const [deletion] = ofType(ops, "delete");
    const [insertion] = ofType(ops, "insert");
    expect(base[deletion.oldIndex].text).toBe(base[2].text);
    expect(insertion.block.text).toBe(base[2].text);
    expect(insertion.beforeOldIndex).toBe(0);
  });

  it("replaces rather than word-diffs a paragraph with nothing in common", () => {
    const revised = [base[0], para("Ship it on Friday."), base[2]];
    const ops = diffDocuments(base, revised);

    expect(ofType(ops, "modify")).toHaveLength(0);
    expect(ofType(ops, "delete")).toEqual([{ type: "delete", oldIndex: 1 }]);
    expect(ofType(ops, "insert")[0].block.text).toBe("Ship it on Friday.");
  });

  it("does not confuse a heading with a paragraph of the same words", () => {
    const ops = diffDocuments(
      [{ type: "heading", text: "Principles" }],
      [{ type: "paragraph", text: "Principles" }],
    );
    expect(ofType(ops, "modify")).toHaveLength(0);
    expect(ops).toHaveLength(2);
  });
});

describe("diffDocuments over real markdown", () => {
  const plan = [
    "# Plan",
    "",
    "## Problem",
    "",
    "Reviewing an agent's plan in a terminal is bad. Plans are prose documents,",
    "but the CLI renders them as a wall of scrollback you cannot annotate.",
    "",
    "- Grey canvas, white page with real margins.",
    "- Slim ribbon: bold, italic, lists.",
    "",
    "We will pause writes during the migration.",
    "",
  ].join("\n");

  const blocksOf = (markdown: string) => jsonBlocks(markdownToJSON(markdown));

  it("finds nothing to change when the file is unchanged", () => {
    expect(diffDocuments(blocksOf(plan), blocksOf(plan))).toEqual([]);
  });

  it("survives a reflow: the same prose wrapped differently is not a change", () => {
    const rewrapped = plan.replace(
      "Reviewing an agent's plan in a terminal is bad. Plans are prose documents,\nbut the CLI renders them as a wall of scrollback you cannot annotate.",
      "Reviewing an agent's plan in a terminal is bad. Plans are prose\ndocuments, but the CLI renders them as a wall of scrollback you\ncannot annotate.",
    );
    expect(diffDocuments(blocksOf(plan), blocksOf(rewrapped))).toEqual([]);
  });

  it("keeps a lightly rewritten sentence as one in-place edit", () => {
    const revised = plan.replace(
      "We will pause writes during the migration.",
      "We will pause all writes during the migration window.",
    );
    const ops = diffDocuments(blocksOf(plan), blocksOf(revised));

    expect(ops).toHaveLength(1);
    const [op] = ofType(ops, "modify");
    expect(oldSide(op.ops)).toBe("We will pause writes during the migration.");
    expect(newSide(op.ops)).toBe(
      "We will pause all writes during the migration window.",
    );
    // "We will pause" and the trailing full stop survive untouched.
    expect(op.ops[0]).toEqual({ type: "equal", text: "We will pause " });
    expect(op.ops[op.ops.length - 1]).toEqual({ type: "equal", text: "." });
  });

  it("reports a wholesale rewrite as a replacement rather than a mangled merge", () => {
    // Only "we will" and "the" survive, so stitching the two together at word
    // level would read worse than simply striking one and offering the other.
    const revised = plan.replace(
      "We will pause writes during the migration.",
      "We will dual-write for the duration of the cutover.",
    );
    const ops = diffDocuments(blocksOf(plan), blocksOf(revised));

    expect(ops.map((op) => op.type)).toEqual(["delete", "insert"]);
    // The replacement is anchored immediately after the block it replaces.
    expect(ofType(ops, "insert")[0].beforeOldIndex).toBe(
      ofType(ops, "delete")[0].oldIndex + 1,
    );
  });
});
