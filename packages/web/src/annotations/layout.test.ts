import { describe, expect, it } from "vitest";
import { BUBBLE_GAP, layoutBubbles, layoutHeight } from "./layout";
import type { BubbleBox } from "./layout";

/** No two bubbles may share vertical space. This is the whole point. */
function assertNoOverlap(layouts: ReturnType<typeof layoutBubbles>): void {
  const sorted = [...layouts].sort((a, b) => a.top - b.top);
  for (let i = 1; i < sorted.length; i++) {
    const above = sorted[i - 1]!;
    const below = sorted[i]!;
    expect(below.top).toBeGreaterThanOrEqual(above.top + above.height + BUBBLE_GAP);
  }
}

const box = (id: string, anchorTop: number, height = 80): BubbleBox => ({ id, anchorTop, height });

describe("layoutBubbles", () => {
  it("leaves bubbles at their anchors when nothing collides", () => {
    const layouts = layoutBubbles([box("a", 0), box("b", 200), box("c", 500)]);

    expect(layouts.map((l) => l.top)).toEqual([0, 200, 500]);
    assertNoOverlap(layouts);
  });

  it("pushes colliding bubbles down, in document order", () => {
    const layouts = layoutBubbles([box("a", 100), box("b", 110), box("c", 120)]);

    expect(layouts.map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(layouts[0]!.top).toBe(100);
    expect(layouts[1]!.top).toBe(100 + 80 + BUBBLE_GAP);
    expect(layouts[2]!.top).toBe(100 + 2 * (80 + BUBBLE_GAP));
    assertNoOverlap(layouts);
  });

  it("never lifts a bubble above its own anchor", () => {
    const layouts = layoutBubbles([box("a", 0), box("b", 40), box("c", 900)]);

    for (const layout of layouts) {
      expect(layout.top).toBeGreaterThanOrEqual(layout.anchorTop);
    }
    assertNoOverlap(layouts);
  });

  it("pulls the active bubble back to its anchor and pushes its neighbours up", () => {
    const boxes = [box("a", 100), box("b", 110), box("c", 120)];
    const passive = layoutBubbles(boxes);
    const active = layoutBubbles(boxes, "c");

    expect(passive.find((l) => l.id === "c")!.top).toBe(280);
    expect(active.find((l) => l.id === "c")!.top).toBe(180);
    expect(active.find((l) => l.id === "b")!.top).toBe(90);
    expect(active.find((l) => l.id === "a")!.top).toBe(0);
    assertNoOverlap(active);
  });

  it("cannot push a bubble off the top of the rail", () => {
    const layouts = layoutBubbles([box("a", 0), box("b", 4), box("c", 8)], "c");

    for (const layout of layouts) expect(layout.top).toBeGreaterThanOrEqual(0);
    assertNoOverlap(layouts);
  });

  it("handles variable bubble heights", () => {
    const layouts = layoutBubbles([
      box("a", 0, 40),
      box("b", 20, 300),
      box("c", 30, 60),
      box("d", 1000, 50),
    ]);

    expect(layouts.map((l) => l.top)).toEqual([0, 50, 360, 1000]);
    assertNoOverlap(layouts);
  });

  it("is a no-op for an empty rail", () => {
    expect(layoutBubbles([])).toEqual([]);
    expect(layoutHeight([])).toBe(48);
  });
});

describe("layoutHeight", () => {
  it("covers the lowest bubble plus breathing room", () => {
    const layouts = layoutBubbles([box("a", 0, 40), box("b", 600, 90)]);
    expect(layoutHeight(layouts, 20)).toBe(710);
  });
});
