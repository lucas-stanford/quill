/**
 * markdown/table.test.ts
 *
 * Tables, end to end: markdown -> document -> markdown.
 *
 * The bug these guard is not "tables render wrong". It is that a table used to
 * disappear from the document on load and then be erased from the user's file
 * by the next autosave. So every test here asserts on *bytes*, not on shape.
 */

import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { parseMarkdown } from "./parse";
import { docToMarkdown } from "./serialize";
import { escapeCellText, renderGfmTable } from "./table";

/** Full load-and-save cycle, exactly as `usePlanEditor` performs it. */
function roundTrip(markdown: string): string {
  const plan = parseMarkdown(markdown);
  return docToMarkdown(plan.doc, { source: plan.source });
}

/** Load, edit the tree, save — the shape of a real user edit. */
function editAndSave(
  markdown: string,
  edit: (doc: JSONContent) => void,
): string {
  const plan = parseMarkdown(markdown);
  const doc = structuredClone(plan.doc);
  edit(doc);
  return docToMarkdown(doc, { source: plan.source });
}

/** Line numbers (1-based) whose content differs between two documents. */
function changedLines(before: string, after: string): number[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const out: number[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) out.push(i + 1);
  }
  return out;
}

function firstTable(doc: JSONContent): JSONContent {
  const table = (doc.content ?? []).find((n) => n.type === "table");
  if (!table) throw new Error("no table in document");
  return table;
}

function cellText(cell: JSONContent): string {
  const paragraph = (cell.content ?? [])[0];
  return (paragraph?.content ?? []).map((n) => n.text ?? "").join("");
}

// ─── Parsing ────────────────────────────────────────────────────────────────

describe("parsing GFM tables", () => {
  it("produces a table node rather than dropping the block", () => {
    const { doc } = parseMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
    expect(doc.content?.map((n) => n.type)).toEqual(["table"]);

    const table = firstTable(doc);
    expect(table.content?.length).toBe(2);
    expect(table.content?.[0].content?.map((c) => c.type)).toEqual([
      "tableHeader",
      "tableHeader",
    ]);
    expect(table.content?.[1].content?.map((c) => c.type)).toEqual([
      "tableCell",
      "tableCell",
    ]);
    expect(table.content?.[1].content?.map(cellText)).toEqual(["1", "2"]);
  });

  it("records alignment from the delimiter row on every cell of the column", () => {
    const { doc } = parseMarkdown(
      "| l | c | r | d |\n|:--|:-:|--:|---|\n| 1 | 2 | 3 | 4 |\n",
    );
    const table = firstTable(doc);
    for (const row of table.content ?? []) {
      expect((row.content ?? []).map((c) => c.attrs?.align ?? null)).toEqual([
        "left",
        "center",
        "right",
        null,
      ]);
    }
  });

  it("keeps inline marks inside cells", () => {
    const { doc } = parseMarkdown(
      "| what | who |\n| --- | --- |\n| **bold** `code` | [Bo](https://e.com) |\n",
    );
    const cells = firstTable(doc).content?.[1].content ?? [];
    const inline = cells[0].content?.[0].content ?? [];
    expect(inline.map((n) => [n.text, (n.marks ?? []).map((m) => m.type)])).toEqual([
      ["bold", ["bold"]],
      [" ", []],
      ["code", ["code"]],
    ]);
    const link = (cells[1].content?.[0].content ?? [])[0];
    expect(link.marks?.[0].type).toBe("link");
    expect(link.marks?.[0].attrs?.href).toBe("https://e.com");
  });

  it("unescapes a pipe inside a cell", () => {
    const { doc } = parseMarkdown("| x |\n| --- |\n| a \\| b |\n");
    expect(cellText((firstTable(doc).content?.[1].content ?? [])[0])).toBe("a | b");
  });

  it("reads a table nested in a list item", () => {
    const { doc } = parseMarkdown("- item\n\n  | a |\n  | - |\n  | 1 |\n");
    const item = doc.content?.[0].content?.[0];
    expect(item?.content?.map((n) => n.type)).toEqual(["paragraph", "table"]);
  });
});

