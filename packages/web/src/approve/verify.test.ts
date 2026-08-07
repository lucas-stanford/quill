import { describe, expect, it } from "vitest";
import { cleanPlan, describeFindings, verifyPlan } from "./verify";

const CLEAN = `# Plan

## M1 — Ride in

1. Add a fallback branch where no match exists.
2. Wire the reputation system to the outcome.

Some prose about the town.

\`\`\`sh
# not a heading
quill PLAN.md -- --flag
\`\`\`

- A bullet
- Another bullet
`;

describe("verifyPlan", () => {
  it("says nothing about a clean document", () => {
    expect(verifyPlan(CLEAN)).toEqual([]);
    expect(describeFindings([])).toBe("");
  });

  it("finds the empty bullet a review leaves behind", () => {
    const findings = verifyPlan("# Plan\n\n- Alpha\n- \n- Charlie\n");

    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("empty-item");
    expect(findings[0]!.line).toBe(4);
    expect(findings[0]!.fixable).toBe(true);
  });

  it("finds an empty numbered step, however it is punctuated", () => {
    for (const marker of ["1.", "2)", "-", "*", "+"]) {
      const findings = verifyPlan(`# Plan\n\n${marker}\n`);
      expect(findings.map((f) => f.kind)).toEqual(["empty-item"]);
    }
  });

  it("counts trailing whitespace as empty", () => {
    expect(verifyPlan("# Plan\n\n-   \n").map((f) => f.kind)).toEqual(["empty-item"]);
  });

  it("finds a heading with no words", () => {
    const findings = verifyPlan("# Plan\n\n##\n\nText.\n");

    expect(findings.map((f) => f.kind)).toEqual(["empty-heading"]);
    expect(findings[0]!.fixable).toBe(true);
  });

  it("says what each problem actually costs, measured against the shatter", () => {
    /*
     * Measured with planToTickets, not guessed: an empty heading is skipped and
     * its steps are re-parented to the milestone above; an unclosed fence makes
     * every heading below it vanish; an empty item simply makes no ticket. A
     * warning whose stated reason is false is worse than no warning.
     */
    const heading = verifyPlan("# Plan\n\n##\n")[0]!;
    expect(heading.message).toContain("wrong heading");

    const fence = verifyPlan("# Plan\n\n```sh\nx\n")[0]!;
    expect(fence.message).toContain("never become work");

    const item = verifyPlan("# Plan\n\n- \n")[0]!;
    expect(item.message).toContain("becomes no ticket");
  });

  it("leaves a dash inside a code fence alone", () => {
    // A bare `-` in a shell example is an argument, not a bullet. Reporting it
    // would train the reviewer to click through the pass.
    const fenced = "# Plan\n\n```sh\ncat -\n-\n```\n";

    expect(verifyPlan(fenced)).toEqual([]);
  });

  it("finds a fence that is never closed", () => {
    const findings = verifyPlan("# Plan\n\n```sh\nquill PLAN.md\n\n## M2\n\n1. A step.\n");

    expect(findings.map((f) => f.kind)).toEqual(["unclosed-fence"]);
    expect(findings[0]!.line).toBe(3);
    // Nobody can guess where it was meant to close.
    expect(findings[0]!.fixable).toBe(false);
  });

  it("closes a fence on a longer marker of the same kind", () => {
    expect(verifyPlan("# Plan\n\n````\ncode\n````\n")).toEqual([]);
  });

  it("does not let a tilde fence close a backtick one", () => {
    expect(verifyPlan("# Plan\n\n```\ncode\n~~~\n").map((f) => f.kind)).toEqual([
      "unclosed-fence",
    ]);
  });

  it("refuses to call an empty item fixable when things are nested under it", () => {
    /*
     * Deleting the parent would take its children with it, and re-parenting
     * them is a judgement about what the plan means — not a cleanup.
     */
    const findings = verifyPlan("# Plan\n\n- \n  - Nested one.\n  - Nested two.\n");

    expect(findings.map((f) => f.kind)).toEqual(["empty-item"]);
    expect(findings[0]!.fixable).toBe(false);
    expect(findings[0]!.message).toContain("nested");
  });

  it("still clears an empty item whose neighbour is a sibling, not a child", () => {
    const findings = verifyPlan("# Plan\n\n- \n- Bravo item.\n");

    expect(findings[0]!.fixable).toBe(true);
  });

  it("reports every problem, in the order they read", () => {
    const findings = verifyPlan("# Plan\n\n- \n\n##\n\n1.\n");

    expect(findings.map((f) => [f.kind, f.line])).toEqual([
      ["empty-item", 3],
      ["empty-heading", 5],
      ["empty-item", 7],
    ]);
  });
});

describe("cleanPlan", () => {
  it("returns the same string when there is nothing to do", () => {
    expect(cleanPlan(CLEAN)).toBe(CLEAN);
  });

  it("removes the empty item and nothing else", () => {
    const before = "# Plan\n\n- Alpha\n- \n- Charlie\n";

    expect(cleanPlan(before)).toBe("# Plan\n\n- Alpha\n- Charlie\n");
  });

  it("leaves the ones that need a decision", () => {
    const before = "# Plan\n\n- \n  - Nested one.\n";

    expect(cleanPlan(before)).toBe(before);
  });

  it("does not touch a document whose only problem is an unclosed fence", () => {
    const before = "# Plan\n\n```sh\nquill PLAN.md\n";

    expect(cleanPlan(before)).toBe(before);
  });

  it("is honest about what is left", () => {
    // Cleaning is not a promise the document is now clean.
    const before = "# Plan\n\n- Alpha\n- \n\n```sh\nunclosed\n";
    const after = cleanPlan(before);

    expect(after).not.toMatch(/^- $/m);
    expect(verifyPlan(after).map((f) => f.kind)).toEqual(["unclosed-fence"]);
  });

  it("clears several at once without widening the diff", () => {
    // A line that sat alone between two blanks takes one of them with it,
    // otherwise every cleanup leaves a growing hole in the file.
    expect(cleanPlan("# Plan\n\n- \n\n##\n\n1.\n")).toBe("# Plan\n");
  });

  it("keeps the blank lines around a line that had content beside it", () => {
    expect(cleanPlan("# Plan\n\n- Alpha\n- \n- Charlie\n")).toBe("# Plan\n\n- Alpha\n- Charlie\n");
  });
});

describe("describeFindings", () => {
  const finding = (fixable: boolean) => ({
    kind: "empty-item" as const,
    line: 1,
    text: "- ",
    message: "",
    fixable,
  });

  it("says so when everything can be cleared", () => {
    expect(describeFindings([finding(true), finding(true)])).toContain("all of which");
  });

  it("says so when nothing can", () => {
    expect(describeFindings([finding(false)])).toContain("a decision from you");
  });

  it("gives the split when it is mixed", () => {
    expect(describeFindings([finding(true), finding(false)])).toContain("1 can be cleared");
  });
});
