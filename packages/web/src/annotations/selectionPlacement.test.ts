import { describe, expect, it } from "vitest";
import {
  SELECTION_GAP,
  SELECTION_MARGIN,
  placeSelectionToolbar,
  samePlacement,
} from "./selectionPlacement";
import type { PlacementInput, Rect, SelectionBox } from "./selectionPlacement";

const rect = (top: number, left: number, bottom: number, right: number): Rect => ({
  top,
  left,
  bottom,
  right,
});

/** A one-line selection: first, last and union are the same box. */
function line(top: number, left: number, right: number, height = 20): SelectionBox {
  const r = rect(top, left, top + height, right);
  return { first: r, last: r, union: r };
}

/** Title bar (48) + ribbon (38) — the band the toolbar may never enter. */
const CHROME = 86;

const TOOLBAR = { width: 104, height: 28 };

function place(selection: SelectionBox, overrides: Partial<PlacementInput> = {}) {
  return placeSelectionToolbar({
    selection,
    toolbar: TOOLBAR,
    viewport: { width: 1280, height: 800 },
    chromeBottom: CHROME,
    ...overrides,
  });
}

describe("placeSelectionToolbar", () => {
  it("hovers above the selection and centres on it", () => {
    const selection = line(400, 300, 500);
    const placement = place(selection);

    expect(placement.visible).toBe(true);
    if (!placement.visible) return;
    expect(placement.side).toBe("above");
    // Clear of the text, not over it.
    expect(placement.top + TOOLBAR.height).toBe(selection.first.top - SELECTION_GAP);
    // Centred: 300..500 has midpoint 400.
    expect(placement.left + TOOLBAR.width / 2).toBe(400);
  });

  it("flips below when there is no room above", () => {
    const selection = line(100, 300, 500);
    const placement = place(selection);

    expect(placement.visible).toBe(true);
    if (!placement.visible) return;
    expect(placement.side).toBe("below");
    expect(placement.top).toBe(selection.last.bottom + SELECTION_GAP);
    expect(placement.top).toBeGreaterThan(selection.last.bottom);
  });

  it("never places the toolbar under the ribbon, even flipped", () => {
    // Selection scrolled so its first line is behind the chrome band.
    const selection: SelectionBox = {
      first: rect(70, 300, 90, 500),
      last: rect(70, 300, 90, 500),
      union: rect(70, 300, 90, 500),
    };
    const placement = place(selection);

    expect(placement.visible).toBe(true);
    if (!placement.visible) return;
    expect(placement.top).toBeGreaterThanOrEqual(CHROME + SELECTION_MARGIN);
  });

  it("keeps the whole toolbar below the chrome for every scroll offset", () => {
    for (let top = -40; top <= 780; top += 7) {
      const placement = place(line(top, 300, 500));
      if (!placement.visible) continue;
      expect(placement.top).toBeGreaterThanOrEqual(CHROME + SELECTION_MARGIN);
      expect(placement.top + TOOLBAR.height).toBeLessThanOrEqual(800 - SELECTION_MARGIN);
    }
  });

  it("anchors above the first line and below the last line of a wrapped selection", () => {
    const wrapped: SelectionBox = {
      first: rect(400, 500, 420, 700),
      last: rect(460, 100, 480, 300),
      union: rect(400, 100, 480, 700),
    };

    const above = place(wrapped);
    expect(above.visible && above.side).toBe("above");
    expect(above.visible && above.top + TOOLBAR.height).toBe(400 - SELECTION_GAP);

    const flipped = place({
      first: rect(100, 500, 120, 700),
      last: rect(160, 100, 180, 300),
      union: rect(100, 100, 180, 700),
    });
    expect(flipped.visible && flipped.side).toBe("below");
    expect(flipped.visible && flipped.top).toBe(180 + SELECTION_GAP);
  });

  it("clamps to the viewport rather than escaping it", () => {
    const offRight = place(line(400, 1250, 1278));
    expect(offRight.visible && offRight.left + TOOLBAR.width).toBeLessThanOrEqual(
      1280 - SELECTION_MARGIN,
    );

    const offLeft = place(line(400, 2, 30));
    expect(offLeft.visible && offLeft.left).toBeGreaterThanOrEqual(SELECTION_MARGIN);
  });

  it("stays inside the page column when one is given", () => {
    const bounds = { left: 300, right: 900 };

    const nearLeftEdge = place(line(400, 300, 340), { bounds });
    expect(nearLeftEdge.visible && nearLeftEdge.left).toBeGreaterThanOrEqual(bounds.left);

    const nearRightEdge = place(line(400, 860, 900), { bounds });
    expect(nearRightEdge.visible && nearRightEdge.left + TOOLBAR.width).toBeLessThanOrEqual(
      bounds.right,
    );
  });

  it("centres in the slot when the toolbar is wider than the page column", () => {
    const placement = place(line(400, 480, 520), { bounds: { left: 480, right: 540 } });

    expect(placement.visible).toBe(true);
    if (!placement.visible) return;
    expect(placement.left + TOOLBAR.width / 2).toBe(510);
  });

  it("hides once the selection has scrolled behind the chrome", () => {
    // Bottom edge 90, still peeking out below the 86 px chrome band.
    expect(place(line(70, 300, 500)).visible).toBe(true);
    // Bottom edge 80 — entirely behind the ribbon.
    expect(place(line(60, 300, 500)).visible).toBe(false);
    expect(place(line(-200, 300, 500)).visible).toBe(false);
  });

  it("hides once the selection has scrolled off the bottom", () => {
    expect(place(line(790, 300, 500)).visible).toBe(true);
    expect(place(line(820, 300, 500)).visible).toBe(false);
  });

  it("takes the roomier side, still clamped, when a selection fills the viewport", () => {
    // Room above the first line: 100 - 10 - 94 = -4 px. Below the last: 2 px.
    const roomierBelow = place({
      first: rect(100, 300, 120, 500),
      last: rect(760, 300, 780, 500),
      union: rect(100, 300, 780, 500),
    });
    expect(roomierBelow.visible && roomierBelow.side).toBe("below");
    expect(roomierBelow.visible && roomierBelow.top).toBe(800 - SELECTION_MARGIN - TOOLBAR.height);

    // Room above: 130 - 10 - 94 = 26 px. Below the last: 792 - 805 = -13 px.
    const roomierAbove = place({
      first: rect(130, 300, 150, 500),
      last: rect(775, 300, 795, 500),
      union: rect(130, 300, 795, 500),
    });
    expect(roomierAbove.visible && roomierAbove.side).toBe("above");
    expect(roomierAbove.visible && roomierAbove.top).toBe(CHROME + SELECTION_MARGIN);
  });

  it("returns whole pixels", () => {
    const placement = place(line(400.4, 300.3, 501.9));
    expect(placement.visible).toBe(true);
    if (!placement.visible) return;
    expect(Number.isInteger(placement.left)).toBe(true);
    expect(Number.isInteger(placement.top)).toBe(true);
  });
});

describe("samePlacement", () => {
  it("compares by what would be painted", () => {
    const a = { visible: true, left: 10, top: 20, side: "above" } as const;
    expect(samePlacement(a, { ...a })).toBe(true);
    expect(samePlacement(a, { ...a, top: 21 })).toBe(false);
    expect(samePlacement(a, { ...a, side: "below" })).toBe(false);
    expect(samePlacement({ visible: false }, { visible: false })).toBe(true);
    expect(samePlacement(a, { visible: false })).toBe(false);
    expect(samePlacement(null, null)).toBe(true);
    expect(samePlacement(null, a)).toBe(false);
  });
});
