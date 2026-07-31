import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationsApi } from "../annotations";
import type { TrackedChangesApi } from "../tracking";

const buildBrief = vi.fn(
  (
    _markdown: string,
    _annotations: AnnotationsApi,
    _tracking: TrackedChangesApi,
    _instruction?: string,
  ) => ({ markdown: "brief", comments: [], edits: [] }),
);
vi.mock("./buildBrief", () => ({
  buildBrief: (
    markdown: string,
    annotations: AnnotationsApi,
    tracking: TrackedChangesApi,
    instruction?: string,
  ) => buildBrief(markdown, annotations, tracking, instruction),
}));

const { composeBrief } = await import("./compose");

const annotations = { comments: [] } as unknown as AnnotationsApi;
const tracking = { changes: [] } as unknown as TrackedChangesApi;

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
