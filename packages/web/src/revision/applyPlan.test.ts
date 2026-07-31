import { describe, expect, it } from "vitest";
import { decideApply, normalizeMarkdown, sameDocument } from "./applyPlan";

const BEFORE = "# Plan\n\nShip the thing in one go.\n";
const AFTER = "# Plan\n\nShip the thing behind a flag, then remove the flag.\n";

describe("normalizeMarkdown", () => {
  it("ignores line endings and trailing space, which are not a difference", () => {
    expect(normalizeMarkdown("a\r\nb  \n")).toBe("a\nb");
    expect(sameDocument("# Plan\n", "# Plan\r\n\n")).toBe(true);
    expect(sameDocument("# Plan\n", "# Plans\n")).toBe(false);
  });
});

describe("decideApply", () => {
  it("applies the rewrite as tracked changes when nothing moved underneath it", () => {
    expect(
      decideApply({
        id: "r1",
        markdown: AFTER,
        appliedId: null,
        baseline: BEFORE,
        current: BEFORE,
      }),
    ).toEqual({ kind: "apply", markdown: AFTER });
  });

  it("never applies the same revision twice", () => {
    expect(
      decideApply({
        id: "r1",
        markdown: AFTER,
        appliedId: "r1",
        baseline: BEFORE,
        current: BEFORE,
      }),
    ).toEqual({ kind: "skip", reason: "already-applied" });
  });

  it("still applies a genuinely new revision after an earlier one", () => {
    expect(
      decideApply({
        id: "r2",
        markdown: AFTER,
        appliedId: "r1",
        baseline: BEFORE,
        current: BEFORE,
      }),
    ).toEqual({ kind: "apply", markdown: AFTER });
  });

  it("rebuilds when the attached-mode reload already put the rewrite on screen", () => {
    // The parent agent wrote PLAN.md, the M2 watcher fired, App reloaded the
    // document: the rewrite is in the page as plain text with nothing to
    // reject. Diffing it against itself would produce no tracked changes at
    // all, so the pre-revision document goes back first.
    expect(
      decideApply({
        id: "r1",
        markdown: AFTER,
        appliedId: null,
        baseline: BEFORE,
        current: AFTER,
      }),
    ).toEqual({ kind: "rebuild", baseline: BEFORE, markdown: AFTER });
  });

  it("does not care about whitespace when spotting that reload", () => {
    expect(
      decideApply({
        id: "r1",
        markdown: AFTER,
        appliedId: null,
        baseline: BEFORE,
        current: `${AFTER.trimEnd()}   \n\n`,
      }).kind,
    ).toBe("rebuild");
  });

  it("diffs against what is on screen when the file changed some other way", () => {
    // Someone edited PLAN.md in another window. Rejecting must restore what the
    // user can actually see, not a document they never had.
    const handEdited = "# Plan\n\nShip the thing in one go, on Friday.\n";
    expect(
      decideApply({
        id: "r1",
        markdown: AFTER,
        appliedId: null,
        baseline: BEFORE,
        current: handEdited,
      }),
    ).toEqual({ kind: "apply", markdown: AFTER });
  });

  it("reports an empty revision rather than blanking the document", () => {
    for (const markdown of [undefined, "", "   \n"]) {
      expect(
        decideApply({
          id: "r1",
          markdown,
          appliedId: null,
          baseline: BEFORE,
          current: BEFORE,
        }),
      ).toEqual({ kind: "empty" });
    }
  });
});
