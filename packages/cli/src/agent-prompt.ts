/**
 * Renders a `RevisionBrief` as the prompt handed to the agent — the fallback
 * for a client that sends a brief with no prompt.
 *
 * The browser normally renders the prompt and sends it with the request, so
 * the product has exactly one prompt implementation and the CLI never imports
 * across the package boundary to get one (CONTRACT.md, "The prompt crosses the
 * wire, not the package boundary"). This keeps `quill` honest for anything that
 * posts a bare brief — a shell script, a test, a curl by hand — instead of
 * failing or sending a model an empty instruction.
 *
 * Framing follows CONTRACT.md and is a product decision, not formatting:
 *
 *  - **Edits are decisions already made.** The reviewer struck a sentence; the
 *    agent applies that, it does not re-argue it.
 *  - **Comments are instructions**, attached to a specific quote.
 *  - Orphaned comments still carry reviewer intent, and are labelled as
 *    orphaned so the agent knows the quote no longer appears verbatim.
 *
 * The result is passed to `spawn()` as a single element of an argument array —
 * never through a shell — so quotes, backticks, `$(...)` and newlines inside it
 * are inert bytes. See `revision.ts`.
 *
 * The plan itself is wrapped in a sentinel that is guaranteed not to occur in
 * the plan text, so a document that happens to contain "END PLAN" (or a code
 * fence, or another prompt) cannot forge the end of the quoted region.
 */
import type { BriefComment, BriefEdit, RevisionBrief } from "./types.js";

/** Finds a marker that does not occur in `text`, extending it if it does. */
export function uniqueSentinel(text: string, base = "QUILL-PLAN"): string {
  let sentinel = base;
  for (let n = 1; text.includes(sentinel); n++) sentinel = `${base}-${n}`;
  return sentinel;
}

function formatEdit(edit: BriefEdit, index: number): string {
  const verb = edit.kind === "insertion" ? "INSERTED" : "DELETED";
  const lines = [`${index}. ${verb}: ${JSON.stringify(edit.text)}`];
  if (edit.context) lines.push(`   in context: ${JSON.stringify(edit.context)}`);
  return lines.join("\n");
}

function formatComment(comment: BriefComment, index: number): string {
  const lines = [
    `${index}. On ${comment.orphaned ? "(text no longer present verbatim) " : ""}${JSON.stringify(comment.quote)}`,
    `   ${comment.author || "reviewer"}: ${comment.body}`,
  ];
  for (const reply of comment.replies) lines.push(`   reply: ${reply}`);
  if (comment.orphaned) {
    lines.push(
      "   note: the quoted text has changed since this note was written — apply the intent, do not invent the quote back.",
    );
  }
  return lines.join("\n");
}

/**
 * Builds the full prompt. Deterministic: the same brief always yields the same
 * string, so it can be asserted on in tests and diffed by a human.
 */
export function buildRevisionPrompt(brief: RevisionBrief): string {
  const sentinel = uniqueSentinel(brief.markdown);
  const sections: string[] = [];

  sections.push(
    [
      "You are revising a markdown planning document that a human has reviewed.",
      "",
      "Rules:",
      "- The reviewer's edits below are decisions already made. Apply them; do not re-litigate them.",
      "- The reviewer's comments below are instructions. Apply each one to the text it quotes.",
      "- Change nothing else. Sections nobody commented on must come back byte-identical.",
      "- Keep the document's existing markdown style: heading levels, list markers, table formatting, line wrapping.",
      "- Do not add a summary of what you changed, and do not address the reviewer.",
      "",
      "Output the complete revised document as raw markdown and nothing else:",
      "no preamble, no explanation, and no surrounding code fence.",
    ].join("\n"),
  );

  if (brief.instruction) {
    sections.push(`## Reviewer's instruction\n\n${brief.instruction}`);
  }

  if (brief.edits.length > 0) {
    sections.push(
      [
        "## Edits the reviewer already made",
        "",
        "These are settled. Keep them as written.",
        "",
        brief.edits.map((edit, i) => formatEdit(edit, i + 1)).join("\n"),
      ].join("\n"),
    );
  }

  if (brief.comments.length > 0) {
    sections.push(
      [
        "## Comments to apply",
        "",
        brief.comments.map((comment, i) => formatComment(comment, i + 1)).join("\n\n"),
      ].join("\n"),
    );
  }

  if (brief.edits.length === 0 && brief.comments.length === 0 && !brief.instruction) {
    sections.push(
      "## No specific notes\n\nThe reviewer left no comments, edits or instruction. Return the document unchanged.",
    );
  }

  sections.push(
    [
      `## The current plan (between the ${sentinel} markers)`,
      "",
      `<<<${sentinel}`,
      brief.markdown,
      `${sentinel}>>>`,
      "",
      "Reply with the revised document only.",
    ].join("\n"),
  );

  return `${sections.join("\n\n")}\n`;
}
