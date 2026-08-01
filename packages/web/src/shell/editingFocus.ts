import type { EditorMode } from "../types";

/**
 * How long focus may sit outside the editing surface before the ribbon leaves.
 *
 * Focus is not a steady signal during ordinary editing: reaching for the style
 * dropdown, a selection drag that ends in the margin, a click that lands on the
 * page's padding and bounces through <body>, all take focus off the editable
 * for a few milliseconds. Hiding on the first of those would strobe the
 * toolbar, which reads as broken — worse than the toolbar the user asked us to
 * get rid of. So leaving is always deferred and any return cancels it, while
 * arriving is instant: the ribbon appears the moment the caret is in the text.
 *
 * Long enough to swallow that churn, short enough that a deliberate click into
 * the comment rail feels like it dismissed the toolbar itself.
 */
export const RIBBON_HIDE_DELAY_MS = 240;

/**
 * What the DOM told us. `enter`/`leave` are about the *editing surface* — the
 * page and the ribbon — not about any one element, so moving between them (the
 * editable to a ribbon button and back) is not a signal at all.
 */
export type EditingSignal =
  | { type: "enter" }
  | { type: "leave" }
  /** The hide delay expired. */
  | { type: "settle" }
  /** Edit mode ended, or the surface went away. Immediate, no grace period. */
  | { type: "reset" };

export interface EditingFocus {
  /** The user is treated as editing: the caret is theirs and it is in the page. */
  readonly active: boolean;
  /** Focus is away and the hide is armed, waiting out {@link RIBBON_HIDE_DELAY_MS}. */
  readonly leaving: boolean;
}

export const EDITING_FOCUS_IDLE: EditingFocus = { active: false, leaving: false };

const EDITING_FOCUS_ACTIVE: EditingFocus = { active: true, leaving: false };

/**
 * The whole of the show/hide policy, as a pure function so it can be reasoned
 * about (and tested) without a DOM.
 *
 * Returns the *identical* object when nothing changes, so the caller's
 * `useState` bails out instead of re-rendering the shell on every focus event.
 */
export function nextEditingFocus(prev: EditingFocus, signal: EditingSignal): EditingFocus {
  switch (signal.type) {
    case "enter":
      /* Arriving is instant, and cancels any hide already armed. */
      return prev.active && !prev.leaving ? prev : EDITING_FOCUS_ACTIVE;

    case "leave":
      /* Only somewhere to leave from if we were editing. */
      if (!prev.active) return prev.leaving ? EDITING_FOCUS_IDLE : prev;
      return prev.leaving ? prev : { active: true, leaving: true };

    case "settle":
      /*
       * Ignored unless a hide is still armed: a timer that fires after the user
       * came back must not yank the ribbon out from under them.
       */
      return prev.leaving ? EDITING_FOCUS_IDLE : prev;

    case "reset":
      return prev.active || prev.leaving ? EDITING_FOCUS_IDLE : prev;
  }
}

/**
 * The ribbon belongs to edit mode *and* to actual editing. Selecting Edit and
 * then reading, or clicking into the comment rail, is not editing — and the
 * user has been clear that a toolbar hanging over the document then is the
 * thing they do not want.
 */
export function ribbonVisible(mode: EditorMode, focus: EditingFocus): boolean {
  return mode === "edit" && focus.active;
}
