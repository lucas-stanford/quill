import type { EditorMode } from "../types";

/** Left-to-right order of the segmented control, and of arrow-key traversal. */
export const MODE_ORDER: readonly EditorMode[] = ["edit", "review"];

export const MODE_LABEL: Record<EditorMode, string> = {
  edit: "Edit",
  review: "Review",
};

export const MODE_HINT: Record<EditorMode, string> = {
  edit: "Edit — write and format the document",
  review: "Review — comment and mark up the document",
};

/**
 * The WAI-ARIA radiogroup keyboard model: arrows both move focus and change
 * the selection, wrapping around the ends; Home/End jump to the ends. Every
 * other key is left to the browser (Tab must leave the group, because a
 * radiogroup is a single tab stop).
 *
 * Returns the mode the key selects, or null when the key is not ours.
 */
export function nextModeForKey(current: EditorMode, key: string): EditorMode | null {
  const count = MODE_ORDER.length;
  const index = Math.max(0, MODE_ORDER.indexOf(current));

  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return MODE_ORDER[(index + 1) % count] ?? null;
    case "ArrowLeft":
    case "ArrowUp":
      return MODE_ORDER[(index - 1 + count) % count] ?? null;
    case "Home":
      return MODE_ORDER[0] ?? null;
    case "End":
      return MODE_ORDER[count - 1] ?? null;
    default:
      return null;
  }
}
