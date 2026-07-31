import type { AnnotationsApi } from "./useAnnotations";

/** FROZEN PROP CONTRACT — rendered into AppShell's right rail. */
export interface CommentRailProps {
  annotations: AnnotationsApi;
}

// STUB — replaced by the annotations workstream.
export function CommentRail(_props: CommentRailProps) {
  return null;
}
