/**
 * annotations/internal.ts
 *
 * `AnnotationsApi` is a frozen contract (CONTRACT.md) and CommentRail is handed
 * nothing else, but the rail still needs lane-private things the contract does
 * not carry: where each anchor sits on screen, the pending draft, sidecar sync
 * state, re-attaching an orphan.
 *
 * Rather than widen the frozen shape, the hook publishes those extras in a
 * WeakMap keyed by the api object it returns. The api object is rebuilt on
 * every render, so the rail always reads internals from the same commit, and
 * nothing leaks outside this lane.
 */

import type { TextAnchor } from "../types";
import type { SelectionGeometry } from "./selectionGeometry";
import type { AnnotationsApi } from "./useAnnotations";

export type SidecarSync = "idle" | "loading" | "saving" | "saved" | "unavailable" | "error";

export interface DraftAnchor {
  /** Text the draft is anchored to, for the composer's quote line. */
  quote: string;
  /** Document positions, frozen the moment composing started. */
  from: number;
  to: number;
  anchor: TextAnchor;
}

/** Reserved placement id for the not-yet-saved draft bubble. */
export const DRAFT_ID = "__quill_draft__";

export interface AnnotationsInternal {
  /** Bumped whenever anchor geometry may have moved. */
  geometry: number;
  /** Anchor tops, in the coordinate space of the passed layer element. */
  measure(layer: HTMLElement): Map<string, number>;
  /** Preview of the editor's current selection, "" when there is none. */
  selectionQuote: string;
  /**
   * Identity of the current selection ("" when collapsed), so the floating
   * toolbar can scope a dismissal to the selection it was dismissed for.
   */
  selectionKey: string;
  /** True while the document itself holds the selection. */
  editorFocused: boolean;
  /** Viewport-space rects of the current selection, for the floating toolbar. */
  measureSelection(): SelectionGeometry | null;
  /** Returns focus to the document without moving the selection. */
  focusDocument(): void;
  /** The comment being composed, anchored the moment composing started. */
  draft: DraftAnchor | null;
  beginDraft(): boolean;
  cancelDraft(): void;
  /** Re-anchors an orphan onto the current selection. */
  reattach(commentId: string): boolean;
  /** Scrolls a comment's anchored text into view. */
  revealAnchor(commentId: string): void;
  /** True once the anchor has been matched approximately, not exactly. */
  approximate: ReadonlySet<string>;
  sync: SidecarSync;
  syncDetail: string | null;
  author: string;
}

const internals = new WeakMap<AnnotationsApi, AnnotationsInternal>();

export function attachInternal(api: AnnotationsApi, internal: AnnotationsInternal): AnnotationsApi {
  internals.set(api, internal);
  return api;
}

export function readInternal(api: AnnotationsApi): AnnotationsInternal | null {
  return internals.get(api) ?? null;
}
