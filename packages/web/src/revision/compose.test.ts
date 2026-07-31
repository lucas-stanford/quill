import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationsApi } from "../annotations";
import type { TrackedChangesApi } from "../tracking";
import type { RevisionBrief } from "../types";

const buildBrief = vi.fn(
  (
    _markdown: string,
    _annotations: AnnotationsApi,
    _tracking: TrackedChangesApi,
    instruction?: string,
  ): RevisionBrief => {
    // Mirrors the real one: the note goes in a field, nothing else derives
    // from it. That is the equivalence `withInstruction` relies on.
    const brief: RevisionBrief = { markdown: "brief", comments: [], edits: [] };
    if (instruction) brief.instruction = instruction;
    return brief;
  },
);

/*
 * `buildBrief` is faked so the wiring can be asserted; the formatter and the
 * emptiness predicate are the real ones, because "does an empty brief refuse
 * to render" is exactly the behaviour this module exists to handle.
 */
vi.mock("./buildBrief", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./buildBrief")>();
  return {
    ...actual,
    buildBrief: (
      markdown: string,
      annotations: AnnotationsApi,
      tracking: TrackedChangesApi,
      instruction?: string,
    ) => buildBrief(markdown, annotations, tracking, instruction),
  };
});

const { composeBrief, renderPrompt, withInstruction } = await import("./compose");

const annotations = { comments: [] } as unknown as AnnotationsApi;
const tracking = { changes: [] } as unknown as TrackedChangesApi;

const marked: RevisionBrief = {
  markdown: "# Plan\n\nShip it on Friday.\n",
  comments: [
    {
      quote: "Ship it on Friday",
      body: "Move this to Monday.",
      author: "You",
      replies: [],
      orphaned: false,
    },
  ],
  edits: [],
};

describe("composeBrief", () => {
  beforeEach(() => buildBrief.mockClear());

  it("hands the payload lane the document, the review markup and the note", () => {
    composeBrief("# Plan\n", annotations, tracking, "Tighten the rollout section.");
    expect(buildBrief).toHaveBeenCalledWith(
      "# Plan\n",
      annotations,
      tracking,
      "Tighten the rollout section.",
    );
  });

  it("returns what the payload lane built, untouched", () => {
    expect(composeBrief("# Plan\n", annotations, tracking)).toEqual({
      markdown: "brief",
      comments: [],
      edits: [],
    });
  });

  it("trims the note the user typed", () => {
    composeBrief("# Plan\n", annotations, tracking, "  add a rollback step  ");
    expect(buildBrief.mock.calls[0][3]).toBe("add a rollback step");
  });

  it.each([undefined, "", "   ", "\n\t "])(
    "drops an empty instruction rather than sending %j",
    (note) => {
      composeBrief("# Plan\n", annotations, tracking, note);
      expect(buildBrief.mock.calls[0][3]).toBeUndefined();
    },
  );
});

describe("withInstruction", () => {
  beforeEach(() => buildBrief.mockClear());

  it("attaches the note without rebuilding the brief", () => {
    const brief = composeBrief("# Plan\n", annotations, tracking);
    buildBrief.mockClear();

    const withNote = withInstruction(brief, "Add a rollback step.");

    expect(withNote.instruction).toBe("Add a rollback step.");
    expect(buildBrief).not.toHaveBeenCalled();
  });

  it("matches what a rebuild with the same note would have produced", () => {
    const memoized = withInstruction(
      composeBrief("# Plan\n", annotations, tracking),
      "  Add a rollback step.  ",
    );
    const rebuilt = composeBrief("# Plan\n", annotations, tracking, "Add a rollback step.");
    expect(memoized).toEqual(rebuilt);
  });

  it("leaves the memoized brief alone", () => {
    const brief = composeBrief("# Plan\n", annotations, tracking);
    withInstruction(brief, "Add a rollback step.");
    expect(brief.instruction).toBeUndefined();
  });

  it.each(["", "   ", "\n\t "])("treats %j as no instruction at all", (note) => {
    expect(withInstruction({ ...marked }, note).instruction).toBeUndefined();
  });

  it("drops a note that was there before", () => {
    const before = withInstruction(marked, "Move it to Monday.");
    expect(withInstruction(before, undefined)).not.toHaveProperty("instruction");
  });

  it("returns the same object when there is nothing to change", () => {
    expect(withInstruction(marked, undefined)).toBe(marked);
  });
});

describe("renderPrompt", () => {
  it("renders the prompt the CLI will send verbatim", () => {
    const prompt = renderPrompt(marked);
    expect(prompt).toBeTypeOf("string");
    expect(prompt).toContain("Move this to Monday.");
    expect(prompt).toContain("Ship it on Friday");
  });

  it("refuses an empty brief instead of throwing", () => {
    expect(renderPrompt({ markdown: "# Plan\n", comments: [], edits: [] })).toBeNull();
  });

  it("an instruction on its own is worth sending", () => {
    const prompt = renderPrompt({
      markdown: "# Plan\n",
      comments: [],
      edits: [],
      instruction: "Tighten the rollout section.",
    });
    expect(prompt).toContain("Tighten the rollout section.");
  });
});
