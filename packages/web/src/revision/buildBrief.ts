/**
 * revision/buildBrief.ts
 *
 * Reviewer markup → the brief the agent is asked to act on.
 *
 * The brief is structured, never a diff dump: the plan as it stands, the edits
 * the reviewer already made, and the notes they left, each tied to the text it
 * is about. `briefFormat.ts` renders it into the prompt; this file decides what
 * goes in and in what order.
 *
 * Three judgement calls live here.
 *
 * **Document order, not insertion order.** The agent reads the brief top to
 * bottom and applies it to a document it also reads top to bottom. Comments
 * ordered by when they were typed make it jump around the plan, which is how
 * instructions get dropped. Ordering is `annotations/select`'s `orderComments`,
 * given positions resolved against the markdown, so orphans land last — they
 * are the notes with no place in the document to be read at.
 *
 * **Only the reviewer's edits are decisions.** `tracking.changes` also carries
 * the AI's own pending insertions and deletions from an earlier round trip.
 * Those are proposals the reviewer has not ruled on, and `BriefEdit` has no
 * author field to say so, so passing them off as "decisions already made" would
 * put words in the reviewer's mouth. They stay out; their text is in the plan
 * markdown either way, which is exactly the undecided state they are in.
 *
 * **Nothing a reviewer wrote is ever truncated.** Long notes, long strikes and
 * long plans go through whole. Only derived context excerpts are bounded, and
 * `measureBrief` exists so a caller can warn about a very large brief instead
 * of quietly losing half of it.
 */

import { prepareDocument, resolveAnchorIn } from "../annotations/anchor";
import { orderComments } from "../annotations/select";
import type { AnnotationsApi } from "../annotations";
import type { TrackedChangesApi } from "../tracking";
import type { BriefComment, BriefEdit, Comment, RevisionBrief } from "../types";
import { editContext, placeEdits, unionSpan } from "./briefLocate";

export {
  BRIEF_SOFT_LIMIT_CHARS,
  formatBriefPrompt,
  isBriefEmpty,
  measureBrief,
} from "./briefFormat";
export type { BriefMeasure } from "./briefFormat";
export { EDIT_CONTEXT_CHARS, pairBriefEdits } from "./briefLocate";
export type { BriefEditItem } from "./briefLocate";

/** Comments the agent can act on: the ones that actually say something. */
function hasInstruction(comment: Comment): boolean {
  if (comment.body.trim() !== "") return true;
  return comment.replies.some((reply) => reply.body.trim() !== "");
}

/**
 * The ids of the threads this brief would carry — the same selection
 * `buildComments` makes, so a caller can act on exactly what the agent was
 * asked to act on and nothing else.
 *
 * The round trip uses it to resolve those threads once the revision lands. A
 * thread with no text in it is not an instruction and is deliberately left
 * open: nothing was asked, so nothing was answered.
 */
export function briefCommentIds(annotations: AnnotationsApi): string[] {
  return annotations
    .forBrief()
    .filter(hasInstruction)
    .map((comment) => comment.id);
}

function toBriefComment(comment: Comment): BriefComment {
  const quote = comment.anchor.quote.trim();
  return {
    quote,
    body: comment.body.trim(),
    author: comment.author,
    replies: comment.replies.map((reply) => reply.body.trim()).filter((body) => body !== ""),
    // A note with no quote cannot be pointed at a place in the plan any more
    // than a note whose anchor was lost, and the agent must be told so.
    orphaned: comment.orphaned === true || quote === "",
  };
}

function buildComments(markdown: string, annotations: AnnotationsApi): BriefComment[] {
  const selected = annotations.forBrief().filter(hasInstruction);
  if (selected.length === 0) return [];
  if (selected.length === 1) return selected.map(toBriefComment);

  const doc = prepareDocument(markdown);
  const at = new Map<string, number>();
  for (const comment of selected) {
    // An anchor the editor already gave up on is not re-resolved here: a lost
    // note must stay lost rather than be re-attached somewhere plausible.
    if (comment.orphaned === true) continue;
    const match = resolveAnchorIn(doc, comment.anchor);
    if (match) at.set(comment.id, match.start);
  }

  return orderComments(selected, (comment) => at.get(comment.id)).map(toBriefComment);
}

function buildEdits(markdown: string, tracking: TrackedChangesApi): BriefEdit[] {
  const edits: BriefEdit[] = tracking.changes
    .filter((change) => change.author === "human")
    .map((change) => ({ kind: change.kind, text: change.text.trim() }))
    .filter((edit) => edit.text !== "");
  if (edits.length === 0) return [];

  // Placement is what gives a replacement its shared excerpt: the reviewer
  // typed over a selection, so both halves describe one spot in the plan.
  const placements = placeEdits(markdown, edits);
  return edits.map((edit, index) => {
    const { span, partner } = placements[index]!;
    if (!span) return edit;
    const paired = partner === -1 ? null : placements[partner]!.span;
    const context = editContext(markdown, unionSpan(span, paired));
    return context ? { ...edit, context } : edit;
  });
}

/**
 * The brief for the current markup.
 *
 * Total by design — the shell builds one on every render to count what is
 * pending, so an untouched document must produce an empty brief rather than an
 * exception. `isBriefEmpty` is how a caller tells that brief apart from one
 * worth sending, and `formatBriefPrompt` refuses to render it.
 *
 * An untouched document costs nothing, but marked-up ones scan the plan once
 * per call to place the markup in it, so a caller rebuilding on every keystroke
 * should memoize on the markdown, the comments and the changes.
 */
export function buildBrief(
  markdown: string,
  annotations: AnnotationsApi,
  tracking: TrackedChangesApi,
  instruction?: string,
): RevisionBrief {
  const brief: RevisionBrief = {
    markdown,
    comments: buildComments(markdown, annotations),
    edits: buildEdits(markdown, tracking),
  };

  const feedback = (annotations.feedback ?? "").trim();
  if (feedback !== "") brief.feedback = feedback;

  const note = (instruction ?? "").trim();
  if (note !== "") brief.instruction = note;

  return brief;
}
