/**
 * annotations/layout.ts
 *
 * Where the margin bubbles sit. Every bubble wants to sit level with its
 * anchored text; bubbles must never overlap. The rule is Word's: lay them out
 * at their preferred position in document order and push down on collision.
 *
 * The one refinement is the focused thread. When a bubble is active it is
 * pulled back to its anchor and the bubbles above it are pushed *up* to make
 * room, which is what makes clicking a bubble feel like it snaps to the text.
 * The pull-up is bounded by the stack of bubbles above it so nothing can be
 * pushed off the top of the rail.
 *
 * Pure arithmetic, no DOM — unit tested in layout.test.ts.
 */

/** Vertical breathing room between two bubbles, in pixels. */
export const BUBBLE_GAP = 10;

export interface BubbleBox {
  id: string;
  /** Preferred top, level with the anchored text, in rail coordinates. */
  anchorTop: number;
  /** Measured height of the rendered bubble. */
  height: number;
}

export interface BubbleLayout {
  id: string;
  top: number;
  anchorTop: number;
  height: number;
}

/**
 * @param boxes    bubbles in document order
 * @param activeId the focused thread, pulled to its anchor if it can be
 */
export function layoutBubbles(
  boxes: readonly BubbleBox[],
  activeId?: string | null,
  gap: number = BUBBLE_GAP,
): BubbleLayout[] {
  const tops = new Array<number>(boxes.length);

  // Pass 1 — preferred position, pushed down by whatever is above.
  let cursor = 0;
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i]!;
    const top = Math.max(box.anchorTop, cursor);
    tops[i] = top;
    cursor = top + box.height + gap;
  }

  // Pass 2 — pull the focused bubble back to its anchor, pushing its
  // neighbours out of the way in both directions.
  const active = activeId ? boxes.findIndex((b) => b.id === activeId) : -1;
  if (active >= 0) {
    // The bubbles above need somewhere to go, so this is how high it can be.
    let ceiling = 0;
    for (let i = 0; i < active; i++) ceiling += boxes[i]!.height + gap;

    const want = Math.max(boxes[active]!.anchorTop, ceiling);
    if (want !== tops[active]) {
      tops[active] = want;

      for (let i = active - 1; i >= 0; i--) {
        const limit = tops[i + 1]! - gap - boxes[i]!.height;
        if (tops[i]! <= limit) break;
        tops[i] = limit;
      }

      cursor = tops[active]! + boxes[active]!.height + gap;
      for (let i = active + 1; i < boxes.length; i++) {
        const top = Math.max(boxes[i]!.anchorTop, cursor);
        tops[i] = top;
        cursor = top + boxes[i]!.height + gap;
      }
    }
  }

  return boxes.map((box, i) => ({
    id: box.id,
    top: tops[i]!,
    anchorTop: box.anchorTop,
    height: box.height,
  }));
}

/** Total height the rail needs to show every bubble. */
export function layoutHeight(layouts: readonly BubbleLayout[], pad = 48): number {
  let bottom = 0;
  for (const l of layouts) bottom = Math.max(bottom, l.top + l.height);
  return bottom + pad;
}
