import { useEffect, useState } from "react";
import type { Editor, EditorEvents } from "@tiptap/react";

export type BlockType = "paragraph" | "heading1" | "heading2" | "heading3";

export interface RibbonState {
  blockType: BlockType;
  isBold: boolean;
  isItalic: boolean;
  isCode: boolean;
  isBulletList: boolean;
  isOrderedList: boolean;
  isBlockquote: boolean;
  isCodeBlock: boolean;
}

/**
 * What the ribbon reports when there is no caret to describe: nothing applied,
 * and the style dropdown resting on its neutral entry.
 */
export const NO_CARET_STATE: RibbonState = {
  blockType: "paragraph",
  isBold: false,
  isItalic: false,
  isCode: false,
  isBulletList: false,
  isOrderedList: false,
  isBlockquote: false,
  isCodeBlock: false,
};

function readCaretState(editor: Editor): RibbonState {
  let blockType: BlockType = "paragraph";
  if (editor.isActive("heading", { level: 1 })) blockType = "heading1";
  else if (editor.isActive("heading", { level: 2 })) blockType = "heading2";
  else if (editor.isActive("heading", { level: 3 })) blockType = "heading3";

  return {
    blockType,
    isBold: editor.isActive("bold"),
    isItalic: editor.isActive("italic"),
    isCode: editor.isActive("code"),
    isBulletList: editor.isActive("bulletList"),
    isOrderedList: editor.isActive("orderedList"),
    isBlockquote: editor.isActive("blockquote"),
    isCodeBlock: editor.isActive("codeBlock"),
  };
}

interface Pulse {
  /** Bumped per transaction purely to re-render; the state is never cached. */
  tick: number;
  /**
   * False once the whole document has been swapped out from under the caret and
   * the user has not touched the editor since.
   */
  caretSurvived: boolean;
}

const INITIAL_PULSE: Pulse = { tick: 0, caretSurvived: true };

/**
 * Re-render on every editor transaction, and notice when a transaction replaced
 * the document programmatically.
 *
 * `App` builds the editor with empty content and installs the real plan later
 * with `setContent(..., { emitUpdate: false })`, which sets ProseMirror's
 * `preventUpdate` meta — the same load happens again whenever the file changes
 * on disk. ProseMirror maps the outgoing selection through that whole-document
 * replacement, so afterwards the caret sits at an arbitrary spot (in practice
 * the end of the new document) that the user never chose.
 *
 * Deliberately no derived state is cached here: `useEditorState` memoises its
 * snapshot behind a transaction counter that only starts ticking once its own
 * effect has run, so a ribbon that mounts around the document load can pin
 * itself to the empty editor. Everything is re-read from the live editor at
 * render time instead.
 */
function useEditorPulse(editor: Editor | null): Pulse {
  const [pulse, setPulse] = useState<Pulse>(INITIAL_PULSE);

  useEffect(() => {
    if (!editor) return;

    // A single dispatch emits both `transaction` and `update`; react once.
    let seen: unknown;
    const onTransaction = ({ transaction }: EditorEvents["transaction"]) => {
      if (transaction === seen) return;
      seen = transaction;
      const replacedDocument =
        transaction.docChanged && transaction.getMeta("preventUpdate") === true;
      setPulse((prev) => ({ tick: prev.tick + 1, caretSurvived: !replacedDocument }));
    };

    editor.on("transaction", onTransaction);
    editor.on("update", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
      editor.off("update", onTransaction);
    };
  }, [editor]);

  return pulse;
}

export interface RibbonStateResult {
  /** Formatting at the caret, or `NO_CARET_STATE` when there is no caret. */
  state: RibbonState;
  /**
   * Spread onto the ribbon container. Reaching for a ribbon control — the style
   * `<select>`, or Tab from the document — takes focus off the editor but is
   * still the user working on their caret, so it must not blank the ribbon.
   */
  toolbarFocusProps: { onFocus: () => void; onBlur: () => void };
}

/**
 * The ribbon describes the caret. If there is no caret it describes nothing,
 * rather than reporting formatting for a position ProseMirror happened to leave
 * the selection in.
 *
 * A caret is the user's when the document (or the ribbon acting on it) holds
 * focus and the document has not been replaced underneath it since. Both halves
 * are needed: focus alone would light up the ribbon when a reload lands while
 * the editor is focused, and the replacement check alone would trust a
 * selection nobody has placed yet on first paint.
 */
export function useRibbonState(editor: Editor | null): RibbonStateResult {
  const { caretSurvived } = useEditorPulse(editor);
  const [toolbarHasFocus, setToolbarHasFocus] = useState(false);

  const hasCaret =
    editor !== null && caretSurvived && (editor.isFocused || toolbarHasFocus);

  return {
    state: editor && hasCaret ? readCaretState(editor) : NO_CARET_STATE,
    toolbarFocusProps: {
      onFocus: () => setToolbarHasFocus(true),
      onBlur: () => setToolbarHasFocus(false),
    },
  };
}
