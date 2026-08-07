/**
 * revision/progress.ts
 *
 * What to do with a report of work in progress.
 *
 * Kept out of the hook because this is the part with rules rather than
 * plumbing, and every one of them is a way to lose the reviewer's work if it
 * is wrong: closing a note that was never answered, closing one twice, or
 * landing a half-finished rewrite on top of a half-finished rewrite.
 */

import type { RevisionProgress } from "../types";

export interface AbsorbInput {
  /** The report just polled. */
  progress: RevisionProgress | undefined;
  /** `seq` of the last report already acted on. 0 before any. */
  seenSeq: number;
  /** Comment ids that went out in this brief. */
  sentComments: readonly string[];
  /** Feedback ids that went out in this brief. */
  sentFeedback: readonly string[];
  /** Ids already closed by an earlier report in this run. */
  closed: ReadonlySet<string>;
  /** The snapshot currently landed in the document, if any. */
  landed: string | null;
}

export interface AbsorbPlan {
  /** Nothing new; the same report polled again. */
  skip: boolean;
  seq: number;
  /** Comment threads to close now. */
  comments: string[];
  /** Feedback notes to close now. */
  feedback: string[];
  /** New line of commentary, or null to leave the last one showing. */
  note: string | null;
  /** A snapshot to land, or null to leave the document as it is. */
  snapshot: string | null;
}

const NOTHING: AbsorbPlan = {
  skip: true,
  seq: 0,
  comments: [],
  feedback: [],
  note: null,
  snapshot: null,
};

/**
 * Decide what one report changes.
 *
 * Three rules do the work:
 *
 * **Only what went out.** An agent naming an id this brief never sent is
 * either confused or reading a stale request, and closing a note the reviewer
 * has not had answered is the one mistake here that loses their work rather
 * than merely looking wrong.
 *
 * **Never twice.** Resolved ids arrive as a cumulative list, because resending
 * the whole list every beat is the easy thing for an agent to write. It must
 * not be punished for that with duplicate closes.
 *
 * **A snapshot supersedes, it does not stack.** The caller rejects the AI's
 * previous attempt before landing the next, so the diff is always against the
 * reviewer's document rather than against a half-finished rewrite.
 */
export function planAbsorb(input: AbsorbInput): AbsorbPlan {
  const { progress } = input;
  if (!progress || progress.seq <= input.seenSeq) return NOTHING;

  const sentComments = new Set(input.sentComments);
  const sentFeedback = new Set(input.sentFeedback);

  const comments: string[] = [];
  const feedback: string[] = [];
  for (const id of progress.resolved) {
    if (id === "" || input.closed.has(id)) continue;
    if (comments.includes(id) || feedback.includes(id)) continue;
    if (sentComments.has(id)) comments.push(id);
    else if (sentFeedback.has(id)) feedback.push(id);
  }

  const note = progress.note?.trim() ? progress.note.trim() : null;

  const raw = progress.markdown;
  const snapshot =
    raw !== undefined && raw.trim() !== "" && raw !== input.landed ? raw : null;

  return { skip: false, seq: progress.seq, comments, feedback, note, snapshot };
}
