import { useRef } from "react";
import type { KeyboardEvent } from "react";
import type { EditorMode } from "../types";
import { MODE_HINT, MODE_LABEL, MODE_ORDER, nextModeForKey } from "./modeSwitchKeys";
import "./ModeSwitch.css";

/** FROZEN PROP CONTRACT — the shape may not change; the implementation is yours. */
export interface ModeSwitchProps {
  mode: EditorMode;
  onChange: (mode: EditorMode) => void;
}

/**
 * Word-like segmented control: two labelled options, one obviously current.
 *
 * Built as an ARIA radiogroup with a roving tabindex, so the pair is a single
 * tab stop and the arrow keys move between — and select — the options, which
 * is what a screen reader user expects of a segmented control. Selecting a
 * mode also moves DOM focus onto it, keeping focus and the roving tabindex in
 * step.
 */
export function ModeSwitch({ mode, onChange }: ModeSwitchProps) {
  const optionRefs = useRef(new Map<EditorMode, HTMLButtonElement>());

  function select(next: EditorMode) {
    optionRefs.current.get(next)?.focus();
    if (next !== mode) onChange(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = nextModeForKey(mode, event.key);
    if (!next) return;
    event.preventDefault();
    select(next);
  }

  return (
    <div
      className="mode-switch"
      role="radiogroup"
      aria-label="Editor mode"
      onKeyDown={handleKeyDown}
    >
      {MODE_ORDER.map((option) => {
        const selected = option === mode;
        return (
          <button
            key={option}
            ref={(el) => {
              if (el) optionRefs.current.set(option, el);
              else optionRefs.current.delete(option);
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            /* Roving tabindex: only the current option is in the tab order. */
            tabIndex={selected ? 0 : -1}
            className={`mode-switch-option${selected ? " mode-switch-option--on" : ""}`}
            title={MODE_HINT[option]}
            onClick={() => select(option)}
          >
            {option === "edit" ? <PencilIcon /> : <CommentIcon />}
            <span>{MODE_LABEL[option]}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Icons ──────────────────────────────────────────────────── */

const ICON_PROPS = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 16 16",
  width: "13",
  height: "13",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.5",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
};

function PencilIcon() {
  return (
    <svg {...ICON_PROPS}>
      {/* Pencil over a baseline — "write" */}
      <path d="M11.2 1.9a1.7 1.7 0 0 1 2.4 2.4L6.1 11.8l-3.1.8.8-3.1z" />
      <line x1="2.5" y1="14.5" x2="13.5" y2="14.5" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg {...ICON_PROPS}>
      {/* Speech balloon with a tail — "comment" */}
      <path d="M13.8 9.6a1.7 1.7 0 0 1-1.7 1.7H6.2L3.2 14V4.1a1.7 1.7 0 0 1 1.7-1.7h7.2a1.7 1.7 0 0 1 1.7 1.7z" />
    </svg>
  );
}
