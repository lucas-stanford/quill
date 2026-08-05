import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { alignSource, docToMarkdown, parseMarkdown } from "../markdown";
import {
  buildAcceptTransaction,
  buildDeletionTransaction,
  buildRejectTransaction,
  createTrackingPlugin,
  trackedChanges,
} from "./plugin";
import { buildRevisionTransaction, scanBlocks } from "./revision";

/**
 * These tests run the real editor pipeline headlessly: the same StarterKit
 * schema `usePlanEditor` builds, the same parse/serialize pair `App` autosaves
 * through, and the real tracking plugin. What they are here to prove is the
 * pair of load-bearing invariants from CONTRACT.md — that tracked changes never
 * reach `PLAN.md` (2), and that rejecting an AI revision restores the document
 * byte for byte (4).
 */

const schema = getSchema([StarterKit]);
const PLAN = readFileSync(new URL("../../../../PLAN.md", import.meta.url), "utf8");

function harness(markdown: string) {
  const plan = parseMarkdown(markdown);
  const doc = schema.nodeFromJSON(plan.doc);
  // Mirrors usePlanEditor: re-key the source map against ProseMirror's own view
  // of the document, which is what keeps untouched blocks verbatim.
  alignSource(plan, doc.toJSON());

  const plugin = createTrackingPlugin(true);
  let state = EditorState.create({ schema, doc, plugins: [plugin] });

  const apply = (tr: Transaction | null) => {
    if (tr) state = state.apply(tr);
    return tr;
  };

  // Just enough EditorView for the plugin's own input handlers.
  const view = {
    get state() {
      return state;
    },
    dispatch: apply,
  } as unknown as EditorView;

  return {
    get state() {
      return state;
    },
    /** Exactly what `App` would autosave to disk right now. */
    markdown: () => docToMarkdown(state.doc.toJSON(), { source: plan.source }),
    changes: () => trackedChanges(state),
    dispatch: apply,
    select(from: number, to: number) {
      apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
    },
    /** Press a key the way the browser would, through the plugin's handler. */
    press(key: string, modifiers: Record<string, boolean> = {}): boolean {
      const event = {
        key,
        altKey: false,
        metaKey: false,
        ctrlKey: false,
        ...modifiers,
      } as unknown as KeyboardEvent;
      return plugin.props.handleKeyDown?.call(plugin, view, event) === true;
    },
    /** Type text the way the browser would, through the plugin's handler. */
    type(text: string): boolean {
      const { from, to } = state.selection;
      const handled =
        plugin.props.handleTextInput?.call(
          plugin,
          view,
          from,
          to,
          text,
          () => state.tr,
        ) === true;
      if (!handled) apply(state.tr.insertText(text, from, to));
      return handled;
    },
  };
}

type Harness = ReturnType<typeof harness>;

function idsOf(h: Harness, author?: "human" | "ai"): string[] {
  return h
    .changes()
    .filter((change) => author === undefined || change.author === author)
    .map((change) => change.id);
}

function differingLines(before: string, after: string): number {
  const a = before.split("\n");
  const b = after.split("\n");
  let count = Math.abs(a.length - b.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) count++;
  }
  return count;
}

/** Position of the nth character of the first block whose text contains `needle`. */
function positionIn(h: Harness, needle: string, offsetInMatch = 0): number {
  for (const block of scanBlocks(h.state.doc)) {
    const at = block.text.indexOf(needle);
    if (at === -1) continue;
    const target = at + offsetInMatch;
    for (const segment of block.segments) {
      const length = segment.to - segment.from;
      if (target <= segment.offset + length) {
        return segment.from + (target - segment.offset);
      }
    }
  }
  throw new Error(`no block contains ${JSON.stringify(needle)}`);
}

/** Every mark type present anywhere in a document, sorted and de-duplicated. */
function markTypes(json: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: any): void => {
    if (!node || typeof node !== "object") return;
    for (const mark of node.marks ?? []) found.add(mark.type);
    for (const child of node.content ?? []) walk(child);
  };
  walk(json);
  return [...found].sort();
}

