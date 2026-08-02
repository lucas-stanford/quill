/**
 * Invariant 2, under a real editor.
 *
 * An untouched plan round-trips byte-identically and typing one character
 * changes exactly one line. `roundtrip.test.ts` covers the untouched half from
 * the parser's own output; this covers the *edited* half through the actual
 * ProseMirror document and the actual undo implementation, which is where the
 * drift the shell lane reported was hiding: type one character inside a
 * four-space-nested list, undo it, and autosave still rewrote the list's
 * indentation to two spaces.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getSchema } from "@tiptap/react";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import { editorExtensions } from "../editor/extensions";
import { alignSource, docToMarkdown, parseMarkdown } from "./index";

const schema = getSchema(editorExtensions);

interface EditResult {
  /** What a save would write while the character is still typed. */
  typed: string;
  /** What a save would write after undoing it. */
  undone: string;
  /** Lines that differ between the source and the typed save. */
  changed: number;
  /** Whether undo really restored the original ProseMirror document. */
  restored: boolean;
}

/** Type one character after `needle`, then undo it, exactly as the editor does. */
function typeThenUndo(markdown: string, needle: string): EditResult {
  const plan = parseMarkdown(markdown);
  const doc = schema.nodeFromJSON(plan.doc);
  alignSource(plan, doc.toJSON());

  let state = EditorState.create({ doc, plugins: [history()] });

  let pos = -1;
  state.doc.descendants((node, at) => {
    if (pos === -1 && node.isText && node.text?.includes(needle)) {
      pos = at + node.text.indexOf(needle) + needle.length;
    }
    return pos === -1;
  });
  if (pos < 0) throw new Error(`needle not found: ${needle}`);

  const tr = state.tr.insertText("X", pos);
  state = state.apply(tr.setSelection(TextSelection.create(tr.doc, pos + 1)));
  const typed = docToMarkdown(state.doc.toJSON(), { source: plan.source });

  undo(state, (t) => (state = state.apply(t)));

  return {
    typed,
    undone: docToMarkdown(state.doc.toJSON(), { source: plan.source }),
    changed: linesChanged(markdown, typed),
    restored: state.doc.eq(doc),
  };
}

function linesChanged(before: string, after: string): number {
  const a = before.split("\n");
  const b = after.split("\n");
  let n = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) n++;
  return n;
}

/** Every shape must survive both halves of the invariant. */
function expectStable(markdown: string, needle: string): EditResult {
  const result = typeThenUndo(markdown, needle);
  expect(result.restored).toBe(true);
  expect(result.undone).toBe(markdown);
  expect(result.changed).toBe(1);
  return result;
}

describe("the reported bug: nested list indentation", () => {
  const FOUR = "- one\n    - two\n";

  it("does not re-indent a four-space nested list when its parent is edited", () => {
    const { typed } = expectStable(FOUR, "one");
    expect(typed).toBe("- oneX\n    - two\n");
  });

  it("survives typing and undoing, byte for byte", () => {
    expect(typeThenUndo(FOUR, "one").undone).toBe(FOUR);
    expect(typeThenUndo(FOUR, "two").undone).toBe(FOUR);
  });

  it("keeps two- and three-space nesting as written", () => {
    expect(expectStable("- one\n  - two\n", "one").typed).toBe("- oneX\n  - two\n");
    expect(expectStable("- one\n   - two\n", "one").typed).toBe("- oneX\n   - two\n");
  });

  it("keeps the nesting width under an ordered parent", () => {
    expect(expectStable("1. one\n    - two\n", "one").typed).toBe(
      "1. oneX\n    - two\n",
    );
    expect(expectStable("1. one\n   - two\n", "one").typed).toBe(
      "1. oneX\n   - two\n",
    );
  });

  it("keeps every level of a deeply nested list", () => {
    const deep = "- a\n    - b\n        - c\n";
    expect(expectStable(deep, "b").typed).toBe("- a\n    - bX\n        - c\n");
    expect(expectStable(deep, "a").typed).toBe("- aX\n    - b\n        - c\n");
  });

  it("keeps a nested item's own wrapped continuation line", () => {
    const src = "- one\n    - two that is here\n      continued line\n";
    expect(expectStable(src, "one").typed).toBe(
      "- oneX\n    - two that is here\n      continued line\n",
    );
  });

  it("leaves sibling items alone when one of them is edited", () => {
    const src = "- one\n    - two\n    - three\n    - four\n";
    expect(expectStable(src, "three").typed).toBe(
      "- one\n    - two\n    - threeX\n    - four\n",
    );
  });
});

