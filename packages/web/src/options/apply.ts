/**
 * options/apply.ts
 *
 * Taking a candidate and putting it in the document.
 *
 * A poll is not always about the project. "What do we call the protagonist",
 * "what is the town called", "name the faction" are the same question asked
 * about something inside the plan, and answering them by rewriting the `# H1`
 * renames the whole document after a minor character — which is what the poll
 * did before it knew what it was about.
 *
 * So a poll carries its target, and taking a candidate rewrites exactly that:
 * the title when the poll is about the document, and otherwise every mention of
 * the placeholder the round was called on. Nothing else moves, because this is
 * a rename and a rename that reflows the file is a diff nobody can read.
 */

import type { OptionTarget } from "../types";

const H1 = /^#\s+\S/;
const FENCE = /^(\s*)(```+|~~~+)/;

/**
 * The document with its title set to `value`.
 *
 * When there is no title, one is added at the top: a plan with a name and
 * nowhere to say it would lose the name on the next round trip.
 */
export function retitle(markdown: string, value: string): string {
  const name = value.trim();
  if (name === "") return markdown;

  const lines = markdown.split("\n");
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // A "# heading" inside a fenced block is a shell prompt or a comment, not
    // this document's title.
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[2]!;
      if (fence === null) fence = marker;
      else if (marker.startsWith(fence[0]!) && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;

    if (H1.test(line)) {
      const next = [...lines];
      next[i] = `# ${name}`;
      return next.join("\n");
    }
  }

  return `# ${name}\n\n${markdown.replace(/^\s+/, "")}`;
}

const WORD_EDGE = /[\p{L}\p{N}_]/u;

/**
 * Every whole-word occurrence of `from` replaced by `to`.
 *
 * Whole-word, because renaming "Vera" must not turn "Veracruz" into
 * "<new>cruz". The edges are checked against the actual neighbouring
 * characters rather than `\b`, which is ASCII-only and would refuse to match a
 * name with an accent in it — the names most likely to want renaming.
 *
 * Case is respected exactly as written. A poll's placeholder is a proper noun
 * and matching loosely would rewrite prose that merely mentions the word.
 */
export function renameText(markdown: string, from: string, to: string): string {
  const needle = from.trim();
  const value = to.trim();
  if (needle === "" || value === "" || needle === value) return markdown;

  let out = "";
  let at = 0;
  for (;;) {
    const found = markdown.indexOf(needle, at);
    if (found === -1) break;
    const before = markdown[found - 1];
    const after = markdown[found + needle.length];
    const bounded =
      !(before !== undefined && WORD_EDGE.test(before)) &&
      !(after !== undefined && WORD_EDGE.test(after));
    out += markdown.slice(at, found) + (bounded ? value : needle);
    at = found + needle.length;
  }
  return out + markdown.slice(at);
}

/**
 * The document after taking `value` for `target`.
 *
 * An absent target means the document itself: that is what every poll asked
 * for before targets existed, and a round saved by an older quill must keep
 * doing what it did then.
 */
export function applyChoice(
  markdown: string,
  target: OptionTarget | undefined,
  value: string,
): string {
  if (target === undefined || target.kind === "title") return retitle(markdown, value);
  return renameText(markdown, target.value, value);
}

/** What the button should say, given what the poll is about. */
export function useLabel(target: OptionTarget | undefined): string {
  if (target === undefined || target.kind === "title") return "Use as title";
  return `Replace “${target.value}”`;
}

/**
 * Whether taking this candidate would change anything.
 *
 * A rename whose placeholder is not in the document any more — because it was
 * already renamed, or edited by hand — must say so rather than reporting
 * success and doing nothing.
 */
export function wouldChange(
  markdown: string,
  target: OptionTarget | undefined,
  value: string,
): boolean {
  return applyChoice(markdown, target, value) !== markdown;
}
