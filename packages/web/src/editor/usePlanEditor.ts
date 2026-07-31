import { useEffect } from "react";
import { useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { marked } from "marked";
import "./editor.css";

export interface UsePlanEditorOptions {
  /**
   * Markdown to load. Changing this REPLACES the document, so callers must only
   * change it on load or on an accepted external reload — never feed back the
   * markdown produced by `onChange`.
   */
  markdown: string;
  /** Called on every user edit with the document serialized back to markdown. */
  onChange?: (markdown: string) => void;
}

function mdToHtml(src: string): string {
  return marked(src, { async: false, gfm: true, breaks: false });
}

/**
 * SCAFFOLD — the roundtrip workstream replaces this with a lossless
 * markdown <-> ProseMirror implementation and wires `onChange`.
 */
export function usePlanEditor({ markdown }: UsePlanEditorOptions): Editor | null {
  const editor = useEditor(
    {
      extensions: [StarterKit],
      content: mdToHtml(markdown),
      immediatelyRender: false,
      editable: true,
    },
    [],
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.setContent(mdToHtml(markdown), { emitUpdate: false });
  }, [editor, markdown]);

  return editor;
}
