import type { AnnotationsApi } from "../annotations";
import type { TrackedChangesApi } from "../tracking";
import type { RevisionStatus } from "../types";

export interface UseRevisionOptions {
  enabled: boolean;
  markdown: string;
  annotations: AnnotationsApi;
  tracking: TrackedChangesApi;
}

export interface RevisionApi {
  status: RevisionStatus;
  error: string | null;
  /** Asks the agent for a revision, then applies it as tracked changes. */
  start: (instruction?: string) => void;
  cancel: () => void;
}

/** STUB — replaced by the revision-ui workstream. */
export function useRevision(_options: UseRevisionOptions): RevisionApi {
  return { status: "idle", error: null, start: () => {}, cancel: () => {} };
}
