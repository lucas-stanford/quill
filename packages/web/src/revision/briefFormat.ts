/**
 * revision/briefFormat.ts
 *
 * The brief as the agent actually receives it.
 *
 * `buildBrief` produces the structured object; this turns it into the prompt.
 * Two decisions run through every line of it:
 *
 *   1. **The agent is editing a document, not doing the work.** A comment
 *      saying "make this idempotent" is a request to change what the plan
 *      *says*. Left implicit, a coding agent will happily go and write the
 *      idempotent backfill instead, and return code where a plan was asked for.
 *      So the prompt says it outright, twice, in the places a skim-reader
 *      looks: the framing at the top and the answer contract at the bottom.
 *
 *   2. **Edits are decisions, comments are instructions.** Struck text is gone
 *      and is not up for discussion; inserted text stays. The reviewer already
 *      made those calls in the document surface, and an agent that re-litigates
 *      them makes the review surface pointless.
 *
 * It is written for a mediocre model: short imperative sentences, one
 * instruction per line, no cleverness, the output contract stated last where it
 * is freshest, and every reviewer string quoted so the model can never mistake
 * plan text for instructions to it.
 */

import type { BriefComment, BriefPoll, RevisionBrief } from "../types";
import { pairBriefEdits } from "./briefLocate";
import type { BriefEditItem } from "./briefLocate";

/** Fences the plan off from the instructions around it. */
const PLAN_BEGIN = "=== BEGIN PLAN ===";
const PLAN_END = "=== END PLAN ===";

/**
 * A brief this size is still worth sending, but the bridge should say so out
 * loud: ~120k characters is roughly 30k tokens of plan and markup, past which
 * small models start dropping instructions from the middle. Nothing is ever
 * truncated to fit — a reviewer's note that Quill silently dropped is worse
 * than a long prompt, and the reviewer has no way to know it happened.
 */
export const BRIEF_SOFT_LIMIT_CHARS = 120_000;

export interface BriefMeasure {
  /** Reviewer content plus the plan, in characters. */
  chars: number;
  comments: number;
  edits: number;
  overSoftLimit: boolean;
}

/** Size of a brief, for a caller that wants to warn before sending it. */
export function measureBrief(brief: RevisionBrief): BriefMeasure {
  let chars = brief.markdown.length + (brief.instruction?.length ?? 0);
  for (const note of brief.feedback ?? []) chars += note.length;
  for (const comment of brief.comments) {
    chars += comment.quote.length + comment.body.length;
    for (const reply of comment.replies) chars += reply.length;
  }
  for (const edit of brief.edits) chars += edit.text.length + (edit.context?.length ?? 0);
  return {
    chars,
    comments: brief.comments.length,
    edits: brief.edits.length,
    overSoftLimit: chars > BRIEF_SOFT_LIMIT_CHARS,
  };
}

/**
 * True when the brief asks for nothing: no edits, no comments, no standing
 * feedback, no note.
 *
 * A predicate rather than a `buildBrief` that throws, because the shell builds
 * a brief to count what is pending and must be able to do that on an untouched
 * document. It is `formatBriefPrompt` that refuses — see below.
 */
export function isBriefEmpty(brief: RevisionBrief): boolean {
  return (
    brief.comments.length === 0 &&
    brief.edits.length === 0 &&
    feedbackNotes(brief).length === 0 &&
    (brief.polls ?? []).length === 0 &&
    (brief.instruction ?? "").trim() === ""
  );
}

/** The feedback notes that say something, trimmed. */
function feedbackNotes(brief: RevisionBrief): string[] {
  return (brief.feedback ?? []).map((note) => note.trim()).filter((note) => note !== "");
}

/** The author label shown to the agent; the sidecar's placeholder is not one. */
function authorLabel(author: string): string {
  const name = author.trim();
  if (!name || name.toLowerCase() === "you") return "The reviewer";
  return name;
}

function quoted(text: string): string {
  return `"${text.replace(/\s+/g, " ").trim()}"`;
}

function formatEditItem(item: BriefEditItem, index: number): string {
  const lines: string[] = [];
  const n = `${index + 1}.`;

  if (item.kind === "replacement") {
    lines.push(
      `${n} REPLACE — the reviewer typed over the old text. Both halves are one`,
    );
    lines.push(`   decision, in one place:`);
    lines.push(`     remove: ${quoted(item.removed.text)}`);
    lines.push(`     put in its place: ${quoted(item.added.text)}`);
  } else if (item.kind === "deletion") {
    lines.push(`${n} DELETE — the reviewer struck this text. Take it out of the plan, and`);
    lines.push(`   mend the sentence around it if taking it out leaves a hole:`);
    lines.push(`     ${quoted(item.edit.text)}`);
  } else {
    lines.push(`${n} INSERT — the reviewer typed this text into the plan. It stays, where`);
    lines.push(`   it is, in the revised plan:`);
    lines.push(`     ${quoted(item.edit.text)}`);
  }

  if (item.context) lines.push(`     it sits here: ${quoted(item.context)}`);
  return lines.join("\n");
}

