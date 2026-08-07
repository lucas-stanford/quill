/**
 * Undo, under a real editor.
 *
 * Two halves, and they pull in opposite directions.
 *
 * The reviewer's own replacements — taking a name from a poll — must be
 * undoable: they are made from a control outside the document, so the caret is
 * not in the page and ProseMirror's own Mod-Z never sees the key. That is what
 * `useUndoRedo` is for, and `classifyUndoKey` is the part of it worth pinning,
 * because a shortcut table is easy to get subtly wrong across platforms.
 *
 * An external reload — the agent rewriting the file underneath us — must NOT
 * be undoable. Undo would restore a document the file no longer has, and
 * autosave would then write it back over the top of the agent's work. So the
 * load carries `addToHistory: false` and this file proves the two loads
 * behave differently through the actual history plugin.
 */

import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/react";
import { EditorState } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import { editorExtensions } from "./extensions";
import { classifyUndoKey } from "./useUndoRedo";
import { alignSource, docToMarkdown, parseMarkdown } from "../markdown";
import { applyChoice } from "../options/apply";

const schema = getSchema(editorExtensions);

const PLAN = `# Untitled project

Vera rides west across a dying empire.

## Milestone 1 — The courier walks

1. Build the tile map loader.
2. Add the courier sprite.
`;

interface Loaded {
  state: EditorState;
  source: ReturnType<typeof parseMarkdown>["source"];
}

function open(markdown: string): Loaded {
  const plan = parseMarkdown(markdown);
  const doc = schema.nodeFromJSON(plan.doc);
  alignSource(plan, doc.toJSON());
  return { state: EditorState.create({ doc, plugins: [history()] }), source: plan.source };
}

/**
 * What `usePlanEditor`'s effect does for one load. `undoable` is the flag the
 * hook sets on the transaction; everything else is the same code path.
 */
function load(open2: Loaded, markdown: string, undoable: boolean): Loaded {
  const plan = parseMarkdown(markdown);
  const doc = schema.nodeFromJSON(plan.doc);
  const tr = open2.state.tr.replaceWith(0, open2.state.doc.content.size, doc.content);
  tr.setMeta("addToHistory", undoable);
  const next = open2.state.apply(tr);
  alignSource(plan, next.doc.toJSON());
  return { state: next, source: plan.source };
}

function serialize(loaded: Loaded): string {
  return docToMarkdown(loaded.state.doc.toJSON(), { source: loaded.source });
}

describe("undo across a programmatic load", () => {
  it("takes back a name the reviewer took, byte for byte", () => {
    const opened = open(PLAN);
    const renamed = applyChoice(PLAN, { kind: "title" }, "Palaver");
    expect(renamed).not.toBe(PLAN);

    const after = load(opened, renamed, true);
    expect(serialize(after)).toBe(renamed);

    let state = after.state;
    expect(undo(state, (t) => (state = state.apply(t)))).toBe(true);

    // Not merely "something changed": the document that comes back has to be
    // the one that went in, or the undo has quietly rewritten the file.
    expect(docToMarkdown(state.doc.toJSON(), { source: after.source })).toBe(PLAN);
  });

  it("takes back a rename of a character the same way", () => {
    const opened = open(PLAN);
    const renamed = applyChoice(PLAN, { kind: "text", value: "Vera" }, "Juno");
    expect(renamed).toContain("Juno rides west");

    const after = load(opened, renamed, true);
    let state = after.state;
    undo(state, (t) => (state = state.apply(t)));

    expect(docToMarkdown(state.doc.toJSON(), { source: after.source })).toBe(PLAN);
  });

  it("refuses to undo somebody else's write", () => {
    /*
     * The agent rewrote the file. Undo here would restore a document the file
     * no longer has, and autosave would put it back over the agent's work —
     * so there must be nothing on the stack to undo.
     */
    const opened = open(PLAN);
    const external = PLAN.replace("Vera rides west", "Vera rides east");

    const after = load(opened, external, false);
    let state = after.state;

    expect(undo(state, (t) => (state = state.apply(t)))).toBe(false);
    expect(docToMarkdown(state.doc.toJSON(), { source: after.source })).toBe(external);
  });

  it("still undoes the reviewer's own edit made before an external reload", () => {
    // The external load must be invisible to history, not a barrier that
    // swallows what the reviewer did before it.
    const opened = open(PLAN);
    const mine = load(opened, applyChoice(PLAN, { kind: "title" }, "Palaver"), true);
    const theirs = load(mine, applyChoice(PLAN, { kind: "title" }, "Palaver") + "\nAdded.\n", false);

    let state = theirs.state;
    expect(undo(state, (t) => (state = state.apply(t)))).toBe(true);
    expect(docToMarkdown(state.doc.toJSON(), { source: theirs.source })).toBe(PLAN);
  });
});

describe("classifyUndoKey", () => {
  const key = (over: Partial<Parameters<typeof classifyUndoKey>[0]>) =>
    classifyUndoKey({ key: "z", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over });

  it("reads undo on either platform's modifier", () => {
    expect(key({ metaKey: true })).toEqual({ undo: true, redo: false });
    expect(key({ ctrlKey: true })).toEqual({ undo: true, redo: false });
  });

  it("reads redo from shift, and from Ctrl+Y", () => {
    expect(key({ metaKey: true, shiftKey: true })).toEqual({ undo: false, redo: true });
    expect(key({ key: "y", ctrlKey: true })).toEqual({ undo: false, redo: true });
  });

  it("ignores the key with no modifier", () => {
    // Otherwise typing "z" in the document would undo it.
    expect(key({})).toEqual({ undo: false, redo: false });
  });

  it("ignores it when Alt is held", () => {
    // Alt+Z is a different shortcut, and claiming it would break it.
    expect(key({ metaKey: true, altKey: true })).toEqual({ undo: false, redo: false });
  });

  it("reads an uppercase Z, which is what Shift actually reports", () => {
    expect(key({ key: "Z", metaKey: true, shiftKey: true })).toEqual({ undo: false, redo: true });
  });

  it("ignores an unrelated key held with the modifier", () => {
    expect(key({ key: "s", metaKey: true })).toEqual({ undo: false, redo: false });
  });
});
