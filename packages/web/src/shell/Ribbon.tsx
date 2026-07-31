import type { Editor } from "@tiptap/react";

/** FROZEN PROP CONTRACT — the shape may not change; the implementation is yours. */
export interface RibbonProps {
  /** The shared Tiptap instance. Null until the editor mounts. */
  editor: Editor | null;
}

// STUB — replaced by the ribbon workstream.
export function Ribbon(_props: RibbonProps) {
  return null;
}
