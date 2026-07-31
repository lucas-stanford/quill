/**
 * markdown/roundtrip.test.ts
 *
 * Invariant 2, pinned down.
 *
 * "An untouched plan round-trips byte-identically and typing one character
 * changes exactly one line" is the property that makes live autosave safe to
 * point at somebody's file. It is also invisible: nothing breaks loudly when it
 * regresses, the file just quietly drifts. These tests are the alarm.
 *
 * They run the real schema, not a hand-written stand-in. `parseMarkdown` builds
 * a tree, ProseMirror re-reads it through the same node definitions the browser
 * uses, and the tree that comes back out is what gets serialized — which is
 * exactly the path a save takes and the one place a schema-level normalisation
 * could silently disable verbatim output.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/react";
import type { JSONContent } from "@tiptap/react";
import { alignSource, parseMarkdown } from "./parse";
import { docToMarkdown } from "./serialize";
import { editorExtensions } from "../editor/extensions";

const schema = getSchema(editorExtensions);

/** What `editor.getJSON()` returns after `setContent(doc)`. */
function throughSchema(doc: JSONContent): JSONContent {
  return schema.nodeFromJSON(doc).toJSON() as JSONContent;
}

/**
 * A full load-then-save cycle through the live schema, with no user edit in
 * between. Whatever comes back should be the file we started with.
 */
function loadAndSave(markdown: string): string {
  const plan = parseMarkdown(markdown);
  const live = throughSchema(plan.doc);
  alignSource(plan, live);
  return docToMarkdown(live, { source: plan.source });
}

const PLAN_MD = fileURLToPath(new URL("../../../../PLAN.md", import.meta.url));

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

const KITCHEN_SINK = [
  "# Quill",
  "",
  "A paragraph with **bold**, *italic*, `code`, a [link](https://example.com)",
  "and a soft wrap in the middle of it.",
  "",
  "## Tables",
  "",
  "| Step  | Owner | Status |",
  "| :---- | :---: | -----: |",
  "| parse |  Ana  |   done |",
  "",
  "|  Ragged | Hand | Aligned |",
  "|:--------|-----:|:-------:|",
  "| a       |    1 | yes     |",
  "",
  "## Lists",
  "",
  "- first item",
  "- second item with a nested list",
  "  - nested one",
  "  - nested two",
  "",
  "1. ordered one",
  "2. ordered two",
  "",
  "## Everything else",
  "",
  "> A block quote that is long enough to have been wrapped by the author when",
  "> they wrote it down.",
  "",
  "```ts",
  "const x = 1;",
  "",
  "const y = 2;",
  "```",
  "",
  "---",
  "",
  "Trailing paragraph.",
  "",
].join("\n");

describe("byte-identical round-trip", () => {
  it("leaves the project's own PLAN.md untouched", () => {
    const markdown = readFileSync(PLAN_MD, "utf8");
    expect(loadAndSave(markdown)).toBe(markdown);
  });

  it("leaves a document of every supported construct untouched", () => {
    expect(loadAndSave(KITCHEN_SINK)).toBe(KITCHEN_SINK);
  });

  it("is stable when applied twice", () => {
    const once = loadAndSave(KITCHEN_SINK);
    expect(loadAndSave(once)).toBe(once);
  });

  it("changes exactly one line when one character is typed", () => {
    const plan = parseMarkdown(KITCHEN_SINK);
    const live = throughSchema(plan.doc);
    alignSource(plan, live);

    const paragraph = (live.content ?? []).find(
      (n) =>
        n.type === "paragraph" && n.content?.[0]?.text?.startsWith("Trailing"),
    );
    const text = paragraph?.content?.[0];
    if (!text?.text) throw new Error("target paragraph not found");
    text.text = `${text.text}!`;

    expect(changedLines(KITCHEN_SINK, docToMarkdown(live, { source: plan.source })))
      .toEqual([39]);
  });

  it("keeps an edit to a wrapped paragraph inside that paragraph", () => {
    const plan = parseMarkdown(KITCHEN_SINK);
    const live = throughSchema(plan.doc);
    alignSource(plan, live);

    const paragraph = (live.content ?? []).find(
      (n) =>
        n.type === "paragraph" && n.content?.[0]?.text?.startsWith("A paragraph"),
    );
    const inline = paragraph?.content ?? [];
    const text = inline[inline.length - 1];
    if (!text?.text) throw new Error("target paragraph not found");
    text.text = `${text.text}!`;

    // Lines 3-4 are the paragraph. The heading above and the table below stay.
    for (const line of changedLines(
      KITCHEN_SINK,
      docToMarkdown(live, { source: plan.source }),
    )) {
      expect(line).toBeGreaterThanOrEqual(3);
      expect(line).toBeLessThanOrEqual(4);
    }
  });
});

