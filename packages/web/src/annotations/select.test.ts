import { describe, expect, it } from "vitest";
import type { Comment } from "../types";
import { mergeRemoteComments, orderComments, selectForBrief, selectOrphans } from "./select";

function comment(overrides: Partial<Comment> & { id: string }): Comment {
  return {
    anchor: { quote: overrides.id, prefix: "", suffix: "" },
    author: "You",
    body: `body ${overrides.id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    resolved: false,
    replies: [],
    ...overrides,
  };
}

describe("orderComments", () => {
  it("sorts by document position, not creation time", () => {
    const a = comment({ id: "a", createdAt: "2026-01-01T00:00:03.000Z" });
    const b = comment({ id: "b", createdAt: "2026-01-01T00:00:01.000Z" });
    const at: Record<string, number> = { a: 10, b: 400 };

    const ordered = orderComments([b, a], (c) => at[c.id]);

    expect(ordered.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("puts orphans last and breaks ties by creation time", () => {
    const a = comment({ id: "a", createdAt: "2026-01-01T00:00:02.000Z" });
    const b = comment({ id: "b", createdAt: "2026-01-01T00:00:01.000Z" });
    const lost = comment({ id: "lost", orphaned: true });
    const at: Record<string, number> = { a: 10, b: 10 };

    const ordered = orderComments([lost, a, b], (c) => at[c.id]);

    expect(ordered.map((c) => c.id)).toEqual(["b", "a", "lost"]);
  });
});

describe("selectForBrief", () => {
  it("excludes resolved threads", () => {
    const open = comment({ id: "open" });
    const done = comment({ id: "done", resolved: true });

    expect(selectForBrief([open, done]).map((c) => c.id)).toEqual(["open"]);
  });

  it("keeps orphans — the instruction stands even when its text moved", () => {
    const lost = comment({ id: "lost", orphaned: true });
    const doneAndLost = comment({ id: "doneAndLost", orphaned: true, resolved: true });

    expect(selectForBrief([lost, doneAndLost]).map((c) => c.id)).toEqual(["lost"]);
  });

  it("preserves the order it was given", () => {
    const ordered = [comment({ id: "a" }), comment({ id: "b" }), comment({ id: "c" })];

    expect(selectForBrief(ordered).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
});

describe("selectOrphans", () => {
  it("returns only comments flagged orphaned", () => {
    const anchored = comment({ id: "anchored", orphaned: false });
    const legacy = comment({ id: "legacy" });
    const lost = comment({ id: "lost", orphaned: true });

    expect(selectOrphans([anchored, legacy, lost]).map((c) => c.id)).toEqual(["lost"]);
  });
});

describe("mergeRemoteComments", () => {
  it("returns null when the sidecar holds nothing new", () => {
    const local = [comment({ id: "a" }), comment({ id: "b" })];
    const remote = [comment({ id: "a", body: "stale copy" })];

    expect(mergeRemoteComments(remote, local)).toBeNull();
  });

  it("adopts threads this session never saw instead of overwriting them", () => {
    const local = [comment({ id: "mine" })];
    const remote = [comment({ id: "mine", body: "stale copy" }), comment({ id: "theirs" })];

    const merged = mergeRemoteComments(remote, local);

    expect(merged?.map((c) => c.id)).toEqual(["mine", "theirs"]);
    expect(merged?.[0]?.body).toBe("body mine");
  });

  it("does not resurrect a comment deleted in this session", () => {
    const local = [comment({ id: "mine" })];
    const remote = [comment({ id: "binned" })];

    expect(mergeRemoteComments(remote, local, new Set(["binned"]))).toBeNull();
  });
});
