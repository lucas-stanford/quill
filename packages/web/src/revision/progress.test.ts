import { describe, expect, it } from "vitest";
import type { RevisionProgress } from "../types";
import { planAbsorb } from "./progress";

function input(over: Partial<Parameters<typeof planAbsorb>[0]> = {}) {
  return {
    progress: undefined as RevisionProgress | undefined,
    seenSeq: 0,
    sentComments: ["c1", "c2"],
    sentFeedback: ["f1"],
    closed: new Set<string>(),
    landed: null as string | null,
    ...over,
  };
}

describe("planAbsorb", () => {
  it("does nothing before the agent has reported anything", () => {
    expect(planAbsorb(input()).skip).toBe(true);
  });

  it("does nothing for the same report polled again", () => {
    const progress: RevisionProgress = { seq: 3, resolved: ["c1"] };

    expect(planAbsorb(input({ progress, seenSeq: 3 })).skip).toBe(true);
    expect(planAbsorb(input({ progress, seenSeq: 4 })).skip).toBe(true);
    expect(planAbsorb(input({ progress, seenSeq: 2 })).skip).toBe(false);
  });

  it("closes the notes the agent says it has dealt with, split by kind", () => {
    const plan = planAbsorb(input({ progress: { seq: 1, resolved: ["c2", "f1"] } }));

    expect(plan.comments).toEqual(["c2"]);
    expect(plan.feedback).toEqual(["f1"]);
  });

  it("ignores an id this brief never sent", () => {
    /*
     * The one mistake here that loses the reviewer's work rather than merely
     * looking wrong: closing a note nobody answered means it silently never
     * gets asked again.
     */
    const plan = planAbsorb(input({ progress: { seq: 1, resolved: ["c1", "ghost"] } }));

    expect(plan.comments).toEqual(["c1"]);
    expect(plan.feedback).toEqual([]);
  });

  it("never closes the same note twice", () => {
    // The list is cumulative on purpose — resending it whole every beat is the
    // easy thing for an agent to write.
    const plan = planAbsorb(
      input({ progress: { seq: 2, resolved: ["c1", "c2"] }, closed: new Set(["c1"]) }),
    );

    expect(plan.comments).toEqual(["c2"]);
  });

  it("tolerates a repeated id inside one report", () => {
    const plan = planAbsorb(input({ progress: { seq: 1, resolved: ["c1", "c1"] } }));

    expect(plan.comments).toEqual(["c1"]);
  });

  it("keeps the last line of commentary when a beat carries none", () => {
    // A beat that only ships a snapshot must not blank the sentence the one
    // before it set, or the pill flickers back to a generic label.
    expect(planAbsorb(input({ progress: { seq: 1, resolved: [], note: "Rewriting M2" } })).note).toBe(
      "Rewriting M2",
    );
    expect(planAbsorb(input({ progress: { seq: 1, resolved: [] } })).note).toBe(null);
    expect(planAbsorb(input({ progress: { seq: 1, resolved: [], note: "  " } })).note).toBe(null);
  });

  it("lands a snapshot the document does not already have", () => {
    expect(planAbsorb(input({ progress: { seq: 1, resolved: [], markdown: "# Half\n" } })).snapshot).toBe(
      "# Half\n",
    );
  });

  it("does not re-land the snapshot already showing", () => {
    // Re-landing would reject and re-apply identical text, throwing away the
    // reviewer's scroll position and any change they were mid-way through
    // walking, for no diff at all.
    const plan = planAbsorb(
      input({ progress: { seq: 2, resolved: [], markdown: "# Half\n" }, landed: "# Half\n" }),
    );

    expect(plan.snapshot).toBe(null);
    expect(plan.skip).toBe(false);
  });

  it("refuses an empty snapshot rather than blanking the document", () => {
    for (const markdown of ["", "   \n"]) {
      expect(planAbsorb(input({ progress: { seq: 1, resolved: [], markdown } })).snapshot).toBe(null);
    }
  });

  it("reports the sequence it acted on, so the next report is not replayed", () => {
    expect(planAbsorb(input({ progress: { seq: 7, resolved: [] } })).seq).toBe(7);
  });
});
