import type { Editor } from "@tiptap/react";
import type { ChangeAuthor } from "../types";

export interface UseTrackedChangesOptions {
  editor: Editor | null;
  /** While true, user edits are recorded as tracked insertions/deletions. */
  enabled: boolean;
}

export interface TrackedChange {
  id: string;
  author: ChangeAuthor;
  kind: "insertion" | "deletion";
  text: string;
}

export interface TrackedChangesApi {
  changes: TrackedChange[];
  accept: (id: string) => void;
  reject: (id: string) => void;
  acceptAll: () => void;
  /** Rejecting every AI change must restore the pre-revision document exactly. */
  rejectAll: (author?: ChangeAuthor) => void;
  goToNext: () => void;
  goToPrevious: () => void;
  /** Applies an AI revision as tracked changes rather than replacing the doc. */
  applyRevision: (markdown: string) => void;
}

/** STUB — replaced by the tracking workstream. */
export function useTrackedChanges(_options: UseTrackedChangesOptions): TrackedChangesApi {
  return {
    changes: [],
    accept: () => {},
    reject: () => {},
    acceptAll: () => {},
    rejectAll: () => {},
    goToNext: () => {},
    goToPrevious: () => {},
    applyRevision: () => {},
  };
}
