/**
 * annotations/selectionGeometry.ts
 *
 * The DOM half of the floating toolbar: turning the live editor selection into
 * the client rects `selectionPlacement.ts` does arithmetic on.
 *
 * Rects come from a real DOM Range built from the ProseMirror positions rather
 * than from `window.getSelection()`, so the measurement survives focus moving
 * off the document (the composer takes it) and stays correct for a selection
 * that wraps across several lines: a Range reports one rect per line box,
 * which is exactly what "hover above the first line, below the last" needs.
 */

import type { EditorView } from "@tiptap/pm/view";
import { unionRect } from "./selectionPlacement";
import type { Rect, SelectionBox } from "./selectionPlacement";

export interface SelectionGeometry {
  selection: SelectionBox;
  /** The document column, which the toolbar is kept inside horizontally. */
  bounds: { left: number; right: number };
}

/** Fallbacks matching the shipped tokens, used only if they cannot be read. */
const FALLBACK_TITLEBAR = 48;
const FALLBACK_RIBBON = 38;

function toRect(box: { top: number; right: number; bottom: number; left: number }): Rect {
  return { top: box.top, right: box.right, bottom: box.bottom, left: box.left };
}

function px(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Bottom edge of the opaque chrome — title bar plus ribbon — read from the
 * published design tokens rather than hardcoded, and taken unconditionally
 * rather than per mode: the ribbon slides in and out on `transform`, so
 * reserving its band at all times is what keeps a toolbar near the top of the
 * document from being swallowed the instant the reviewer switches to editing.
 */
export function chromeBottom(): number {
  if (typeof document === "undefined") return FALLBACK_TITLEBAR + FALLBACK_RIBBON;
  const style = getComputedStyle(document.documentElement);
  return (
    px(style.getPropertyValue("--titlebar-height"), FALLBACK_TITLEBAR) +
    px(style.getPropertyValue("--ribbon-height"), FALLBACK_RIBBON)
  );
}

/** One rect per line box of the selection, top-to-bottom. Empty when unknown. */
function lineRects(view: EditorView, from: number, to: number): Rect[] {
  try {
    const start = view.domAtPos(from, 1);
    const end = view.domAtPos(to, -1);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);

    const rects = Array.from(range.getClientRects())
      .filter((r) => r.width > 0.5 && r.height > 0.5)
      .map(toRect);
    if (rects.length > 0) return rects.sort((a, b) => a.top - b.top || a.left - b.left);
  } catch {
    // A position the view cannot map to DOM — fall through to coordsAtPos.
  }

  try {
    const head = view.coordsAtPos(from, 1);
    const tail = view.coordsAtPos(to, -1);
    return [toRect(head), toRect(tail)].sort((a, b) => a.top - b.top || a.left - b.left);
  } catch {
    return [];
  }
}

/** Viewport-space geometry of the current selection, or null when collapsed. */
export function measureSelectionGeometry(view: EditorView): SelectionGeometry | null {
  const { from, to } = view.state.selection;
  if (to <= from) return null;

  const rects = lineRects(view, from, to);
  if (rects.length === 0) return null;

  const first = rects[0]!;
  const last = rects[rects.length - 1]!;
  const union = rects.reduce(unionRect);
  const column = (view.dom as HTMLElement).getBoundingClientRect();

  return {
    selection: { first, last, union },
    bounds: { left: column.left, right: column.right },
  };
}

/**
 * Whether an element can be seen at all — `display: none` or `visibility:
 * hidden`, on it or on any ancestor. The floating control uses this on the
 * rail: the composer it opens lives there, and offering an action whose result
 * would be invisible is a dead end.
 */
export function isVisible(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (typeof el.checkVisibility === "function") {
    return el.checkVisibility({ visibilityProperty: true });
  }
  return getComputedStyle(el).visibility !== "hidden";
}
