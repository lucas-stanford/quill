import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { marked } from "marked";
import "./editor.css";

/** FROZEN PROP CONTRACT — the shape may not change; the implementation is yours. */
export interface PlanEditorProps {
  /** Raw markdown source of the plan. */
  markdown: string;
}

/** Convert markdown to HTML with GFM and no smart-quote substitutions. */
function mdToHtml(src: string): string {
  return marked(src, { async: false, gfm: true, breaks: false });
}

export function PlanEditor({ markdown }: PlanEditorProps) {
  const editor = useEditor(
    {
      extensions: [StarterKit],
      content: mdToHtml(markdown),
      // Prevents SSR/StrictMode hydration mismatch warnings.
      immediatelyRender: false,
      editable: true,
    },
    // Never recreate the editor instance — content updates via setContent below.
    [],
  );

  // Keep editor content in sync when the markdown prop changes identity.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.setContent(mdToHtml(markdown), { emitUpdate: false });
  }, [editor, markdown]);

  return <EditorContent editor={editor} />;
}
