import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { EditorState } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { alignSource, docToMarkdown, parseMarkdown } from "../markdown";
import { buildAcceptTransaction, createTrackingPlugin, trackedChanges } from "./plugin";
import { buildRevisionTransaction } from "./revision";
import { verifyPlan } from "../approve/verify";

const schema = getSchema([StarterKit]);
const PLAN = `# Untitled project

## Milestone 1 — The courier walks

1. Build the tile map loader from a Tiled export.
2. Add the courier sprite with four-direction movement.
3. Land the arrival trigger that ends the milestone.

## Milestone 2 — Something wants the parcel

- Add one roaming enemy with a simple chase.
- Resolve a contest when the enemy reaches the courier.
`;

/**
 * The whole chain the reviewer actually walks: an agent's rewrite lands as
 * tracked changes, Accept all takes them, and the verification pass looks at
 * what would be written.
 *
 * Before the husk fix this produced `2. ` and `- ` — two empty items in a plan
 * about to be approved and shattered into a board.
 */
describe("end to end: a real revision, accepted", () => {
  it("drops two steps and leaves a document the pass calls clean", () => {
    const revised = PLAN
      .replace("2. Add the courier sprite with four-direction movement.\n", "")
      .replace("- Resolve a contest when the enemy reaches the courier.\n", "");

    const plan = parseMarkdown(PLAN);
    const doc = schema.nodeFromJSON(plan.doc);
    alignSource(plan, doc.toJSON());
    let state = EditorState.create({ schema, doc, plugins: [createTrackingPlugin(true)] });
    const go = (tr: Transaction | null) => { if (tr) state = state.apply(tr); };

    go(buildRevisionTransaction(state, revised));
    go(buildAcceptTransaction(state, trackedChanges(state).map((c) => c.id)));

    const out = docToMarkdown(state.doc.toJSON(), { source: plan.source });

    expect(out).not.toMatch(/^[ \t]*(?:[-*+]|\d+\.)[ \t]*$/m);
    expect(verifyPlan(out)).toEqual([]);
    expect(out).toContain("Build the tile map loader");
    expect(out).toContain("Land the arrival trigger");
    expect(out).toContain("Add one roaming enemy");
    expect(out).not.toContain("four-direction");
    expect(out).not.toContain("Resolve a contest");
  });
});
