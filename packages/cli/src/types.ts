/**
 * FROZEN CONTRACT — see CONTRACT.md.
 * Mirrored between packages/cli/src/types.ts and packages/web/src/types.ts;
 * keep the two identical.
 */

export interface PlanResponse {
  /** Absolute path to the plan file on disk. */
  path: string;
  /** Basename, e.g. "PLAN.md" — shown in the title bar. */
  name: string;
  /** Raw markdown source. */
  markdown: string;
  /** sha256 of the markdown, hex. Used for conflict-safe writes. */
  revision: string;
}

/* ── Companion documents ──────────────────────────────────────────────────
   Read-only reading material shown beside the plan: the research that backs
   it and the reference an implementer works from. See companions.ts. */

/** One companion, as listed in the tab strip. */
export interface CompanionSummary {
  /** File name, e.g. "research.md". The id the read endpoint takes. */
  name: string;
  /** Display label, e.g. "Research". */
  label: string;
  /** Absolute path on disk. */
  path: string;
}

/** GET /api/companions */
export interface CompanionList {
  documents: CompanionSummary[];
}

/** GET /api/companions/:name */
export interface CompanionDocument extends CompanionSummary {
  markdown: string;
  /** sha256 of the markdown, hex. Companions are editable, so writes are guarded. */
  revision: string;
}

/* ── Examples ─────────────────────────────────────────────────────────────
   Screenshots of how comparable products did it. Beside the document rather
   than inside it: the markdown schema has no image node on purpose. */

export interface Example {
  id: string;
  title: string;
  /** Where it came from. A screenshot with no source is not evidence. */
  source: string;
  /** Why it is here — the agent's one line about what it shows. */
  note: string;
  /** File name inside `research/examples/`. */
  image: string;
  tags: string[];
  /** ISO 8601. */
  addedAt: string;
}

/** GET/PUT /api/examples */
export interface ExampleManifest {
  version: 1;
  examples: Example[];
}

export interface ExamplesResponse {
  manifest: ExampleManifest;
  /** sha256 of the serialized manifest, for conflict-safe writes. */
  revision: string;
}

/* ── Options ──────────────────────────────────────────────────────────────
   Candidate names, kept as rounds: the ones rejected are as useful as the one
   taken, because the next round should not offer them again. */

export interface NameOption {
  id: string;
  /** The candidate itself. */
  value: string;
  /** Why the agent offered it. */
  note: string;
  /** Ruled out. Kept, so a later round does not suggest it again. */
  dropped: boolean;
}

/**
 * What a poll is about, and therefore what taking a candidate rewrites.
 *
 * Absent means the document's own title, which is what every poll meant before
 * there was anything else to mean — so a round written by an older quill keeps
 * behaving exactly as it did.
 */
export type OptionTarget =
  | { kind: "title" }
  /** A placeholder inside the plan: a character, a town, a faction. */
  | { kind: "text"; value: string };

export interface OptionPoll {
  id: string;
  /** What is being named — "name" unless something else was asked for. */
  subject: string;
  /** What the reviewer asked for, if anything. */
  steering: string;
  createdAt: string;
  options: NameOption[];
  /** The id of the option that won, when one has. */
  chosen?: string;
  /** What taking a candidate replaces. Absent means the title. */
  target?: OptionTarget;
}

export interface OptionsManifest {
  version: 1;
  polls: OptionPoll[];
}

/** GET/PUT /api/options */
export interface OptionsResponse {
  manifest: OptionsManifest;
  revision: string;
}

/** PUT /api/companions/:name */
export interface SaveCompanionRequest {
  markdown: string;
  revision: string;
}

export interface ErrorResponse {
  error: string;
}

/** PUT /api/plan body. `revision` is the revision the edit was based on. */
export interface SavePlanRequest {
  markdown: string;
  revision: string;
}

/** 409 response when the file changed on disk since `revision`. */
export interface ConflictResponse {
  error: string;
  /** The server's current state, so the client can recover. */
  current: PlanResponse;
}

/** Server -> client live events, delivered over SSE at GET /api/live. */
export interface PlanChangedEvent {
  /** Revision now on disk. */
  revision: string;
}

