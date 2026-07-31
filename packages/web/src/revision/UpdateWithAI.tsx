import type { RevisionApi } from "./useRevision";

/** FROZEN PROP CONTRACT — rendered in the title bar. */
export interface UpdateWithAIProps {
  revision: RevisionApi;
  /** Number of unresolved comments plus reviewer edits awaiting the agent. */
  pendingCount: number;
}

// STUB — replaced by the revision-ui workstream.
export function UpdateWithAI(_props: UpdateWithAIProps) {
  return null;
}
