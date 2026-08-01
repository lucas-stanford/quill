import { describe, expect, it } from "vitest";
import type { TrackedChange } from "../tracking";
import { bulkAnnouncement, summarizeChanges } from "./reviewSummary";

let seq = 0;
function change(author: "ai" | "human", kind: "insertion" | "deletion" = "insertion"): TrackedChange {
  seq += 1;
  return { id: `c${seq}`, author, kind, text: "text" };
}

describe("summarizeChanges", () => {
  it("counts nothing when there is nothing, so the bar can park itself", () => {
    const summary = summarizeChanges([]);
    expect(summary.total).toBe(0);
    expect(summary.authorLabel).toBeNull();
  });

  it("counts by author and by kind", () => {
    const summary = summarizeChanges([
      change("ai", "insertion"),
      change("ai", "deletion"),
      change("ai", "insertion"),
      change("human", "deletion"),
    ]);
    expect(summary.total).toBe(4);
    expect(summary.ai).toBe(3);
    expect(summary.human).toBe(1);
    expect(summary.insertions).toBe(2);
    expect(summary.deletions).toBe(2);
    expect(summary.countLabel).toBe("4 changes");
    expect(summary.kindLabel).toBe("2 insertions, 2 deletions");
  });

  it("says '1 change', never '1 changes'", () => {
    expect(summarizeChanges([change("ai")]).countLabel).toBe("1 change");
  });

  it("scopes Reject all to the AI when the reviewer has edits of their own", () => {
    const summary = summarizeChanges([change("ai"), change("ai"), change("human")]);
    expect(summary.rejectAuthor).toBe("ai");
    expect(summary.rejectLabel).toBe("Reject all AI changes");
    expect(summary.rejectHint).toMatch(/your own edits are kept/i);
    expect(summary.authorLabel).toBe("2 from the AI");
  });

  it("rejects everything, and says so plainly, when it is all one author", () => {
    const aiOnly = summarizeChanges([change("ai"), change("ai")]);
    expect(aiOnly.rejectAuthor).toBeUndefined();
    expect(aiOnly.rejectLabel).toBe("Reject all");
    expect(aiOnly.authorLabel).toBe("from the AI");

    const humanOnly = summarizeChanges([change("human")]);
    expect(humanOnly.rejectAuthor).toBeUndefined();
    expect(humanOnly.rejectLabel).toBe("Reject all");
    expect(humanOnly.authorLabel).toBeNull();
  });

  it("warns that Accept all is not scoped, since acceptAll cannot be", () => {
    const summary = summarizeChanges([change("ai"), change("human")]);
    expect(summary.acceptHint).toMatch(/the AI's and your own/i);
  });

  /*
   * An external reload (attached mode) can leave a range mapped onto itself.
   * There is nothing highlighted and nowhere for next/previous to go, so the
   * bar must not claim there is something to review.
   */
  it("ignores zero-width changes, which have nothing to review", () => {
    const phantom: TrackedChange = { id: "p1", author: "human", kind: "insertion", text: "" };
    expect(summarizeChanges([phantom]).total).toBe(0);

    const summary = summarizeChanges([change("ai"), phantom]);
    expect(summary.total).toBe(1);
    expect(summary.ai).toBe(1);
    expect(summary.human).toBe(0);
    // ...and with no real edit of the reviewer's, Reject all is not scoped.
    expect(summary.rejectAuthor).toBeUndefined();
  });

  it("keeps a change that is only whitespace — deleting a space is a change", () => {
    const space: TrackedChange = { id: "s1", author: "ai", kind: "deletion", text: " " };
    expect(summarizeChanges([space]).total).toBe(1);
  });
});

describe("bulkAnnouncement", () => {
  it("says how many changes went, and that reject put the document back", () => {
    const mixed = summarizeChanges([change("ai"), change("ai"), change("human")]);
    expect(bulkAnnouncement("reject", mixed)).toBe(
      "Rejected 2 changes. The document is back as it was.",
    );
    expect(bulkAnnouncement("accept", mixed)).toBe("Accepted 3 changes.");
  });

  it("counts every change when Reject all is not scoped", () => {
    const aiOnly = summarizeChanges([change("ai"), change("ai")]);
    expect(bulkAnnouncement("reject", aiOnly)).toMatch(/^Rejected 2 changes\./);
  });
});