function formatComment(comment: BriefComment, index: number): string {
  const lines: string[] = [];
  const n = `${index + 1}.`;

  if (comment.orphaned) {
    lines.push(
      `${n} ORPHANED NOTE — the text this note was attached to is no longer in the`,
    );
    lines.push(`   plan, so the quote below may not appear anywhere. Use your judgement:`);
    lines.push(`   apply the note where it now belongs, and if it no longer applies`);
    lines.push(`   anywhere, leave the plan alone rather than inventing a place for it.`);
    lines.push(`     it was attached to: ${quoted(comment.quote)}`);
  } else {
    lines.push(`${n} On this text: ${quoted(comment.quote)}`);
  }

  lines.push(`     ${authorLabel(comment.author)} says: ${comment.body.trim()}`);
  for (const reply of comment.replies) {
    lines.push(`     then adds: ${reply.trim()}`);
  }
  return lines.join("\n");
}

const HOW_TO_READ = [
  "=== HOW TO READ THIS ===",
  "",
  "- You are editing a DOCUMENT. You are not doing the work the plan describes.",
  "  Every instruction below asks you to change the words of the plan. Do not",
  "  write code, do not run commands, do not answer a comment conversationally.",
  '  A note saying "make this idempotent" on the text "run the backfill" means:',
  "  rewrite that part of the plan so the plan says the backfill is idempotent.",
  "",
  "- REVIEWER EDITS ARE DECISIONS ALREADY MADE. Text the reviewer struck is gone;",
  "  do not argue for it, restore it, or reword it back in. Text the reviewer",
  "  inserted stays; you may fix the grammar around it so it reads, but you may",
  "  not drop it or water it down.",
  "",
  "- REVIEWER COMMENTS ARE INSTRUCTIONS TO APPLY, each quoted against the piece of",
  "  the plan it applies to. Apply the instruction to that place in the plan.",
  "",
  "- CHANGE ONLY WHAT THE MARKUP ASKS FOR. Every heading, sentence, list item and",
  "  code block that no edit or comment touches must come back character for",
  "  character as it went in — same wording, same line breaks, same list markers,",
  "  same heading levels. This is a revision of a file under version control, and",
  "  every line you touch is a line the reviewer has to read again.",
].join("\n");

function answerContract(): string {
  return [
    "=== YOUR ANSWER ===",
    "",
    "Return the complete revised plan as Markdown, and nothing else.",
    "",
    "- Your entire reply is the document. Begin with its first line, stop at its",
    "  last line.",
    '- No preamble ("Here is the revised plan"), no sign-off, no summary of what',
    "  you changed, no list of the comments you addressed, no diff, no commentary.",
    "- Do not wrap the reply in a code fence. Code fences that are part of the plan",
    "  itself stay exactly as they are.",
    "- Do not leave review markup behind: no HTML comments, no TODO notes, no",
    "  markers showing where you made a change.",
    "- Include the whole plan, including the parts nobody marked up. A partial",
    "  document is a destroyed document.",
    "- If an instruction is unclear, make the smallest, most literal change to the",
    "  plan that satisfies it. Never reply with a question.",
  ].join("\n");
}

/** Where an agent writes candidate names. Not the plan — see `formatPolls`. */
export const OPTIONS_PATH = "research/options.json";

/**
 * The reviewer wants naming help as part of this round.
 *
 * The candidates cannot come back in the reply, because the reply is the
 * document and nothing else — a rule worth more than the convenience of
 * bundling them. So they go to a file beside the plan, which is also where the
 * previous rounds already are, and quill picks them up when the revision lands.
 *
 * The reviewer picks. An agent that fills in `chosen` has taken the decision
 * the whole poll exists to leave open.
 */