/** Indices of the lines that differ between two files. */
function changedLines(before: string, after: string): number[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const out: number[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) out.push(i);
  }
  return out;
}

describe("serialisation is untouched by tracking", () => {
  it("round-trips the real PLAN.md byte for byte before anything happens", () => {
    expect(harness(PLAN).markdown()).toBe(PLAN);
  });

  it("a pending deletion changes nothing on disk — the text is still there", () => {
    const h = harness(PLAN);
    const before = h.markdown();
    const from = positionIn(h, "wall of scrollback");
    const to = from + "wall of scrollback".length;

    h.dispatch(buildDeletionTransaction(h.state, from, to, "human", "start"));

    expect(h.changes()).toEqual([
      expect.objectContaining({
        author: "human",
        kind: "deletion",
        text: "wall of scrollback",
      }),
    ]);
    expect(h.state.doc.textBetween(from, to)).toBe("wall of scrollback");
    expect(h.markdown()).toBe(before);
  });

  it("accepting that deletion is what finally edits the file", () => {
    const h = harness(PLAN);
    const before = h.markdown();
    const from = positionIn(h, "wall of scrollback");
    const to = from + "wall of scrollback".length;

    h.dispatch(buildDeletionTransaction(h.state, from, to, "human", "start"));
    h.dispatch(buildAcceptTransaction(h.state, idsOf(h)));

    const after = h.markdown();
    expect(after).not.toBe(before);
    expect(after).not.toContain("wall of scrollback");
    expect(h.changes()).toEqual([]);
    expect(before.split("\n").length).toBe(after.split("\n").length);
  });

  it("rejecting that deletion restores the file byte for byte", () => {
    const h = harness(PLAN);
    const before = h.markdown();
    const from = positionIn(h, "wall of scrollback");
    const to = from + "wall of scrollback".length;

    h.dispatch(buildDeletionTransaction(h.state, from, to, "human", "start"));
    h.dispatch(buildRejectTransaction(h.state, idsOf(h)));

    expect(h.markdown()).toBe(before);
    expect(h.changes()).toEqual([]);
  });

  it("typing one character while tracking changes exactly one line", () => {
    const h = harness(PLAN);
    const before = h.markdown();
    const pos = positionIn(h, "Shape of the thing", "Shape of the thing".length);

    h.dispatch(h.state.tr.insertText("!", pos));

    const after = h.markdown();
    expect(differingLines(before, after)).toBe(1);
    expect(after).toContain("## Shape of the thing!");
    expect(h.changes()).toEqual([
      expect.objectContaining({ author: "human", kind: "insertion", text: "!" }),
    ]);
  });

  it("typing inside a wrapped paragraph never reflows the rest of the file", () => {
    const h = harness(PLAN);
    const before = h.markdown();
    const pos = positionIn(h, "Plans are prose documents");

    h.dispatch(h.state.tr.insertText("X", pos));

    const after = h.markdown();
    const a = before.split("\n");
    const b = after.split("\n");
    expect(b.length).toBe(a.length);

    // Every differing line belongs to the one paragraph that was edited.
    const differing = a
      .map((line, i) => (line === b[i] ? -1 : i))
      .filter((i) => i >= 0);
    expect(differing.length).toBeGreaterThan(0);
    const span = differing[differing.length - 1] - differing[0] + 1;
    expect(span).toBeLessThanOrEqual(6);
  });

  it("never writes tracking metadata into the markdown", () => {
    const h = harness(PLAN);
    const markTypesBefore = markTypes(h.state.doc.toJSON());
    const pos = positionIn(h, "Plans are prose documents");
    h.dispatch(h.state.tr.insertText("X", pos));
    h.dispatch(
      buildDeletionTransaction(
        h.state,
        positionIn(h, "wall of scrollback"),
        positionIn(h, "wall of scrollback") + 4,
        "human",
        "start",
      ),
    );

    const markdown = h.markdown();
    expect(markdown).not.toMatch(/quill-tc|data-change-id|<ins\b|<del\b/);
    // Tracked changes are decorations, so the document gains no new mark types
    // at all — there is nothing for the serialiser to trip over.
    expect(markTypes(h.state.doc.toJSON())).toEqual(markTypesBefore);
  });
});

