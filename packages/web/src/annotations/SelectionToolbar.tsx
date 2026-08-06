/**
 * annotations/SelectionToolbar.tsx
 *
 * The comment action, hovering by the text it acts on.
 *
 * Three decisions worth knowing:
 *
 *   1. It is a PORTAL to <body>. The rail it is rendered from is dimmed in
 *      edit mode, hidden outright on a narrow window, and carries a
 *      `drop-shadow` filter in that tier — and a filter is a containing block
 *      for `position: fixed`, which would break viewport anchoring outright.
 *      At body level the toolbar is subject to none of that and cannot be
 *      clipped by the canvas's own scroll box either.
 *
 *   2. It REPOSITIONS on scroll (one measurement per animation frame) rather
 *      than hiding, and hides only once the text itself has left the visible
 *      band. Every frame is recomputed from the selection's live client rects,
 *      so the control cannot drift away from its words: it either sits by them
 *      or it is gone.
 *
 *   3. It never takes focus from the document. `mousedown` is prevented — the
 *      same trick the ribbon uses — so the selection it acts on is still there
 *      when the click lands.
 *
 * It creates nothing itself: the button calls `beginDraft()`, exactly what the
 * rail's button and the ⌘⌥M shortcut have always called, so there stays one
 * composer and one comment-creation path.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RefObject } from "react";
import type { AnnotationsInternal } from "./internal";
import { chromeBottom, isVisible } from "./selectionGeometry";
import { placeSelectionToolbar, samePlacement } from "./selectionPlacement";
import type { Placement } from "./selectionPlacement";
import "./selectionToolbar.css";
export interface SelectionToolbarProps {
  internal: AnnotationsInternal | null;
  /**
   * The rail, where the composer this opens will appear. When the rail cannot
   * be seen the control hides rather than offering a dead end.
   */
  railRef: RefObject<HTMLElement | null>;
  /** Bumped when a comment is created, so the toolbar settles afterwards. */
  createdTick: number;
  /**
   * Starts the comment. This is the rail's own draft entry point, so the
   * floating control adds an affordance, never a second creation path.
   */
  onComment: () => void;
}

/** Used for the very first measurement only; the real box is read from the DOM. */
const ESTIMATED_SIZE = { width: 104, height: 28 };

