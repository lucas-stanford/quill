/**
 * FROZEN CONTRACT — see CONTRACT.md. Do not change during M1.
 * Mirrored in packages/web/src/types.ts; keep the two identical.
 */

export interface PlanResponse {
  /** Absolute path to the plan file on disk. */
  path: string;
  /** Basename, e.g. "PLAN.md" — shown in the title bar. */
  name: string;
  /** Raw markdown source. */
  markdown: string;
  /** Opaque content hash; M2 uses it for conflict-safe writes. */
  revision: string;
}

export interface ErrorResponse {
  error: string;
}
