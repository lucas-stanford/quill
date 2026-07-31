/**
 * annotations/selectionPlacement.ts
 *
 * Where the floating selection toolbar sits.
 *
 * The rule is the one every editor that does this uses: hover just ABOVE the
 * selection, centred on it, and flip BELOW when the top of the viewport (or
 * the chrome painted over it) leaves no room. The control must never cover the
 * words it refers to, never escape the page column, never escape the viewport,
 * and — the case this app has that a bare document does not — never slide up
 * under the overlaid ribbon, which paints opaquely over the top of the canvas.
 *
 * `chromeBottom` is what encodes that last rule: it is the bottom edge of the
 * title bar + ribbon band, and no placement is ever allowed above it. It is a
 * clamp rather than an "obstruction to avoid" because the ribbon spans the
 * full width — there is nowhere sideways to escape to.
 *
 * Pure arithmetic, no DOM — unit tested in selectionPlacement.test.ts.
 */

export interface Rect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The selection's client rects, reduced to the three that matter. */
export interface SelectionBox {
  /** First line of the selection — what the toolbar hovers above. */
  first: Rect;
  /** Last line — what it hovers below after a flip. */
  last: Rect;
  /** Union of every line, used to centre horizontally. */
  union: Rect;
}

export interface PlacementInput {
  selection: SelectionBox;
  /** Measured size of the toolbar. */
  toolbar: { width: number; height: number };
  viewport: { width: number; height: number };
  /**
   * Bottom edge of the chrome that paints over the canvas (title bar +
   * ribbon). Nothing is ever placed above this line.
   */
  chromeBottom: number;
  /** Horizontal bounds to stay inside — the page column, in practice. */
  bounds?: { left: number; right: number };
  /** Clearance kept between the toolbar and the text, so it never covers it. */
  gap?: number;
  /** Minimum distance from the edges of the safe area. */
  margin?: number;
}

export type Placement =
  | { visible: false }
  | { visible: true; left: number; top: number; side: "above" | "below" };

/** Enough to read as detached from the text without drifting away from it. */
export const SELECTION_GAP = 10;

/** Breathing room against the viewport edges and the chrome. */
export const SELECTION_MARGIN = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function unionRect(a: Rect, b: Rect): Rect {
  return {
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
    left: Math.min(a.left, b.left),
  };
}

/**
 * The toolbar is only shown while the text it points at is on screen. Once the
 * selection has scrolled behind the chrome or off the bottom, the control goes
 * with it: a button that stays put while its text leaves is a button pointing
 * at the wrong words.
 */
function onScreen(selection: SelectionBox, chromeBottom: number, height: number): boolean {
  return selection.union.bottom > chromeBottom && selection.union.top < height;
}

export function placeSelectionToolbar(input: PlacementInput): Placement {
  const { selection, toolbar, viewport, chromeBottom } = input;
  const gap = input.gap ?? SELECTION_GAP;
  const margin = input.margin ?? SELECTION_MARGIN;

  if (!onScreen(selection, chromeBottom, viewport.height)) return { visible: false };

  /* ── Vertical: prefer above, flip below, never above the chrome ─────── */

  const safeTop = chromeBottom + margin;
  const safeBottom = viewport.height - margin;
  const lowestTop = Math.max(safeTop, safeBottom - toolbar.height);

  const above = selection.first.top - gap - toolbar.height;
  // A selection whose last line is itself under the chrome would put "below"
  // under the chrome too, so the below candidate is clamped as well.
  const below = Math.max(selection.last.bottom + gap, safeTop);

  let side: "above" | "below";
  let top: number;

  if (above >= safeTop) {
    side = "above";
    top = above;
  } else if (below + toolbar.height <= safeBottom) {
    side = "below";
    top = below;
  } else {
    // Neither side fits: the selection spans the whole visible band. Take the
    // roomier side and clamp, which is the least-overlapping thing available.
    const roomAbove = selection.first.top - gap - safeTop;
    const roomBelow = safeBottom - (selection.last.bottom + gap);
    side = roomBelow >= roomAbove ? "below" : "above";
    top = clamp(side === "below" ? below : above, safeTop, lowestTop);
  }

  top = clamp(top, safeTop, lowestTop);

  /* ── Horizontal: centre on the selection, clamped into the page ────── */

  const safeLeft = margin;
  const safeRight = viewport.width - margin;
  const left = Math.max(safeLeft, input.bounds?.left ?? safeLeft);
  const right = Math.min(safeRight, input.bounds?.right ?? safeRight);

  const centred = (selection.union.left + selection.union.right) / 2 - toolbar.width / 2;
  const min = left;
  const max = right - toolbar.width;
  // When the toolbar is wider than the slot it must fit in, centre it in the
  // slot and let the viewport clamp have the final word.
  const placed = max >= min ? clamp(centred, min, max) : (min + max) / 2;

  return {
    visible: true,
    side,
    top: Math.round(top),
    left: Math.round(clamp(placed, safeLeft, Math.max(safeLeft, safeRight - toolbar.width))),
  };
}

/** True when two placements would paint identically — stops render loops. */
export function samePlacement(a: Placement | null, b: Placement | null): boolean {
  if (a === null || b === null) return a === b;
  if (!a.visible || !b.visible) return a.visible === b.visible;
  return a.left === b.left && a.top === b.top && a.side === b.side;
}