describe("recording edits", () => {
  it("strikes a selection on Backspace instead of deleting it", () => {
    const h = harness(PLAN);
    const before = h.markdown();
    const from = positionIn(h, "wall of scrollback");
    h.select(from, from + "wall of scrollback".length);

    expect(h.press("Backspace")).toBe(true);

    expect(h.changes()).toEqual([
      expect.objectContaining({
        author: "human",
        kind: "deletion",
        text: "wall of scrollback",
      }),
    ]);
    expect(h.state.doc.textBetween(from, from + 18)).toBe("wall of scrollback");
    expect(h.markdown()).toBe(before);
  });

  it("strikes the character behind the caret on Backspace", () => {
    const h = harness(PLAN);
    const before = h.markdown();
    const at = positionIn(h, "scrollback", "scrollback".length);
    h.select(at, at);

    expect(h.press("Backspace")).toBe(true);

    expect(h.changes()).toEqual([
      expect.objectContaining({ kind: "deletion", text: "k" }),
    ]);
    expect(h.markdown()).toBe(before);
  });

  it("strikes the old words and inserts the new ones when you type over a selection", () => {
    const h = harness(PLAN);
    const from = positionIn(h, "wall of scrollback");
    h.select(from, from + "wall of scrollback".length);

    expect(h.type("mess")).toBe(true);

    expect(h.changes()).toEqual([
      expect.objectContaining({ kind: "deletion", text: "wall of scrollback" }),
      expect.objectContaining({ kind: "insertion", text: "mess" }),
    ]);
    expect(h.state.doc.textContent).toContain("wall of scrollbackmess");
  });

  it("fuses a typed run into one change rather than one per keystroke", () => {
    const h = harness(PLAN);
    let pos = positionIn(h, "Plans are prose documents");
    for (const char of "hello") {
      h.dispatch(h.state.tr.insertText(char, pos));
      pos += 1;
    }
    expect(h.changes()).toEqual([
      expect.objectContaining({ kind: "insertion", text: "hello" }),
    ]);
  });

  it("really removes your own pending insertion instead of striking it", () => {
    const h = harness(PLAN);
    const before = h.markdown();
    const pos = positionIn(h, "Plans are prose documents");

    h.dispatch(h.state.tr.insertText("hello", pos));
    expect(h.changes()).toHaveLength(1);

    h.dispatch(buildDeletionTransaction(h.state, pos, pos + 5, "human", "start"));

    expect(h.changes()).toEqual([]);
    expect(h.markdown()).toBe(before);
  });

  it("drops pending changes when the document is reloaded underneath them", () => {
    const h = harness(PLAN);
    const pos = positionIn(h, "Plans are prose documents");
    h.dispatch(h.state.tr.insertText("X", pos));
    expect(h.changes()).toHaveLength(1);

    const replacement = schema.nodeFromJSON(parseMarkdown("# Other\n\nText.\n").doc);
    h.dispatch(
      h.state.tr
        .replaceWith(0, h.state.doc.content.size, replacement.content)
        .setMeta("preventUpdate", true),
    );

    expect(h.changes()).toEqual([]);
  });
});