// ─── Round-tripping ─────────────────────────────────────────────────────────

describe("table round-trip", () => {
  it("keeps a simple table byte-identical", () => {
    const md = "| Step | Owner |\n| ---- | ----- |\n| Parse | Ana |\n";
    expect(roundTrip(md)).toBe(md);
  });

  it("keeps alignment markers byte-identical", () => {
    const md =
      "| l | c | r |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n\nAfter the table.\n";
    expect(roundTrip(md)).toBe(md);
  });

  it("keeps inline marks in cells byte-identical", () => {
    const md =
      "| what | who | state |\n| --- | --- | --- |\n" +
      "| **bold** and `code` | [Bo](https://e.com) | ~~done~~ |\n";
    expect(roundTrip(md)).toBe(md);
  });

  it("keeps an escaped pipe byte-identical", () => {
    const md = "| expr | meaning |\n| --- | --- |\n| `a \\| b` | a or b |\n";
    expect(roundTrip(md)).toBe(md);
  });

  it("keeps a hand-aligned table verbatim, ragged spacing and all", () => {
    const md = [
      "Intro paragraph.",
      "",
      "|  Component |    Owner | Status  |",
      "|:-----------|---------:|:-------:|",
      "| parser     |      Ana | done    |",
      "| serializer |  Bo      | wip     |",
      "",
      "Outro paragraph.",
      "",
    ].join("\n");
    expect(roundTrip(md)).toBe(md);
  });

  it("keeps a table at end of file byte-identical", () => {
    const md = "# Title\n\n| a | b |\n| - | - |\n| 1 | 2 |\n";
    expect(roundTrip(md)).toBe(md);
  });

  it("keeps two identical tables byte-identical", () => {
    const one = "| a | b |\n| - | - |\n| 1 | 2 |";
    const md = `${one}\n\nBetween.\n\n${one}\n`;
    expect(roundTrip(md)).toBe(md);
  });

  it("keeps a table nested in a list item byte-identical", () => {
    const md = "- item\n\n  | a |\n  | - |\n  | 1 |\n";
    expect(roundTrip(md)).toBe(md);
  });
});

// ─── Editing ────────────────────────────────────────────────────────────────

