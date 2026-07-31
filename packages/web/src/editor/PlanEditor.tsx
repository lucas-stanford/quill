import { EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/react";

/** FROZEN PROP CONTRACT — the shape may not change; the implementation is yours. */
export interface PlanEditorProps {
  /** The shared Tiptap instance from usePlanEditor(), owned by App. */
  editor: Editor | null;
}

export function PlanEditor({ editor }: PlanEditorProps) {
  return <EditorContent editor={editor} />;
}
