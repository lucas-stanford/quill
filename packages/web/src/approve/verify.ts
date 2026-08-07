/**
 * approve/verify.ts
 *
 * A last look at the document before the review ends.
 *
 * Approving is the one irreversible step: the CLI exits, and what is on disk
 * becomes the plan an agent works from and a board is shattered out of. Debris
 * that survives to that point is not cosmetic, and each of these was measured
 * against `planToTickets` rather than guessed at:
 *
 *   - An empty list item makes no ticket at all. It reads as a step and is not
 *     one, and it stays in the file for the next reader to wonder about.
 *   - An empty heading is SKIPPED, and its steps are handed to the milestone
 *     above it — so that work silently lands under the wrong heading.
 *   - An unclosed fence swallows every heading below it, so those milestones
 *     and all their steps simply never become work.
 *
 * This is a reader, not a linter. It reports only things that are certainly
 * wrong and that nobody chose: structure a review can leave behind, never
 * matters of style or judgement. A pass that cries wolf about prose would be
 * clicked through, and then the one finding that mattered would be too.
 *
 * Everything here is a line scan over the markdown rather than a walk of the
 * ProseMirror document, on purpose: the file is what gets approved, and it is
 * what a check should therefore be about — however the debris got there.
 */

/** What was found, and whether it can be cleared without a judgement call. */
export interface Finding {
  kind: "empty-item" | "empty-heading" | "unclosed-fence";
  /** 1-based, so it matches what an editor would say. */
  line: number;
  /** The offending line, verbatim. */
  text: string;
  /** One sentence, in the reviewer's terms. */
  message: string;
  /** Whether `cleanPlan` will deal with it. */
  fixable: boolean;
}

const FENCE = /^([ \t]*)(```+|~~~+)(.*)$/;
/** A bullet or numbered marker with nothing after it. */
const EMPTY_ITEM = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]*$/;
/** A heading with no words. */
const EMPTY_HEADING = /^#{1,6}[ \t]*$/;
/** Any list marker, used to measure a sibling's indent. */
const ANY_ITEM = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+\S/;

function indentWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    if (ch === " ") width += 1;
    else if (ch === "\t") width += 4;
    else break;
  }
  return width;
}

/**
 * Everything wrong with the document that a review could have caused.
 *
 * Order is the document's, so the list reads top to bottom like the page.
 */
export function verifyPlan(markdown: string): Finding[] {
  const lines = markdown.split("\n");
  const findings: Finding[] = [];

  let fence: { marker: string; line: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[2]!;
      if (fence === null) fence = { marker, line: i + 1 };
      else if (marker[0] === fence.marker[0] && marker.length >= fence.marker.length) {
        fence = null;
      }
      continue;
    }
    // Inside a fence everything is code. A `- ` there is a shell flag.
    if (fence !== null) continue;

    if (EMPTY_HEADING.test(line)) {
      findings.push({
        kind: "empty-heading",
        line: i + 1,
        text: line,
        message:
          "A heading with no words. The shatter skips it and hands its steps to the milestone above, so that work lands under the wrong heading.",
        fixable: true,
      });
      continue;
    }

    const itemMatch = EMPTY_ITEM.exec(line);
    if (itemMatch) {
      /*
       * An empty item with something nested under it is not safe to delete —
       * removing the parent would orphan its children, and re-parenting them is
       * a judgement about what the plan means. Report it and let the reviewer
       * decide.
       */
      const hasChildren = nestedUnder(lines, i, indentWidth(itemMatch[1]!));
      findings.push({
        kind: "empty-item",
        line: i + 1,
        text: line,
        message: hasChildren
          ? "An empty list item with items nested under it. Give it words, or move its children out — deleting it would take them with it."
          : "A list item with no text. It reads as a step, becomes no ticket, and is left in the file for the next reader to wonder about.",
        fixable: !hasChildren,
      });
      continue;
    }
  }

  if (fence !== null) {
    findings.push({
      kind: "unclosed-fence",
      line: fence.line,
      text: lines[fence.line - 1] ?? "",
      message:
        "A code fence that is never closed. Everything below it reads as code, so those milestones and their steps never become work.",
      fixable: false,
    });
  }

  return findings;
}

/** Whether the next content under `at` is indented further than it. */
function nestedUnder(lines: readonly string[], at: number, indent: number): boolean {
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") continue;
    const next = ANY_ITEM.exec(line);
    if (next === null) return indentWidth(line) > indent && /^[ \t]/.test(line);
    return indentWidth(next[1]!) > indent;
  }
  return false;
}

/**
 * The document with the clearable findings cleared.
 *
 * Only whole lines are removed, and only ones `verifyPlan` called `fixable`, so
 * nothing a human wrote is reworded and nothing with content under it moves.
 *
 * A line that sat alone between two blank lines takes one of them with it.
 * Removing the line alone would leave two blanks where the reviewer had one, and
 * this product's whole promise is that changing one thing changes one line —
 * a cleanup that widens the diff everywhere it touches is not a cleanup.
 *
 * Anything left over is reported again by a second `verifyPlan`: cleaning is
 * not a promise that the document is now clean.
 */
export function cleanPlan(markdown: string): string {
  const lines = markdown.split("\n");
  const findings = verifyPlan(markdown);
  const drop = new Set<number>();

  for (const finding of findings) {
    if (!finding.fixable) continue;
    const index = finding.line - 1;
    drop.add(index);
    const before = lines[index - 1];
    const after = lines[index + 1];
    if (before !== undefined && before.trim() === "" && after !== undefined && after.trim() === "") {
      drop.add(index + 1);
    }
  }
  if (drop.size === 0) return markdown;

  return lines.filter((_line, index) => !drop.has(index)).join("\n");
}

/** How the pass reads in one line. Empty means "nothing to say". */
export function describeFindings(findings: readonly Finding[]): string {
  if (findings.length === 0) return "";
  const fixable = findings.filter((finding) => finding.fixable).length;
  const noun = findings.length === 1 ? "problem" : "problems";
  if (fixable === findings.length) {
    return `${findings.length} ${noun} left by the review, all of which can be cleared for you.`;
  }
  if (fixable === 0) {
    return `${findings.length} ${noun} left by the review, needing a decision from you.`;
  }
  return `${findings.length} ${noun} left by the review; ${fixable} can be cleared for you.`;
}
