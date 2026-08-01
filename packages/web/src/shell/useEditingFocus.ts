import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  EDITING_FOCUS_IDLE,
  RIBBON_HIDE_DELAY_MS,
  nextEditingFocus,
} from "./editingFocus";
import type { EditingFocus, EditingSignal } from "./editingFocus";

export interface EditingFocusOptions {
  /** Watch focus at all — false outside edit mode, where the ribbon is gone anyway. */
  enabled: boolean;
  /**
   * The editing surface: the page (which contains the ProseMirror editable) and
   * the ribbon acting on it. Focus anywhere inside either counts as editing, so
   * reaching for a toolbar control never dismisses the toolbar.
   */
  surfaces: ReadonlyArray<RefObject<HTMLElement | null>>;
}

/**
 * Is the user *actually* editing right now?
 *
 * Mode alone is not the answer. "Edit" is a setting; editing is an activity,
 * and the user's complaint — twice — is about a formatting toolbar hanging over
 * a document nobody is typing into. So the ribbon follows the caret: it is here
 * while the page (or the ribbon itself) holds focus, and it leaves when focus
 * goes to a comment bubble, the rail, the title bar or another window.
 *
 * The hard part is not the rule, it is the noise. Focus moves transiently all
 * through normal interaction, so:
 *
 *   - arriving is instant, leaving is debounced by {@link RIBBON_HIDE_DELAY_MS};
 *   - any arrival cancels a pending departure, so a bounce through <body> or a
 *     hop from the editable to the style dropdown is not visible at all;
 *   - the surface is two whole subtrees, not one element, so movement *within*
 *     the editing chrome never registers as leaving in the first place;
 *   - the delay is derived state, not a hand-managed timer, so React's own
 *     cleanup cancels it — there is no window in which a stale timeout can fire
 *     against a caret that has come back.
 *
 * Ribbon buttons additionally `preventDefault` their mousedown (M3), so
 * clicking Bold never moves focus off the text at all.
 */
export function useEditingFocus({ enabled, surfaces }: EditingFocusOptions): EditingFocus {
  const [focus, setFocus] = useState(EDITING_FOCUS_IDLE);

  /* Read through a ref so a new array identity cannot tear down the listeners. */
  const surfacesRef = useRef(surfaces);
  surfacesRef.current = surfaces;

  const send = useCallback((signal: EditingSignal) => {
    setFocus((prev) => nextEditingFocus(prev, signal));
  }, []);

  /*
   * The hide delay, expressed as state rather than as a timer someone has to
   * remember to clear: coming back clears `leaving`, which tears this effect
   * down, which cancels the timeout.
   */
  useEffect(() => {
    if (!focus.leaving) return;
    const id = window.setTimeout(() => send({ type: "settle" }), RIBBON_HIDE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [focus.leaving, send]);

  useEffect(() => {
    if (!enabled) {
      /* Leaving edit mode drops the ribbon at once; no grace period to race. */
      send({ type: "reset" });
      return;
    }

    const contains = (node: EventTarget | null): boolean =>
      node instanceof Node &&
      surfacesRef.current.some((ref) => ref.current?.contains(node) ?? false);

    const onFocusIn = (event: FocusEvent) => {
      send({ type: contains(event.target) ? "enter" : "leave" });
    };

    /*
     * `focusout` carries the element focus is going *to*; a null one means it
     * is going nowhere (a click on the canvas, say, which lands on <body>).
     * `focusin` alone would miss that case entirely.
     */
    const onFocusOut = (event: FocusEvent) => {
      if (!contains(event.relatedTarget)) send({ type: "leave" });
    };

    const onWindowBlur = () => {
      /*
       * Another window has it — that is not editing either. The exception is a
       * native <select> popup, which on some platforms is a real window: the
       * style dropdown must not dismiss the ribbon it lives in.
       */
      const active = document.activeElement;
      if (active instanceof HTMLSelectElement && contains(active)) return;
      send({ type: "leave" });
    };

    const onWindowFocus = () => {
      if (contains(document.activeElement)) send({ type: "enter" });
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);

    /* Adopt whatever focus is already there when edit mode turns on. */
    if (contains(document.activeElement)) send({ type: "enter" });

    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onWindowFocus);
    };
  }, [enabled, send]);

  return focus;
}