function formatPolls(polls: readonly BriefPoll[]): string {
  const lines = [
    `=== ALSO: CANDIDATE NAMES (${polls.length}) ===`,
    "",
    "As well as the revision above, the reviewer wants options for the names below.",
    `Write them to \`${OPTIONS_PATH}\` — NOT into the plan, and NOT into your reply.`,
    "Add one new poll per request to the `polls` array and keep every poll already",
    "in the file: the rounds are the argument, not just the answer.",
    "",
    "```json",
    '{ "version": 1, "polls": [',
    '  { "id": "<the id given below>", "subject": "<as given>",',
    '    "target": <the target object given below>,',
    '    "steering": "<as given, or \\"\\">",',
    '    "createdAt": "<ISO 8601>", "options": [',
    '      { "id": "o1", "value": "Steel Sunrise",',
    '        "note": "Why it works, in one line.", "dropped": false } ] } ] }',
    "```",
    "",
    "Rules:",
    "- Eight to twelve candidates per request. Fewer is not a choice; more is a list",
    "  nobody reads.",
    "- Every candidate gets a `note` saying why it works. One with no argument behind",
    "  it cannot be weighed against one that has.",
    "- Spread them out: eight variations of one idea is one candidate.",
    "- Copy `id`, `subject` and `target` through exactly as given. They are how the",
    "  reviewer's pick finds the thing it renames.",
    "- Do not set `chosen`. Picking is the reviewer's job, not yours.",
    "- Do not rename anything in the plan yourself. Offering is the whole request.",
  ];

  for (const poll of polls) {
    lines.push("", `--- ${poll.id} ---`);
    lines.push(`Naming: ${poll.subject}`);
    lines.push(
      poll.target.kind === "title"
        ? "Target: the document's own title. `\"target\": {\"kind\":\"title\"}`"
        : `Target: every mention of ${quoted(poll.target.value)} in the plan. ` +
          `\`"target": {"kind":"text","value":${JSON.stringify(poll.target.value)}}\`` +
          " — so the candidates have to read correctly in those sentences.",
    );
    if (poll.steering) lines.push(`The reviewer asked for: ${poll.steering}`);
    const exclude = poll.exclude ?? [];
    if (exclude.length > 0) {
      lines.push(
        `Already offered for this — do not repeat any of them: ${exclude
          .map((value) => quoted(value))
          .join(", ")}`,
      );
    }
  }

  return lines.join("\n");
}

/**
 * Render the brief as the prompt the agent is given.
 *
 * Refuses an empty brief. Formatting one can only produce a prompt asking a
 * model to hand back a document it was not asked to change, and whatever comes
 * back is applied to the reviewer's plan as tracked changes — so a no-op round
 * trip is not free, it is a chance to damage an untouched document. Callers
 * check `isBriefEmpty` first; the throw is there so that skipping the check
 * fails loudly in a test rather than quietly in front of a reviewer.
 */
export function formatBriefPrompt(brief: RevisionBrief): string {
  if (isBriefEmpty(brief)) {
    throw new Error(
      "Refusing to format an empty revision brief: no edits, no comments and no " +
        "instruction. Check isBriefEmpty(brief) before asking for a revision.",
    );
  }

  const sections: string[] = [];

  sections.push(
    [
      "You are revising a Markdown plan document.",
      "",
      "A human reviewer marked the plan up in Quill, a Word-like review surface:",
      "text they struck out and text they typed arrive below as REVIEWER EDITS,",
      "and their margin notes arrive as REVIEWER COMMENTS. Apply all of it and",
      "return the revised plan.",
    ].join("\n"),
  );

  sections.push(HOW_TO_READ);

  sections.push(
    [
      "=== THE PLAN ===",
      "",
      "Everything between the markers is the current plan. The markers are not part",
      "of the document; never include them in your answer.",
      "",
      PLAN_BEGIN,
      brief.markdown.replace(/\s+$/, ""),
      PLAN_END,
    ].join("\n"),
  );

  const items = pairBriefEdits(brief.markdown, brief.edits);
  if (items.length > 0) {
    sections.push(
      [
        `=== REVIEWER EDITS — decisions already made (${items.length}) ===`,
        "",
        "The plan above is the document as the reviewer left it, so their edits are",
        "still showing rather than applied: text they struck is still in the plan and",
        "you take it out, text they typed is already in place and you keep it. Every",
        "quote below is text you will find in the plan above.",
        "",
        items.map(formatEditItem).join("\n\n"),
      ].join("\n"),
    );
  }

  if (brief.comments.length > 0) {
    sections.push(
      [
        `=== REVIEWER COMMENTS — instructions to apply (${brief.comments.length}) ===`,
        "",
        brief.comments.map(formatComment).join("\n\n"),
      ].join("\n"),
    );
  }

  const feedback = feedbackNotes(brief);
  if (feedback.length > 0) {
    sections.push(
      [
        `=== FEEDBACK ON THE PLAN AS A WHOLE (${feedback.length}) ===`,
        "",
        "Standing feedback the reviewer left about the plan itself rather than about",
        "any one sentence — its shape, what is missing, what it is for. Act on it by",
        "changing the plan's structure and content, not by adding a paragraph that",
        "talks about the feedback.",
        "",
        "Each numbered note is a separate objection. Address every one of them.",
        "",
        feedback.map((note, i) => `${i + 1}. ${note}`).join("\n\n"),
      ].join("\n"),
    );
  }

  const polls = brief.polls ?? [];
  if (polls.length > 0) {
    sections.push(formatPolls(polls));
  }

  const note = (brief.instruction ?? "").trim();
  if (note) {
    sections.push(
      [
        "=== NOTE FROM THE REVIEWER ===",
        "",
        "Typed when they asked for this revision. It is about the plan as a whole.",
        "Where it genuinely contradicts a comment, this note is the reviewer's latest",
        "word and wins; the reviewer's edits above still stand exactly as written.",
        "",
        note,
      ].join("\n"),
    );
  }

  sections.push(answerContract());

  return `${sections.join("\n\n")}\n`;
}