/* ── M3: review metadata ──────────────────────────────────────────────────
   Review data lives in a sidecar (PLAN.quill.json) so PLAN.md stays clean
   and diffable. Anchors are text-quote based, never offsets, so they can
   survive the AI rewording the text around them. */

/** Where a comment is attached, in the spirit of the W3C annotation model. */
export interface TextAnchor {
  /** The exact text the comment was attached to. */
  quote: string;
  /** Text immediately before the quote, for disambiguation. */
  prefix: string;
  /** Text immediately after the quote. */
  suffix: string;
}

export interface CommentReply {
  id: string;
  author: string;
  body: string;
  /** ISO 8601. */
  createdAt: string;
}

export interface Comment {
  id: string;
  anchor: TextAnchor;
  author: string;
  body: string;
  createdAt: string;
  resolved: boolean;
  replies: CommentReply[];
  /**
   * Set when re-anchoring failed on load. An orphan keeps its quote so it can
   * be re-attached or dismissed, and is never silently re-attached elsewhere.
   */
  orphaned?: boolean;
}

/** Authorship of a tracked change. */
export type ChangeAuthor = "human" | "ai";

/**
 * One note about the plan as a whole. A list rather than one block of prose
 * because feedback arrives as separate thoughts, and each is resolved
 * independently the way a comment thread is.
 */
export interface FeedbackEntry {
  id: string;
  body: string;
  /** ISO 8601. */
  createdAt: string;
  resolved: boolean;
}

/** The review sidecar, versioned so the schema can move. */
export interface Sidecar {
  version: 1;
  comments: Comment[];
  /**
   * Feedback about the plan as a whole, not anchored to any one sentence.
   * Omitted when empty so sidecars written before this field round-trip
   * byte-identically. A bare string, which an early build wrote, is accepted
   * and migrated to a single entry.
   */
  feedback?: FeedbackEntry[];
  /**
   * What the plan was last checked against, per companion — a digest of that
   * document's implications when the two were last reconciled.
   */
  reconciled?: Record<string, string>;
}

export const EMPTY_SIDECAR: Sidecar = { version: 1, comments: [] };

/** GET/PUT /api/annotations */
export interface AnnotationsResponse {
  sidecar: Sidecar;
  /** sha256 of the serialized sidecar, for conflict-safe writes. */
  revision: string;
}

export interface SaveAnnotationsRequest {
  sidecar: Sidecar;
  revision: string;
}

/* ── M4: the AI round-trip ────────────────────────────────────────────────
   Review markup becomes a revision brief; the agent rewrites the plan; the
   rewrite comes back as tracked changes so a bad revision is one click from
   being undone. */

/** A reviewer edit, framed to the agent as a decision already made. */
export interface BriefEdit {
  kind: "insertion" | "deletion";
  text: string;
  /** Surrounding text so the agent can locate the edit. */
  context?: string;
}

/** A comment, framed to the agent as an instruction to apply. */
export interface BriefComment {
  /** The text the note is attached to. */
  quote: string;
  body: string;
  author: string;
  replies: string[];
  /** True when the anchor could not be resolved against the current plan. */
  orphaned: boolean;
}

/** The structured brief sent to the agent. Not a diff dump. */
/**
 * A round of candidate names asked for as part of a review round.
 *
 * Naming is review, so it travels in the brief with everything else rather
 * than in a side channel of its own. The agent answers it by writing
 * `research/options.json` — its reply is still the document and nothing else.
 */
export interface BriefPoll {
  /** Id the agent copies into the poll it writes, so the answer can be matched. */
  id: string;
  /** What is being named, in the reviewer's words. */
  subject: string;
  /** What taking a candidate will replace. */
  target: OptionTarget;
  /** Optional steering — "one word, weird west, no compound words". */
  steering?: string;
  /** Values already offered for this target, so a round never repeats one. */
  exclude?: string[];
}

export interface RevisionBrief {
  markdown: string;
  comments: BriefComment[];
  edits: BriefEdit[];
  /** Standing feedback about the plan as a whole, one string per note. */
  feedback?: string[];
  /** Freeform note from the update dialog. */
  instruction?: string;
  /** Name candidates asked for in this round, answered alongside the rewrite. */
  polls?: BriefPoll[];
}

export type RevisionStatus = "idle" | "queued" | "working" | "done" | "failed" | "cancelled";