describe("applyRevision — list items stay separate steps", () => {
  const STEPS = `# Plan

## M1 — Ride in

1. Add a fallback branch where no match exists.
2. Add Greek and mystical props to the shrine.
3. Wire the reputation system to the outcome.
`;

  /**
   * The bug this is here to keep dead.
   *
   * `scanBlocks` used to hand the diff one block per top-level node, so an
   * ordered list arrived as a single run of text in which "…exists." and "Add
   * Greek…" were adjacent characters. The word tokenizer paired them, the diff
   * emitted one edit spanning both items, and accepting it deleted across the
   * boundary — which in ProseMirror is a join. Two steps became one item.
   *
   * It survived to an approved plan and cost three tickets that were never
   * created. Nothing about it is theoretical.
   */
  it("a reworded step does not swallow the step after it", () => {
    const revised = STEPS.replace(
      "1. Add a fallback branch where no match exists.",
      "1. Add a fallback branch where no match is found.",
    );

    const h = harness(STEPS);
    h.dispatch(buildRevisionTransaction(h.state, revised));
    h.dispatch(buildAcceptTransaction(h.state, idsOf(h)));

    const out = h.markdown();
    expect(out).toContain("1. Add a fallback branch where no match is found.");
    expect(out).toContain("2. Add Greek and mystical props to the shrine.");
    expect(out).toContain("3. Wire the reputation system to the outcome.");
    // The join showed up as two sentences with no space between them.
    expect(out).not.toMatch(/\.\S/);
  });

  it("keeps three list items as three list items", () => {
    const revised = STEPS.replace("the shrine", "the roadside shrine");

    const h = harness(STEPS);
    h.dispatch(buildRevisionTransaction(h.state, revised));
    h.dispatch(buildAcceptTransaction(h.state, idsOf(h)));

    const list = h.state.doc.child(2);
    expect(list.type.name).toBe("orderedList");
    expect(list.childCount).toBe(3);
  });

  it("deleting one step leaves the others whole", () => {
    const revised = STEPS.replace("2. Add Greek and mystical props to the shrine.\n", "");

    const h = harness(STEPS);
    h.dispatch(buildRevisionTransaction(h.state, revised));
    h.dispatch(buildAcceptTransaction(h.state, idsOf(h)));

    const out = h.markdown();
    expect(out).toContain("Add a fallback branch where no match exists.");
    expect(out).toContain("Wire the reputation system to the outcome.");
    expect(out).not.toContain("mystical props");
    expect(out).not.toMatch(/\.\S/);
  });

  it("a human striking across two steps still accepts as two steps", () => {
    // The reviewer's own selection can span items even when the diff's cannot:
    // drag from the middle of step 1 into step 2 and press Backspace. Accepting
    // that must not join them either, which is why the guard also lives at the
    // point of deletion and not only in how the diff is built.
    const h = harness(STEPS);
    const doc = h.state.doc;
    const list = doc.child(2);
    const listStart = 0 + doc.child(0).nodeSize + doc.child(1).nodeSize;
    const first = listStart + 1;
    const firstText = first + 2;
    // From inside step 1 to inside step 2, straight across the boundary.
    const from = firstText + 10;
    const to = from + list.child(0).nodeSize;

    h.dispatch(buildDeletionTransaction(h.state, from, to, "human", "end"));
    expect(h.changes().length).toBeGreaterThan(0);
    h.dispatch(buildAcceptTransaction(h.state, idsOf(h)));

    const after = h.state.doc.child(2);
    expect(after.type.name).toBe("orderedList");
    // Both struck items keep the text outside the strike, so all three items
    // survive. Two would mean the pair had been fused into one step.
    expect(after.childCount).toBe(3);
    expect(h.markdown()).toContain("Wire the reputation system to the outcome.");
  });

  it("the diff sees a list as one line per item, not one run of text", () => {
    const h = harness(STEPS);
    const list = scanBlocks(h.state.doc).find((b) => b.type === "orderedList");

    expect(list).toBeDefined();
    // Without the separator the tokenizer cannot tell where a step ends.
    expect(list!.text.split("\n")).toEqual([
      "Add a fallback branch where no match exists.",
      "Add Greek and mystical props to the shrine.",
      "Wire the reputation system to the outcome.",
    ]);
  });
});

