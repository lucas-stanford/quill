import { describe, expect, it } from "vitest";
import {
  appendSection,
  removeSection,
  replaceSection,
  sectionAtLine,
  splitSections,
} from "./sections";

const RESEARCH = `# Research — weird west duels

## Question

Whether a duel can carry a whole game.

## Prior art

We looked at Weird West and Hard West.

### Sources

- <https://example.com/one>

## Implications for the plan

1. Sessions must resolve in under 30 minutes.
`;

describe("splitSections", () => {
  it("splits on the level below the title, not on the title", () => {
    expect(splitSections(RESEARCH).map((s) => s.title)).toEqual([
      "Question",
      "Prior art",
      "Implications for the plan",
    ]);
  });

  it("keeps a deeper heading inside its section", () => {
    // "Sources" is part of the line of enquiry it belongs to. Re-running it on
    // its own would produce findings with no question attached to them.
    const priorArt = splitSections(RESEARCH)[1]!;

    expect(priorArt.text).toContain("### Sources");
    expect(priorArt.text).toContain("https://example.com/one");
  });

  it("a section ends where the next one begins", () => {
    const [question, priorArt] = splitSections(RESEARCH);

    expect(question!.text).not.toContain("Prior art");
    expect(priorArt!.text.startsWith("## Prior art")).toBe(true);
  });

  it("ignores a heading inside a fence — research quotes markdown constantly", () => {
    const withFence = `# Doc

## Real

\`\`\`markdown
## Not a section
\`\`\`

## Also real
`;

    expect(splitSections(withFence).map((s) => s.title)).toEqual(["Real", "Also real"]);
  });

  it("treats top-level headings as sections when there is no single title", () => {
    expect(splitSections("## One\n\ntext\n\n## Two\n").map((s) => s.title)).toEqual([
      "One",
      "Two",
    ]);
  });

  it("has nothing to act on in a document with no headings", () => {
    expect(splitSections("just prose\n")).toEqual([]);
  });
});

describe("sectionAtLine", () => {
  it("finds the section a line belongs to, and none above the first", () => {
    const sections = splitSections(RESEARCH);

    expect(sectionAtLine(sections, 0)).toBeNull();
    expect(sectionAtLine(sections, 6)?.title).toBe("Prior art");
    expect(sectionAtLine(sections, sections[0]!.headingLine)?.title).toBe("Question");
  });
});

describe("replaceSection", () => {
  it("changes one section and leaves the rest byte-identical", () => {
    const sections = splitSections(RESEARCH);
    const next = replaceSection(RESEARCH, sections[1]!, "## Prior art\n\nFour games, cited.\n");

    expect(next).toContain("Four games, cited.");
    expect(next).not.toContain("We looked at Weird West");
    // The point of scoping a re-run: nothing else moves.
    expect(next).toContain("# Research — weird west duels");
    expect(next).toContain("Whether a duel can carry a whole game.");
    expect(next).toContain("1. Sessions must resolve in under 30 minutes.");
    expect(splitSections(next).map((s) => s.title)).toEqual([
      "Question",
      "Prior art",
      "Implications for the plan",
    ]);
  });

  it("replaces the last section without eating the trailing newline", () => {
    const sections = splitSections(RESEARCH);
    const next = replaceSection(RESEARCH, sections[2]!, "## Implications for the plan\n\n1. One.\n");

    expect(splitSections(next)).toHaveLength(3);
    expect(next).toContain("1. One.");
  });
});

describe("removeSection", () => {
  it("removes it and leaves one blank line, not two", () => {
    const sections = splitSections(RESEARCH);
    const next = removeSection(RESEARCH, sections[1]!);

    expect(next).not.toContain("Prior art");
    expect(next).not.toMatch(/\n\n\n/);
    expect(splitSections(next).map((s) => s.title)).toEqual([
      "Question",
      "Implications for the plan",
    ]);
  });

  it("removing the first section keeps the title", () => {
    const sections = splitSections(RESEARCH);
    const next = removeSection(RESEARCH, sections[0]!);

    expect(next.startsWith("# Research — weird west duels")).toBe(true);
    expect(next).not.toContain("Whether a duel can carry");
  });

  it("what was cut can be put back exactly", () => {
    // Cut is not delete: the section's text is kept and restoring it must
    // produce the same section, not an approximation of it.
    const sections = splitSections(RESEARCH);
    const cut = sections[1]!;
    const without = removeSection(RESEARCH, cut);
    const restored = appendSection(without, cut.text);

    const back = splitSections(restored).find((s) => s.title === "Prior art");
    expect(back?.text.trim()).toBe(cut.text.trim());
  });
});

describe("appendSection", () => {
  it("adds a section at the end with one blank line before it", () => {
    const next = appendSection(RESEARCH, "## Scope calibration\n\nA team of two, six weeks.\n");

    expect(splitSections(next).map((s) => s.title)).toEqual([
      "Question",
      "Prior art",
      "Implications for the plan",
      "Scope calibration",
    ]);
    expect(next).not.toMatch(/\n\n\n/);
  });
});
