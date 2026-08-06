import { describe, expect, it } from "vitest";
import {
  digest,
  implicationsOf,
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

  it("keeps one blank line before the next heading", () => {
    // Without it the following heading is welded onto the last line of what was
    // just written — it reads as one paragraph and parses as a different
    // document, which is how a re-run of one section quietly loses the next.
    const sections = splitSections(RESEARCH);
    const next = replaceSection(RESEARCH, sections[0]!, "## Question\n\nRewritten.");

    expect(next).toContain("Rewritten.\n\n## Prior art");
    expect(next).not.toMatch(/Rewritten\.\n## /);
    expect(splitSections(next)).toHaveLength(3);
  });

  it("does not stack blank lines when the replacement already ends in one", () => {
    const sections = splitSections(RESEARCH);
    const next = replaceSection(RESEARCH, sections[0]!, "## Question\n\nRewritten.\n\n\n");

    expect(next).not.toMatch(/\n\n\n/);
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

describe("implicationsOf", () => {
  it("is the implications section, not the whole document", () => {
    const implications = implicationsOf(RESEARCH);

    expect(implications).toContain("Sessions must resolve in under 30 minutes.");
    expect(implications).not.toContain("Weird West");
  });

  it("falls back to the whole document when nothing states any", () => {
    // No stated implications means any change might matter, so watch it all.
    const bare = "# Research\n\n## Prior art\n\nSome findings.\n";

    expect(implicationsOf(bare)).toContain("Prior art");
  });

  it("matches the heading loosely — 'Implications' or 'Implications for the plan'", () => {
    const short = "# R\n\n## Findings\n\nx\n\n## Implications\n\n1. Ship on Tuesday.\n";

    expect(implicationsOf(short)).toBe("1. Ship on Tuesday.");
  });
});

describe("digest", () => {
  it("is stable for the same text and different for changed text", () => {
    expect(digest("one")).toBe(digest("one"));
    expect(digest("one")).not.toBe(digest("two"));
  });

  it("ignores nothing that matters — a single character changes it", () => {
    expect(digest("Sessions under 30 minutes")).not.toBe(digest("Sessions under 20 minutes"));
  });

  it("is short enough to read in a sidecar a human opens", () => {
    expect(digest("anything")).toHaveLength(8);
  });
});

describe("research changing is what raises the banner", () => {
  it("a citation fix does not move the implications; a conclusion does", () => {
    // The point of watching the implications rather than the file: being told
    // the plan is stale because a URL was corrected is how a notice gets
    // trained away.
    const fixedCitation = RESEARCH.replace("https://example.com/one", "https://example.com/1");
    expect(digest(implicationsOf(fixedCitation))).toBe(digest(implicationsOf(RESEARCH)));

    const changedConclusion = RESEARCH.replace("under 30 minutes", "under 10 minutes");
    expect(digest(implicationsOf(changedConclusion))).not.toBe(
      digest(implicationsOf(RESEARCH)),
    );
  });
});
