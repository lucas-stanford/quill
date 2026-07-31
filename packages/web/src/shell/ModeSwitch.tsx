import type { EditorMode } from "../types";

/** FROZEN PROP CONTRACT — the shape may not change; the implementation is yours. */
export interface ModeSwitchProps {
  mode: EditorMode;
  onChange: (mode: EditorMode) => void;
}

// STUB — replaced by the shell workstream.
export function ModeSwitch({ mode, onChange }: ModeSwitchProps) {
  return (
    <button type="button" onClick={() => onChange(mode === "edit" ? "review" : "edit")}>
      {mode}
    </button>
  );
}
