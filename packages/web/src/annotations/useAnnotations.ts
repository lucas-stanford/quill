import type { Editor } from "@tiptap/react";
import type { Comment, Sidecar } from "../types";

export interface UseAnnotationsOptions {
  editor: Editor | null;
  /** Only load once the plan is ready. */
  enabled: boolean;
}

export interface AnnotationsApi {
  comments: Comment[];
  /** Comments whose anchor could not be re-matched against the document. */
  orphans: Comment[];
  /** Anchor the current selection and start a new comment thread. */
  addComment: (body: string) => void;
  addReply: (commentId: string, body: string) => void;
  resolve: (commentId: string, resolved: boolean) => void;
  remove: (commentId: string) => void;
  /** Currently focused thread, for two-way highlight with the text. */
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  /** Unresolved comments, in document order — the M4 revision brief uses this. */
  forBrief: () => Comment[];
  sidecar: Sidecar;
}

/** STUB — replaced by the annotations workstream. */
export function useAnnotations(_options: UseAnnotationsOptions): AnnotationsApi {
  return {
    comments: [],
    orphans: [],
    addComment: () => {},
    addReply: () => {},
    resolve: () => {},
    remove: () => {},
    activeId: null,
    setActiveId: () => {},
    forBrief: () => [],
    sidecar: { version: 1, comments: [] },
  };
}