describe("applyRevision", () => {
  const oneSentence = PLAN.replace(
    "Reviewing an agent's plan in a terminal is bad.",
    "Reviewing an agent's plan in a terminal is miserable.",
  );

  it("turns a one-word rewrite into one insertion and one deletion", () => {
    const h = harness(PLAN);
    h.dispatch(buildRevisionTransaction(h.state, oneSentence));

    expect(h.changes()).toEqual([
      expect.objectContaining({ author: "ai", kind: "deletion", text: "bad" }),
      expect.objectContaining({
        author: "ai",
        kind: "insertion",
        text: "miserable",
      }),
    ]);
  });

  it("leaves the rest of the document alone", () => {
    const h = harness(PLAN);
    const before = h.markdown();
    h.dispatch(buildRevisionTransaction(h.state, oneSentence));

    const after = h.markdown();
    // The struck word is still on the page next to its replacement, and only
    // the paragraph that changed is rewritten: the file does not grow or shrink
    // and the touched lines are one contiguous run inside that paragraph.
    expect(after).toContain("miserable");
    expect(after).toContain("bad");
    expect(after.split("\n").length).toBe(before.split("\n").length);

    const touched = changedLines(before, after);
    const span = touched[touched.length - 1] - touched[0] + 1;
    expect(span).toBeLessThanOrEqual(5);
    expect(touched[0]).toBeGreaterThanOrEqual(4);
  });

  it("does nothing at all when the revision is the same document", () => {
    const h = harness(PLAN);
    expect(buildRevisionTransaction(h.state, PLAN)).toBeNull();
    expect(h.changes()).toEqual([]);
  });

  it("accepting the revision produces the revised document", () => {
    const h = harness(PLAN);
    h.dispatch(buildRevisionTransaction(h.state, oneSentence));
    h.dispatch(buildAcceptTransaction(h.state, idsOf(h)));

    expect(h.state.doc.textContent).toContain(
      "Reviewing an agent's plan in a terminal is miserable.",
    );
    expect(h.state.doc.textContent).not.toContain("terminal is bad");
    expect(h.changes()).toEqual([]);
  });

  it("INVARIANT 4: rejecting every AI change restores the document exactly", () => {
    const h = harness(PLAN);
    const before = h.markdown();
    const beforeDoc = JSON.stringify(h.state.doc.toJSON());

    h.dispatch(buildRevisionTransaction(h.state, oneSentence));
    expect(h.changes().length).toBeGreaterThan(0);

    h.dispatch(buildRejectTransaction(h.state, idsOf(h, "ai")));

    expect(h.markdown()).toBe(before);
    expect(JSON.stringify(h.state.doc.toJSON())).toBe(beforeDoc);
    expect(h.changes()).toEqual([]);
  });

  it("INVARIANT 4 holds for a revision that rewrites, deletes and adds", () => {
    const brutal = PLAN
      // a sentence rewritten in place
      .replace(
        "Reviewing an agent's plan in a terminal is bad.",
        "Reviewing an agent's plan in a terminal is miserable and slow.",
      )
      // a whole paragraph removed
      .replace(
        "Quill moves plan review into a document surface that behaves like Word on the web, while\nkeeping the trigger and the source of truth in the CLI.\n\n",
        "",
      )
      // a whole paragraph added
      .replace(
        "## Principles",
        "## Principles\n\nEvery principle below is load-bearing and was learned the hard way.",
      )
      // a list item reworded
      .replace("Multiplayer / real-time collaboration.", "Multiplayer editing.");

    const h = harness(PLAN);
    const before = h.markdown();
    const beforeDoc = JSON.stringify(h.state.doc.toJSON());

    h.dispatch(buildRevisionTransaction(h.state, brutal));

    const changes = h.changes();
    expect(changes.length).toBeGreaterThan(3);
    expect(changes.every((change) => change.author === "ai")).toBe(true);
    expect(changes.some((change) => change.kind === "insertion")).toBe(true);
    expect(changes.some((change) => change.kind === "deletion")).toBe(true);

    h.dispatch(buildRejectTransaction(h.state, idsOf(h, "ai")));

    expect(h.markdown()).toBe(before);
    expect(JSON.stringify(h.state.doc.toJSON())).toBe(beforeDoc);
    expect(h.changes()).toEqual([]);
  });

  it("rejectAll('ai') keeps the human's own edits", () => {
    const h = harness(PLAN);
    const pos = positionIn(h, "Plans are prose documents");
    h.dispatch(h.state.tr.insertText("XYZ", pos));
    const mine = h.changes();

    h.dispatch(buildRevisionTransaction(h.state, oneSentence));
    h.dispatch(buildRejectTransaction(h.state, idsOf(h, "ai")));

    expect(h.changes()).toEqual(mine);
    expect(h.state.doc.textContent).toContain("XYZ");
    expect(h.state.doc.textContent).toContain("terminal is bad");
  });
});
