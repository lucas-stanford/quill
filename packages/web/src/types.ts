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

export type LoadStatus = "loading" | "ready" | "error";

/**
 * Autosave lifecycle shown in the title bar.
 * - dirty:    edited, save scheduled
 * - saved:    written to disk
 * - stale:    the file changed on disk while the doc had unsaved edits;
 *             the external change was NOT applied, to protect local work
 * - conflict: a save was rejected because the file changed underneath it
 */
export type SaveState =
  | "idle"
  | "dirty"
  | "saving"
  | "saved"
  | "stale"
  | "conflict"
  | "error";

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
 * One note about the plan as a whole.
 *
 * A list rather than one block of prose because feedback arrives as separate
 * thoughts — "this is three milestones, not one" and "you never say how it
 * deploys" are two objections, and an agent that is handed them as one
 * paragraph tends to answer the first and forget the second. Each entry is
 * resolved independently, the same way a comment thread is.
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
   * Feedback about the plan as a whole — the notes that are not about any one
   * sentence. Omitted entirely when there is none, so a sidecar written before
   * this field existed round-trips byte-identically.
   *
   * Read tolerantly: an early build wrote a bare string here, and that is
   * accepted and migrated to a single entry rather than discarded.
   */
  feedback?: FeedbackEntry[];
  /**
   * What the plan was last checked against, per companion: a digest of that
   * document's implications at the moment the reviewer last reconciled the two.
   * When it stops matching, the plan is being argued from something the
   * research no longer says.
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

/* ── Companion documents ──────────────────────────────────────────────────
   Read-only reading material shown beside the plan: the research that backs
   it and the reference an implementer works from. */

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

/* ── Examples ─────────────────────────────────────────────────────────────
   Screenshots of how comparable products did it, beside the document rather
   than inside it: the markdown schema has no image node on purpose. */

export interface Example {
  id: string;
  title: string;
  /** Where it came from. A screenshot with no source is not evidence. */
  source: string;
  /** One line on what it shows. */
  note: string;
  /** File name inside `research/examples/`. */
  image: string;
  tags: string[];
  addedAt: string;
}

export interface ExampleManifest {
  version: 1;
  examples: Example[];
}

/** GET/PUT /api/examples */
export interface ExamplesResponse {
  manifest: ExampleManifest;
  revision: string;
}

/** GET /api/companions/:name */
export interface CompanionDocument extends CompanionSummary {
  markdown: string;
  /** sha256 of the markdown. Companions are editable, so writes are guarded. */
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
export interface RevisionBrief {
  markdown: string;
  comments: BriefComment[];
  edits: BriefEdit[];
  /** Standing feedback about the plan as a whole, one string per note. */
  feedback?: string[];
  /** Freeform note from the update dialog. */
  instruction?: string;
}

export type RevisionStatus = "idle" | "queued" | "working" | "done" | "failed" | "cancelled";

/** Which document a request is about. Absent means the plan. */
export type RevisionTarget = "plan" | "research";

/** The section of a companion a request is about. */
export interface RevisionScope {
  document: string;
  heading: string;
  text: string;
  kind: "redo" | "deepen" | "add" | "examples";
  mode: "replace" | "append";
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