describe("editing a table", () => {
  const md = [
    "# Plan",
    "",
    "A paragraph that must not move when a table changes, long enough that any",
    "accidental re-wrap would be obvious in the diff.",
    "",
    "| Step  | Owner | Status |",
    "| :---- | :---: | -----: |",
    "| parse |  Ana  |   done |",
    "| write |  Bo   |    wip |",
    "",
    "| Other | Table |",
    "| ----- | ----- |",
    "| keep  | me    |",
    "",
    "Trailing paragraph.",
    "",
  ].join("\n");

  it("rewrites only the edited table", () => {
    const after = editAndSave(md, (doc) => {
      const cell = firstTable(doc).content?.[1].content?.[2];
      const text = cell?.content?.[0].content?.[0];
      if (!text) throw new Error("cell not found");
      text.text = "done!";
    });

    // One cell, one line. The second table and the prose do not move.
    expect(changedLines(md, after)).toEqual([8]);
    expect(after).toContain("| Other | Table |");
    expect(after).toContain("| keep  | me    |");
    expect(after).toContain("done!");
  });

  it("keeps a re-widening edit inside its own table", () => {
    const after = editAndSave(md, (doc) => {
      const text = firstTable(doc).content?.[1].content?.[2]?.content?.[0]
        .content?.[0];
      if (!text) throw new Error("cell not found");
      text.text = "shipped";
    });

    // Lines 6-9 are the edited table; a wider column may repaint all of them.
    for (const line of changedLines(md, after)) {
      expect(line).toBeGreaterThanOrEqual(6);
      expect(line).toBeLessThanOrEqual(9);
    }
  });

  it("re-emits the edited table as readably aligned GFM", () => {
    const after = editAndSave(md, (doc) => {
      const text = firstTable(doc).content?.[1].content?.[2]?.content?.[0]
        .content?.[0];
      if (!text) throw new Error("cell not found");
      text.text = "shipped";
    });

    expect(after).toContain(
      [
        "| Step  | Owner |  Status |",
        "| :---- | :---: | ------: |",
        "| parse |  Ana  | shipped |",
        "| write |  Bo   |     wip |",
      ].join("\n"),
    );
  });

  it("survives a re-load of its own output", () => {
    const after = editAndSave(md, (doc) => {
      const text = firstTable(doc).content?.[1].content?.[2]?.content?.[0]
        .content?.[0];
      if (!text) throw new Error("cell not found");
      text.text = "shipped";
    });
    expect(roundTrip(after)).toBe(after);
  });

  it("escapes a pipe typed into a cell", () => {
    const after = editAndSave(md, (doc) => {
      const text = firstTable(doc).content?.[1].content?.[2]?.content?.[0]
        .content?.[0];
      if (!text) throw new Error("cell not found");
      text.text = "a | b";
    });
    expect(after).toContain("a \\| b");
    expect(roundTrip(after)).toBe(after);
    const reparsed = parseMarkdown(after);
    expect(
      cellText((firstTable(reparsed.doc).content?.[1].content ?? [])[2]),
    ).toBe("a | b");
  });

  it("confines a hand-aligned table's reformat to its own lines", () => {
    const ragged = [
      "Before.",
      "",
      "|  Component |    Owner | Status  |",
      "|:-----------|---------:|:-------:|",
      "| parser     |      Ana | done    |",
      "| serializer |  Bo      | wip     |",
      "",
      "After.",
      "",
    ].join("\n");

    const after = editAndSave(ragged, (doc) => {
      const text = firstTable(doc).content?.[1].content?.[2]?.content?.[0]
        .content?.[0];
      if (!text) throw new Error("cell not found");
      text.text = "shipped";
    });

    // Lines 3-6 are the table. Reformatting may touch all of them; the prose
    // on either side must be untouched.
    for (const line of changedLines(ragged, after)) {
      expect(line).toBeGreaterThanOrEqual(3);
      expect(line).toBeLessThanOrEqual(6);
    }
    expect(after.split("\n")[0]).toBe("Before.");
    expect(after).toContain("After.");
  });
});

// ─── Rendering primitives ───────────────────────────────────────────────────

describe("renderGfmTable", () => {
  it("pads every column to its widest cell", () => {
    expect(
      renderGfmTable(
        [
          ["a", "long header"],
          ["x", "y"],
        ],
        [null, null],
      ),
    ).toBe("| a   | long header |\n| --- | ----------- |\n| x   | y           |");
  });

  it("emits each alignment marker", () => {
    expect(
      renderGfmTable([["a", "b", "c", "d"]], ["left", "center", "right", null]),
    ).toBe("| a   |  b  |   c | d   |\n| :-- | :-: | --: | --- |");
  });

  it("pads short rows instead of losing cells", () => {
    expect(renderGfmTable([["a"], ["x", "y"]], [])).toBe(
      "| a   |     |\n| --- | --- |\n| x   | y   |",
    );
  });

  it("returns nothing for a table with no rows", () => {
    expect(renderGfmTable([], [])).toBe("");
  });
});

describe("escapeCellText", () => {
  it("escapes pipes", () => {
    expect(escapeCellText("a | b")).toBe("a \\| b");
  });

  it("escapes a pipe inside a code span, as GFM requires", () => {
    expect(escapeCellText("`a | b`")).toBe("`a \\| b`");
  });

  it("leaves an existing backslash escape alone", () => {
    expect(escapeCellText("a\\\\|b")).toBe("a\\\\\\|b");
  });

  it("folds a soft break to a space", () => {
    expect(escapeCellText("a  \nb")).toBe("a b");
  });
});
