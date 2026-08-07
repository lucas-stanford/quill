/**
 * editor/useUndoRedo.ts
 *
 * Undo that works when the caret is not in the document.
 *
 * ProseMirror binds Mod-Z on the editor itself, so undo only exists while the
 * document has focus. That is fine for typing and useless for everything else
 * this app does: taking a name from the poll, applying a companion's answer,
 * accepting a hunk from the review bar. Each of those changes the document from
 * a control somewhere else on the page, and every one of them left the reviewer
 * with a change they could see and no way to take back — the one keystroke
 * everybody tries first did nothing at all.
 *
 * So the shortcut is bound at the window instead, and forwarded to the editor.
 *
 * Fields keep their own undo. A textarea has a perfectly good native history
 * and the reviewer typing in the feedback composer means "undo my sentence",
 * not "undo the document" — so anything that is itself an editing surface is
 * left alone. The document's own contenteditable is the exception: that IS the
 * editor, and ProseMirror will have handled the key already.
 */

import { useEffect } from "react";
import type { Editor } from "@tiptap/react";

/** Editing surfaces that own their undo stack, and must keep it. */
function ownsItsHistory(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;
  // Checkboxes and buttons have nothing to undo; text-like inputs do.
  return !/^(checkbox|radio|button|submit|reset|range|color|file)$/i.test(
    (target as HTMLInputElement).type,
  );
}

export interface UndoRedoKey {
  undo: boolean;
  redo: boolean;
}

/**
 * Which of the two, if either, a key event asks for. Exported so the mapping is
 * testable without a browser: it is the part that is easy to get subtly wrong
 * across platforms.
 */
export function classifyUndoKey(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): UndoRedoKey {
  const none = { undo: false, redo: false };
  if (event.altKey) return none;
  // Meta on a Mac, Control elsewhere. Accepting either costs nothing and means
  // a keyboard with the other convention still works.
  if (!event.metaKey && !event.ctrlKey) return none;

  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? { undo: false, redo: true } : { undo: true, redo: false };
  // Ctrl+Y is redo on Windows, and costs one line to honour.
  if (key === "y" && !event.metaKey && !event.shiftKey) return { undo: false, redo: true };
  return none;
}

export function useUndoRedo(editor: Editor | null): void {
  useEffect(() => {
    if (!editor) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const { undo, redo } = classifyUndoKey(event);
      if (!undo && !redo) return;
      if (ownsItsHistory(event.target)) return;
      if (editor.isDestroyed) return;

      /*
       * Focus first. Undo moves the selection to what it restored, and a
       * selection in a document nobody is looking at is a change the reviewer
       * has to go and find — so the same keystroke also puts the caret back in
       * the page, which is where the next one needs it anyway.
       */
      const ran = redo
        ? editor.chain().focus().redo().run()
        : editor.chain().focus().undo().run();
      // Nothing left to undo is not a reason to let the browser undo something
      // else on the page; the key was aimed at the document either way.
      event.preventDefault();
      if (!ran) return;
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editor]);
}