export function SelectionToolbar({
  internal,
  railRef,
  createdTick,
  onComment,
}: SelectionToolbarProps) {
  const internalRef = useRef(internal);
  internalRef.current = internal;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const [placement, setPlacement] = useState<Placement | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [hasFocus, setHasFocus] = useState(false);
  const [pointerDown, setPointerDown] = useState(false);

  const selectionKey = internal?.selectionKey ?? "";
  const selectionKeyRef = useRef(selectionKey);
  selectionKeyRef.current = selectionKey;

  const geometry = internal?.geometry ?? 0;
  const draftOpen = internal?.draft != null;

  /*
   * Anchored: there is a selection worth acting on. Wanted: it should also be
   * on screen right now. They are separate because focus-within must not be
   * able to keep the toolbar alive once its selection is gone — a focused node
   * that is removed fires no blur, so that state has to be released here.
   */
  const anchored =
    selectionKey !== "" && !draftOpen && !pointerDown && dismissed !== selectionKey;
  const wanted = anchored && (internal?.editorFocused === true || hasFocus);

  useEffect(() => {
    if (!anchored && hasFocus) setHasFocus(false);
  }, [anchored, hasFocus]);

  /* ── Portal host ────────────────────────────────────────────────────── */

  if (hostRef.current === null && typeof document !== "undefined") {
    const host = document.createElement("div");
    host.className = "quill-selection-host";
    hostRef.current = host;
  }

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    document.body.appendChild(host);
    return () => host.remove();
  }, []);

  /* ── Placement ──────────────────────────────────────────────────────── */

  const reposition = useCallback(() => {
    const current = internalRef.current;
    const root = rootRef.current;
    if (!current || !root) return;

    const geometry = current.measureSelection();
    // No rects, or nowhere for the composer to open: say nothing.
    if (!geometry || !isVisible(railRef.current)) {
      setPlacement((prev) => (samePlacement(prev, { visible: false }) ? prev : { visible: false }));
      return;
    }

    const box = root.getBoundingClientRect();
    const next = placeSelectionToolbar({
      selection: geometry.selection,
      bounds: geometry.bounds,
      toolbar: {
        width: box.width || ESTIMATED_SIZE.width,
        height: box.height || ESTIMATED_SIZE.height,
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      chromeBottom: chromeBottom(),
    });

    setPlacement((prev) => (samePlacement(prev, next) ? prev : next));
    // Focus must not be left on a control that has just been parked.
    if (!next.visible && rootRef.current?.contains(document.activeElement)) {
      current.focusDocument();
    }
  }, [railRef]);

  // Measured before paint, so the toolbar never flashes at a stale position.
  useLayoutEffect(() => {
    if (!wanted) {
      setPlacement((prev) => (prev === null ? prev : null));
      return;
    }
    reposition();
  }, [wanted, selectionKey, geometry, reposition]);

  /*
   * Scrolling and resizing move the text, so they move the toolbar. One
   * measurement per frame keeps a fast scroll cheap; `capture` catches the
   * canvas's own scroll, which does not bubble.
   */
  useEffect(() => {
    if (!wanted) return;
    let frame = 0;
    const schedule = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        reposition();
      });
    };
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [wanted, reposition]);

  /*
   * Nothing pops up mid-drag: while the pointer is down the selection is still
   * being made, and a control appearing under the cursor would be in the way.
   * Our own button is exempt, or pressing it would dismiss the thing pressed.
   */
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setPointerDown(true);
    };
    const onUp = () => setPointerDown(false);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
  }, []);

  /* ── Dismissal and keyboard ─────────────────────────────────────────── */

  const dismiss = useCallback(() => {
    setDismissed(selectionKeyRef.current);
    if (rootRef.current?.contains(document.activeElement)) {
      internalRef.current?.focusDocument();
    }
  }, []);

  useEffect(() => {
    if (!wanted) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismiss();
        return;
      }
      // The Office/TinyMCE convention for "put focus on the toolbar", so a
      // keyboard user can reach the button without hunting through Tab stops.
      if (event.key === "F10" && event.altKey) {
        event.preventDefault();
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [wanted, dismiss]);

  // A comment was just made on this selection; stop hovering over it.
  const createdRef = useRef(createdTick);
  useEffect(() => {
    if (createdTick === createdRef.current) return;
    createdRef.current = createdTick;
    setDismissed(selectionKeyRef.current);
  }, [createdTick]);

  /* ── Render ─────────────────────────────────────────────────────────── */

  const host = hostRef.current;
  if (!wanted || !host) return null;

  const placed = placement?.visible === true;

  return createPortal(
    <div
      ref={rootRef}
      className="quill-selection-toolbar"
      role="toolbar"
      aria-label="Selection actions"
      data-placed={placed ? "" : undefined}
      data-side={placed && placement.visible ? placement.side : undefined}
      // Parked (measuring, or scrolled out of the band): out of reach and out
      // of the accessibility tree, exactly as the ribbon does while hidden.
      inert={!placed}
      aria-hidden={!placed || undefined}
      style={
        placement?.visible === true
          ? { top: `${placement.top}px`, left: `${placement.left}px` }
          : undefined
      }
      // The ribbon's trick: keep the selection the click is about to act on.
      onMouseDown={(event) => event.preventDefault()}
      onFocus={() => setHasFocus(true)}
      onBlur={() => setHasFocus(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        className="quill-selection-button"
        aria-label="Comment on the selected text"
        aria-keyshortcuts="Meta+Alt+M Control+Alt+M"
        title="Comment on the selected text (⌘⌥M)"
        onClick={() => onComment()}
      >
        <CommentGlyph />
        Comment
      </button>
    </div>,
    host,
  );
}

function CommentGlyph() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6A1.5 1.5 0 0 1 12.5 11H6.5L3 14v-3H3.5A1.5 1.5 0 0 1 2 9.5z" />
    </svg>
  );
}
