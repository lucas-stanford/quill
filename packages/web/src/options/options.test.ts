import { describe, expect, it } from "vitest";
import { retitle } from "./retitle";
import { renderOptionsPrompt } from "./useOptions";
import type { OptionPoll, RevisionScope } from "../types";

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

describe("renderOptionsPrompt", () => {
  const scope: RevisionScope = {
    document: "research/options.json",
    heading: "name",
    text: "",
    kind: "options",
    mode: "append",
  };

  const poll = (values: string[]): OptionPoll => ({
    id: "p1",
    subject: "name",
    steering: "",
    createdAt: "2026-08-06T00:00:00.000Z",
    options: values.map((value, i) => ({ id: `o${i}`, value, note: "", dropped: false })),
  });

  it("asks for a spread with reasons, and refuses to pick", () => {
    const prompt = renderOptionsPrompt(scope, []);

    expect(prompt).toContain("Eight to twelve candidates");
    expect(prompt).toContain("`note`");
    // Picking is the reviewer's job; an agent that chooses has taken the
    // decision the poll exists to leave open.
    expect(prompt).toContain("Do not set `chosen`");
  });

  it("lists what has already been offered so a round cannot repeat itself", () => {
    const prompt = renderOptionsPrompt(scope, [poll(["Steel Sunrise", "Ironmouth"])]);

    expect(prompt).toContain("ALREADY OFFERED");
    expect(prompt).toContain("- Steel Sunrise");
    expect(prompt).toContain("- Ironmouth");
  });

  it("carries the steering when there is any, and says nothing when there is not", () => {
    expect(renderOptionsPrompt({ ...scope, note: "one word" }, [])).toContain(
      "WHAT THE REVIEWER ASKED FOR",
    );
    expect(renderOptionsPrompt(scope, [])).not.toContain("WHAT THE REVIEWER ASKED FOR");
  });

  it("names the subject it was asked for", () => {
    expect(renderOptionsPrompt({ ...scope, heading: "tagline" }, [])).toContain(
      "candidate taglines",
    );
  });
});
