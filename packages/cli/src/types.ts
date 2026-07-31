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

/** The review sidecar, versioned so the schema can move. */
export interface Sidecar {
  version: 1;
  comments: Comment[];
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
