export { useAnnotations } from "./useAnnotations";
export type { UseAnnotationsOptions, AnnotationsApi } from "./useAnnotations";
export { CommentRail } from "./CommentRail";
export type { CommentRailProps } from "./CommentRail";
export {
  createAnchor,
  prepareDocument,
  resolveAnchor,
  resolveAnchorIn,
  CONTEXT_CHARS,
  FUZZY_MIN_SIMILARITY,
} from "./anchor";
export type { AnchorMatch, AnchorStrategy } from "./anchor";
export { layoutBubbles, layoutHeight, BUBBLE_GAP } from "./layout";
export type { BubbleBox, BubbleLayout } from "./layout";
export { orderComments, mergeRemoteComments, selectForBrief, selectOrphans } from "./select";