/**
 * Which document a request is about. Absent means the plan, so every agent
 * written against the original bridge keeps working untouched.
 */
export type RevisionTarget = "plan" | "research";

/**
 * The part of a companion a request is about.
 *
 * Research is an accumulation of lines of enquiry, so the unit is the section:
 * you re-run one, or push one further, without disturbing the findings you were
 * happy with. The section's current text travels with the request so the agent
 * replaces exactly it rather than guessing at boundaries.
 */
export interface RevisionScope {
  /** Companion file name, e.g. "research.md". */
  document: string;
  /** The section heading, verbatim, including its `##`. */
  heading: string;
  /** The section as it stands right now. */
  text: string;
  /**
   * Re-run it from scratch, push it further, open a new line of enquiry, or go
   * and find examples of how other people did it.
   */
  kind: "redo" | "deepen" | "add" | "examples" | "options";
  /** Whether the answer replaces the section or is added as a further pass. */
  mode: "replace" | "append";
  /** The reviewer's own words, for `deepen` and `add`. */
  note?: string;
}

/** POST /api/revision — asks for a revision. */
export interface RevisionRequest {
  brief: RevisionBrief;
  /**
   * The rendered prompt. The browser formats it so there is exactly one
   * prompt implementation in the product; the CLI sends it verbatim in
   * detached mode rather than re-deriving it across a package boundary.
   */
  prompt: string;
}

/**
 * Work reported while a revision is still being made.
 *
 * `seq` counts the reports, so the browser can tell a fresh one from the same
 * one polled twice without diffing the contents — which for a whole-document
 * snapshot would be the expensive way to learn nothing.
 */
export interface RevisionProgress {
  /** Increments on every report the agent sends. Starts at 1. */
  seq: number;
  /** One line, present tense: what the agent is doing now. */
  note?: string;
  /** Every comment and feedback id reported dealt with so far, deduplicated. */
  resolved: string[];
  /** The plan as it currently stands, if the agent sent one. */
  markdown?: string;
}

/** GET /api/revision — poll for the outcome. */
export interface RevisionState {
  id: string;
  status: RevisionStatus;
  /** Present when status is "done": the rewritten plan. */
  markdown?: string;
  /** Present when status is "failed". */
  error?: string;
  /** How the revision is being serviced. */
  mode: "attached" | "detached";
  /** Present once the agent has reported anything about work in progress. */
  progress?: RevisionProgress;
}

/**
 * Written to `.quill/revision-request.json` in attached mode for the parent
 * agent to pick up. The agent rewrites the plan on disk and the file watcher
 * pushes it back to the browser.
 */
export interface QueuedRevision {
  id: string;
  planPath: string;
  brief: RevisionBrief;
  createdAt: string;
}

/* ── M5: approve, hand off, ship ──────────────────────────────────────────
   A plan's job is to become work. Approving releases the CLI and can turn
   the plan into a ferricket board. */

/** How the review ended. The calling agent branches on this. */
export type ReviewOutcome = "approved" | "cancelled" | "errored";

/** POST /api/review/finish */
export interface FinishReviewRequest {
  outcome: ReviewOutcome;
  /** Break the approved plan into fer tickets before exiting. */
  createTickets?: boolean;
}

/** Printed to stdout as one line of JSON when quill exits. */
export interface ReviewSummary {
  outcome: ReviewOutcome;
  /** Absolute path to the final plan. */
  planPath: string;
  /** sha256 of the final plan. */
  revision: string;
  /** Unresolved comments left behind, if any. */
  openComments: number;
  /** Ticket ids created by the ferricket handoff. */
  tickets?: string[];
  /** Present when outcome is "errored". */
  error?: string;
}

/** GET /api/tickets/preview — what the breakdown would create. */
export interface TicketPreview {
  title: string;
  /** Heading depth: 1 becomes an epic, deeper becomes a task. */
  level: number;
  /** Index into the preview array; undefined for a top-level ticket. */
  parent?: number;
  /** Indices this ticket depends on. */
  deps: number[];
  body?: string;
}

export interface TicketPlan {
  /** Whether the fer CLI is available at all. */
  available: boolean;
  tickets: TicketPreview[];
  /** Present when available is false. */
  reason?: string;
}
