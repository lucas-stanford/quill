import { useEffect, useRef } from "react";
import { useEditor } from "@tiptap/react";
import type { Editor, JSONContent } from "@tiptap/react";
import {
  alignSource,
  docToMarkdown,
  markdownToJSON,
  parseMarkdown,
} from "../markdown";
import type { SourceMap } from "../markdown";
import { editorExtensions } from "./extensions";
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
  /**
   * Whether the pending load is something the reviewer did and can therefore
   * take back — taking a name from the poll, say.
   *
   * The default is false, and that is the safe direction. The other loads are
   * the first one and the file changing underneath us, and neither is the
   * reviewer's edit: undoing an external reload would restore a document the
   * file no longer has and then autosave would write it back, quietly
   * overwriting whatever the agent had just put there.
   *
   * Must be set in the same render as the markdown it describes.
   */
  undoable?: boolean;
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
 *
 * The hook also carries the loaded file's formatting alongside the document.
 * Soft wraps mean nothing to the tree, so serialising from the tree alone
 * reflows every paragraph and one keystroke rewrites the whole file. The
 * `SourceMap` built while parsing lets the serialiser re-emit untouched blocks
 * as their original bytes. It is replaced in lockstep with the document, so an
 * external reload swaps in the new file's formatting at the same instant it
 * swaps in the new content.
 */
export function usePlanEditor({
  markdown,
  onChange,
  undoable = false,
}: UsePlanEditorOptions): Editor | null {
  // Guard: true while we are programmatically loading content
  const updatingRef = useRef(false);
  // Keep onChange stable across renders without re-creating the editor
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Read at load time, not at render time — the effect runs after the render
  // that changed `markdown`, so this holds the flag that came with it.
  const undoableRef = useRef(undoable);
  undoableRef.current = undoable;
  // Formatting of the markdown currently in the editor; null until first load,
  // during which the serialiser simply falls back to canonical output.
  const sourceRef = useRef<SourceMap | null>(null);
  // Parsed once, for the editor's initial document only.
  const initialRef = useRef<JSONContent | null>(null);
  if (initialRef.current === null) initialRef.current = markdownToJSON(markdown);

  const editor = useEditor(
    {
      extensions: editorExtensions,
      content: initialRef.current,
      immediatelyRender: false,
      editable: true,
      onUpdate: ({ editor: ed }) => {
        if (updatingRef.current) return;
        onChangeRef.current?.(
          docToMarkdown(ed.getJSON(), { source: sourceRef.current }),
        );
      },
    },
    [],
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const plan = parseMarkdown(markdown);
    // Installed before setContent so an update can never be serialised against
    // the previous document's formatting.
    sourceRef.current = plan.source;
    updatingRef.current = true;
    editor
      .chain()
      /*
       * Only the reviewer's own replacements join the undo stack. An external
       * reload is somebody else's write, and putting it there would offer an
       * undo that reverts to a document the file no longer has — which autosave
       * would then write back over the top of the agent's work.
       */
      .setMeta("addToHistory", undoableRef.current)
      .setContent(plan.doc, { emitUpdate: false })
      .run();
    updatingRef.current = false;
    // Now that the schema has had its say, record how it spells each block.
    alignSource(plan, editor.getJSON());
  }, [editor, markdown]);

  return editor;
}