describe("the schema does not silently disable verbatim output", () => {
  it("keys a table the same before and after ProseMirror sees it", () => {
    const plan = parseMarkdown(KITCHEN_SINK);
    const live = throughSchema(plan.doc);
    const parsedTables = (plan.doc.content ?? []).filter((n) => n.type === "table");
    const liveTables = (live.content ?? []).filter((n) => n.type === "table");

    expect(liveTables).toHaveLength(parsedTables.length);
    expect(liveTables.length).toBeGreaterThan(0);
    // The schema fills in colspan/rowspan/colwidth defaults. If those leaked
    // into the key, every table would reformat itself on the first save.
    for (let i = 0; i < liveTables.length; i++) {
      expect(liveTables[i].content?.[0].content?.[0].attrs).toHaveProperty("colspan");
      expect(docToMarkdown({ type: "doc", content: [liveTables[i]] })).toBe(
        docToMarkdown({ type: "doc", content: [parsedTables[i]] }),
      );
    }
  });
});

/**
 * The class of bug this lane exists to kill: a construct the schema cannot
 * model is dropped on load, and autosave then erases it from the file. Tables
 * were the worst case. These are the rest of them.
 */
describe("constructs the schema cannot model are preserved, not dropped", () => {
  const cases: Record<string, string> = {
    "an HTML comment": "Before.\n\n<!-- a note for the agent -->\n\nAfter.\n",
    "an HTML block": 'Before.\n\n<div class="callout">\n  <b>hi</b>\n</div>\n\nAfter.\n',
    "a link reference definition": "See [foo].\n\n[foo]: https://example.com\n",
    "an image": "Look ![a diagram](./d.png) at this.\n",
    "an image alone in a paragraph": "Before.\n\n![a diagram](./d.png)\n\nAfter.\n",
    "an image with no alt text": "Before.\n\n![](./d.png)\n\nAfter.\n",
    "inline HTML": "A <br> break and <u>underline</u>.\n",
    "a footnote": "Text[^1].\n\n[^1]: the note.\n",
    "a definition list": "Term\n: definition\n",
  };

  for (const [name, markdown] of Object.entries(cases)) {
    it(`round-trips ${name} byte-identically`, () => {
      expect(loadAndSave(markdown)).toBe(markdown);
    });
  }

  it("keeps an image's source when its paragraph is rebuilt", () => {
    const plan = parseMarkdown("Look ![a diagram](./d.png) at this.\n");
    const live = throughSchema(plan.doc);
    const text = live.content?.[0].content?.[0];
    if (!text?.text) throw new Error("paragraph not found");
    text.text = "Look!";

    const after = docToMarkdown(live, { source: plan.source });
    expect(after).toContain("![a diagram](./d.png)");
  });

  it("keeps an HTML block's source when it is rebuilt", () => {
    const markdown = '<div class="callout">\n  <b>hi</b>\n</div>\n';
    const plan = parseMarkdown(markdown);
    const live = throughSchema(plan.doc);
    const text = live.content?.[0].content?.[0];
    if (!text?.text) throw new Error("paragraph not found");
    text.text = '<div class="warning">';

    const after = docToMarkdown(live, { source: plan.source });
    expect(after).toContain('<div class="warning">');
    expect(after).toContain("<b>hi</b>");
    expect(after).toContain("</div>");
  });
});

describe("underline survives a save", () => {
  it("reads back the <u> the serializer emits", () => {
    const markdown = "A word that is <u>underlined</u> here.\n";
    const { doc } = parseMarkdown(markdown);
    const inline = doc.content?.[0].content ?? [];
    expect(
      inline.map((n) => [n.text, (n.marks ?? []).map((m) => m.type)]),
    ).toEqual([
      ["A word that is ", []],
      ["underlined", ["underline"]],
      [" here.", []],
    ]);
    expect(loadAndSave(markdown)).toBe(markdown);
  });

  it("keeps the underline when its paragraph is rebuilt", () => {
    const plan = parseMarkdown("A word that is <u>underlined</u> here.\n");
    const live = throughSchema(plan.doc);
    const last = (live.content?.[0].content ?? []).at(-1);
    if (!last?.text) throw new Error("paragraph not found");
    last.text = " here!";
    expect(docToMarkdown(live, { source: plan.source })).toBe(
      "A word that is <u>underlined</u> here!\n",
    );
  });

  it("leaves an unbalanced tag as literal text", () => {
    const markdown = "An unclosed <u> tag.\n";
    expect(loadAndSave(markdown)).toBe(markdown);
    const { doc } = parseMarkdown(markdown);
    expect(
      (doc.content?.[0].content ?? []).every((n) => (n.marks ?? []).length === 0),
    ).toBe(true);
  });
});
