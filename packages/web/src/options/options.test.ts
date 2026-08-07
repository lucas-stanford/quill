import { describe, expect, it } from "vitest";
import { applyChoice, renameText, retitle, useLabel, wouldChange } from "./apply";

describe("retitle", () => {
  const PLAN = `# Old Name

## Problem

Something.

## M1 — Ride in: the town reacts

1. Do the thing.
`;

  it("rewrites the title and nothing else", () => {
    const next = retitle(PLAN, "Steel Sunrise");

    expect(next).toContain("# Steel Sunrise");
    expect(next).not.toContain("# Old Name");
    // A rename that reflows the file is a diff nobody can read.
    expect(next.split("\n").slice(1)).toEqual(PLAN.split("\n").slice(1));
  });

  it("adds a title when the document has none", () => {
    const untitled = "## Problem\n\nSomething.\n";

    expect(retitle(untitled, "Steel Sunrise")).toBe("# Steel Sunrise\n\n## Problem\n\nSomething.\n");
  });

  it("ignores a hash inside a fenced block", () => {
    // `# comment` in a shell example is not the document's title.
    const withFence = "```sh\n# not a title\nquill PLAN.md\n```\n\n# Real Title\n\ntext\n";
    const next = retitle(withFence, "Steel Sunrise");

    expect(next).toContain("# not a title");
    expect(next).toContain("# Steel Sunrise");
    expect(next).not.toContain("# Real Title");
  });

  it("does not touch a deeper heading", () => {
    const next = retitle("## Not the title\n\ntext\n", "Steel Sunrise");

    expect(next).toBe("# Steel Sunrise\n\n## Not the title\n\ntext\n");
  });

  it("refuses an empty name rather than blanking the title", () => {
    expect(retitle(PLAN, "   ")).toBe(PLAN);
  });
});

describe("renameText", () => {
  const PLAN = `# The Long Road

Vera rides west. Veracruz is three days out, and Vera does not stop.

- Vera's revolver
- A note addressed to "Vera"
`;

  it("replaces every mention", () => {
    const next = renameText(PLAN, "Vera", "Juno");

    expect(next).not.toContain("Vera ");
    expect(next.match(/Juno/g)).toHaveLength(4);
  });

  it("leaves a longer word that merely starts with the name alone", () => {
    // The whole reason this is not a plain replace: renaming Vera must not
    // turn Veracruz into Junocruz.
    expect(renameText(PLAN, "Vera", "Juno")).toContain("Veracruz");
  });

  it("matches a name with an accent in it", () => {
    // \b is ASCII-only, so a word-boundary regex refuses exactly the names
    // most likely to be worth renaming.
    expect(renameText("Renée rides out.", "Renée", "Juno")).toBe("Juno rides out.");
  });

  it("does not match a name glued to a letter on either side", () => {
    expect(renameText("xVera and Verax", "Vera", "Juno")).toBe("xVera and Verax");
  });

  it("refuses an empty replacement rather than deleting the name", () => {
    expect(renameText(PLAN, "Vera", "   ")).toBe(PLAN);
  });

  it("is a no-op when the name is already what it should be", () => {
    expect(renameText(PLAN, "Vera", "Vera")).toBe(PLAN);
  });
});

describe("applyChoice", () => {
  const PLAN = "# Untitled project\n\nVera rides west.\n";

  it("rewrites the title when the poll was about the document", () => {
    expect(applyChoice(PLAN, { kind: "title" }, "Palaver")).toBe(
      "# Palaver\n\nVera rides west.\n",
    );
  });

  it("renames the placeholder when the poll was about something in the plan", () => {
    const next = applyChoice(PLAN, { kind: "text", value: "Vera" }, "Juno");

    // The title is a poll about the document, and this was not that poll.
    expect(next).toBe("# Untitled project\n\nJuno rides west.\n");
  });

  it("treats a round with no target as a round about the title", () => {
    // Rounds written before targets existed all meant the document.
    expect(applyChoice(PLAN, undefined, "Palaver")).toBe("# Palaver\n\nVera rides west.\n");
  });

  it("reports a rename that would do nothing", () => {
    expect(wouldChange(PLAN, { kind: "text", value: "Vera" }, "Juno")).toBe(true);
    // Already renamed, or edited by hand: saying nothing would look like success.
    expect(wouldChange(PLAN, { kind: "text", value: "Absent" }, "Juno")).toBe(false);
  });

  it("labels the action for what it actually replaces", () => {
    expect(useLabel({ kind: "title" })).toBe("Use as title");
    expect(useLabel(undefined)).toBe("Use as title");
    expect(useLabel({ kind: "text", value: "Vera" })).toContain("Vera");
  });
});