describe("list markers are the author's, not the serializer's", () => {
  it("keeps a * list as a * list", () => {
    expect(expectStable("* one\n* two\n* three\n", "two").typed).toBe(
      "* one\n* twoX\n* three\n",
    );
  });

  it("keeps * markers even when the edited item is the only one in its list", () => {
    expect(expectStable("* one\n  * two\n", "two").typed).toBe(
      "* one\n  * twoX\n",
    );
  });

  it("keeps + markers", () => {
    expect(expectStable("+ one\n  + two\n", "two").typed).toBe(
      "+ one\n  + twoX\n",
    );
  });

  it("keeps a nested list's own marker", () => {
    expect(expectStable("- one\n    * two\n", "one").typed).toBe(
      "- oneX\n    * two\n",
    );
  });

  it("does not renumber an ordered list", () => {
    expect(expectStable("1. one\n2. two\n3. three\n", "two").typed).toBe(
      "1. one\n2. twoX\n3. three\n",
    );
  });
});

describe("blank lines between list items", () => {
  it("keeps a loose list loose when one item is rebuilt", () => {
    expect(expectStable("- one\n\n- two\n\n- three\n", "two").typed).toBe(
      "- one\n\n- twoX\n\n- three\n",
    );
  });

  it("keeps a tight list tight", () => {
    expect(expectStable("- one\n- two\n- three\n", "two").typed).toBe(
      "- one\n- twoX\n- three\n",
    );
  });
});

describe("the real plan", () => {
  const PLAN = readFileSync(new URL("../../../../PLAN.md", import.meta.url), "utf8");

  for (const needle of ["worth it", "anchor-loss", "auto-commit"]) {
    it(`edit at ${JSON.stringify(needle)} touches one line and undoes cleanly`, () => {
      expectStable(PLAN, needle);
    });
  }

  it("survives an edit inside a table cell", () => {
    const plan =
      PLAN +
      "\n| Milestone | Scope             | Status |\n" +
      "| --------- | ----------------- | ------ |\n" +
      "| M3        | Tables, tracking  | Active |\n";
    const { typed, undone } = typeThenUndo(plan, "Active");
    expect(undone).toBe(plan);
    // The edited table is re-aligned as a unit; nothing outside it moves.
    expect(typed.split("\n").slice(0, -5).join("\n")).toBe(
      plan.split("\n").slice(0, -5).join("\n"),
    );
  });
});

describe("task list items", () => {
  it("survives a rebuild with its checkbox intact", () => {
    const src = "# T\n\n## Steps\n\n- [ ] first thing\n- [x] second thing\n- plain item\n";
    const parsed = parseMarkdown(src);
    // No source map: this is what a rebuilt (edited) list produces.
    expect(docToMarkdown(parsed.doc)).toBe(src);
  });

  it("keeps a task item on one line rather than splitting it", () => {
    const parsed = parseMarkdown("- [ ] do the thing\n");
    const out = docToMarkdown(parsed.doc);
    expect(out).not.toMatch(/\n\n/);
    expect(out.trim()).toBe("- [ ] do the thing");
  });

  it("never escapes the checkbox into literal brackets", () => {
    const out = docToMarkdown(parseMarkdown("- [x] done\n").doc);
    expect(out).not.toContain("\\[");
  });

  it("handles a checked and unchecked item in one list", () => {
    const src = "- [ ] a\n- [x] b\n";
    expect(docToMarkdown(parseMarkdown(src).doc)).toBe(src);
  });

  it("leaves ordinary bracketed text escaped", () => {
    const out = docToMarkdown(parseMarkdown("- see [note] here\n").doc);
    expect(out).toContain("\\[note\\]");
  });

  it("does not mistake a bracket mid-item for a checkbox", () => {
    const out = docToMarkdown(parseMarkdown("- do it [ ] now\n").doc);
    expect(out).toContain("\\[");
  });

  it("keeps nested task items nested", () => {
    const src = "- [ ] parent\n  - [x] child\n";
    expect(docToMarkdown(parseMarkdown(src).doc)).toBe(src);
  });

  it("preserves task items inside an ordered list", () => {
    const src = "1. [ ] first\n2. [x] second\n";
    expect(docToMarkdown(parseMarkdown(src).doc)).toBe(src);
  });
});
