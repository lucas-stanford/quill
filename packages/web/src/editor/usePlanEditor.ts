import { useEffect, useRef } from "react";
import { useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { markdownToJSON, docToMarkdown } from "../markdown";
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

/**
 * Manages a Tiptap editor instance with lossless markdown round-trip.
 *
 * CRITICAL: onChange fires ONLY for real user edits, never for programmatic
 * content loads. This is enforced two ways:
 *   1. setContent is always called with { emitUpdate: false }, which sets the
 *      "preventUpdate" transaction meta and suppresses the editor's "update"
 *      event entirely.
 *   2. A ref-based guard (updatingRef) provides a belt-and-suspenders check.
 */
export function usePlanEditor({
  markdown,
  onChange,
}: UsePlanEditorOptions): Editor | null {
  // Guard: true while we are programmatically loading content
  const updatingRef = useRef(false);
  // Keep onChange stable across renders without re-creating the editor
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor(
    {
      extensions: [StarterKit],
      content: markdownToJSON(markdown),
      immediatelyRender: false,
      editable: true,
      onUpdate: ({ editor: ed }) => {
        if (updatingRef.current) return;
        onChangeRef.current?.(docToMarkdown(ed.getJSON()));
      },
    },
    [],
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    updatingRef.current = true;
    editor.commands.setContent(markdownToJSON(markdown), {
      emitUpdate: false,
    });
    updatingRef.current = false;
  }, [editor, markdown]);

  return editor;
}
