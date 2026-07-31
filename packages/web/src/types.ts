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
