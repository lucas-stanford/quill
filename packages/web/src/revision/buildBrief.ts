import type { AnnotationsApi } from "../annotations";
import type { TrackedChangesApi } from "../tracking";
import type { RevisionBrief } from "../types";

/**
 * STUB — replaced by the payload workstream.
 *
 * Edits are framed to the agent as decisions already made; comments as
 * instructions to apply. Resolved comments are excluded.
 */
export function buildBrief(
  _markdown: string,
  _annotations: AnnotationsApi,
  _tracking: TrackedChangesApi,
  _instruction?: string,
): RevisionBrief {
  return { markdown: _markdown, comments: [], edits: [] };
}
