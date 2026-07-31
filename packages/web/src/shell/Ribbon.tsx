import { useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import "./Ribbon.css";

/** FROZEN PROP CONTRACT — the shape may not change; the implementation is yours. */
export interface RibbonProps {
  /** The shared Tiptap instance. Null until the editor mounts. */
  editor: Editor | null;
}

/* ── Active-state snapshot (re-computed on every transaction) ── */

interface RibbonState {
  blockType: BlockType;
  isBold: boolean;
  isItalic: boolean;
  isCode: boolean;
  isBulletList: boolean;
  isOrderedList: boolean;
  isBlockquote: boolean;
  isCodeBlock: boolean;
}

type BlockType = "paragraph" | "heading1" | "heading2" | "heading3";

const DEFAULT_STATE: RibbonState = {
  blockType: "paragraph",
  isBold: false,
  isItalic: false,
  isCode: false,
  isBulletList: false,
  isOrderedList: false,
  isBlockquote: false,
  isCodeBlock: false,
};

function computeState(editor: Editor | null): RibbonState {
  if (!editor) return DEFAULT_STATE;

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

/* ── Ribbon ─────────────────────────────────────────────────── */

export function Ribbon({ editor }: RibbonProps) {
  /*
   * useEditorState subscribes to every ProseMirror transaction and
   * re-renders this component whenever the selection or marks change.
   * When editor is null the selector still runs; computeState handles that.
   */
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => computeState(e),
  }) ?? DEFAULT_STATE;

  const disabled = !editor;

  function applyBlock(type: BlockType) {
    if (!editor) return;
    switch (type) {
      case "paragraph":
        editor.chain().focus().setParagraph().run();
        break;
      case "heading1":
        editor.chain().focus().setHeading({ level: 1 }).run();
        break;
      case "heading2":
        editor.chain().focus().setHeading({ level: 2 }).run();
        break;
      case "heading3":
        editor.chain().focus().setHeading({ level: 3 }).run();
        break;
    }
  }

  return (
    <div className="ribbon" role="toolbar" aria-label="Formatting">
      {/* ── Block style dropdown ───────────────────────────── */}
      <select
        className="ribbon-style-select"
        value={state.blockType}
        disabled={disabled}
        aria-label="Paragraph style"
        onChange={(e) => applyBlock(e.target.value as BlockType)}
      >
        <option value="paragraph">Normal text</option>
        <option value="heading1">Heading 1</option>
        <option value="heading2">Heading 2</option>
        <option value="heading3">Heading 3</option>
      </select>

      <span className="ribbon-sep" aria-hidden="true" />

      {/* ── Inline marks ──────────────────────────────────── */}
      <RibbonButton
        label="Bold"
        title="Bold (Ctrl+B)"
        disabled={disabled}
        active={state.isBold}
        onClick={() => editor?.chain().focus().toggleBold().run()}
      >
        <BoldIcon />
      </RibbonButton>
      <RibbonButton
        label="Italic"
        title="Italic (Ctrl+I)"
        disabled={disabled}
        active={state.isItalic}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
      >
        <ItalicIcon />
      </RibbonButton>
      <RibbonButton
        label="Inline code"
        title="Inline code (Ctrl+E)"
        disabled={disabled}
        active={state.isCode}
        onClick={() => editor?.chain().focus().toggleCode().run()}
      >
        <InlineCodeIcon />
      </RibbonButton>

      <span className="ribbon-sep" aria-hidden="true" />

      {/* ── Lists ─────────────────────────────────────────── */}
      <RibbonButton
        label="Bulleted list"
        title="Bulleted list"
        disabled={disabled}
        active={state.isBulletList}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <BulletListIcon />
      </RibbonButton>
      <RibbonButton
        label="Numbered list"
        title="Numbered list"
        disabled={disabled}
        active={state.isOrderedList}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <NumberedListIcon />
      </RibbonButton>

      <span className="ribbon-sep" aria-hidden="true" />

      {/* ── Block-level formatting ─────────────────────────── */}
      <RibbonButton
        label="Blockquote"
        title="Blockquote"
        disabled={disabled}
        active={state.isBlockquote}
        onClick={() => editor?.chain().focus().toggleBlockquote().run()}
      >
        <BlockquoteIcon />
      </RibbonButton>
      <RibbonButton
        label="Code block"
        title="Code block"
        disabled={disabled}
        active={state.isCodeBlock}
        onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
      >
        <CodeBlockIcon />
      </RibbonButton>
    </div>
  );
}

/* ── Generic ribbon button ──────────────────────────────────── */

interface RibbonButtonProps {
  label: string;
  title: string;
  disabled: boolean;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}

function RibbonButton({ label, title, disabled, active, onClick, children }: RibbonButtonProps) {
  return (
    <button
      className={`ribbon-btn${active ? " ribbon-btn--active" : ""}`}
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* ── Icons ──────────────────────────────────────────────────── */
/* All 16×16, stroke="currentColor", filled only where shown    */

import type { ReactNode } from "react";

const ICON_PROPS = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 16 16",
  width: "16",
  height: "16",
  "aria-hidden": true as const,
};

function BoldIcon() {
  return (
    <svg {...ICON_PROPS} fill="currentColor">
      {/* Rounded B shape */}
      <path d="M4 2h4.5a3 3 0 0 1 2 5.2A3.3 3.3 0 0 1 8.8 14H4V2zm2 2v3.5h2.5a1 1 0 0 0 0-2H6zm0 5.5V12h2.8a1.3 1.3 0 0 0 0-2.5H6z" />
    </svg>
  );
}

function ItalicIcon() {
  return (
    <svg {...ICON_PROPS} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <line x1="10" y1="2.5" x2="7" y2="13.5" />
      <line x1="7.5" y1="2.5" x2="12" y2="2.5" />
      <line x1="4" y1="13.5" x2="8.5" y2="13.5" />
    </svg>
  );
}

function InlineCodeIcon() {
  return (
    <svg {...ICON_PROPS} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="5.5,4 1.5,8 5.5,12" />
      <polyline points="10.5,4 14.5,8 10.5,12" />
    </svg>
  );
}

function BulletListIcon() {
  return (
    <svg {...ICON_PROPS} fill="currentColor">
      <circle cx="2.5" cy="4.5" r="1.2" />
      <rect x="5.5" y="3.8" width="8.5" height="1.4" rx="0.7" />
      <circle cx="2.5" cy="8" r="1.2" />
      <rect x="5.5" y="7.3" width="8.5" height="1.4" rx="0.7" />
      <circle cx="2.5" cy="11.5" r="1.2" />
      <rect x="5.5" y="10.8" width="8.5" height="1.4" rx="0.7" />
    </svg>
  );
}

function NumberedListIcon() {
  return (
    <svg {...ICON_PROPS} fill="currentColor">
      {/* "1" */}
      <path d="M2 2.5h1V6H2V3.3H1.3V2.5H2z" />
      {/* "2" */}
      <path d="M1 8.5c0-.9.6-1.5 1.5-1.5S4 7.6 4 8.5c0 .6-.3 1-.7 1.4L2 11.4h2V12H1v-.5l1.8-1.7c.3-.3.5-.5.5-.8 0-.4-.3-.7-.8-.7s-.8.3-.8.7H1z" />
      <rect x="5.5" y="3.8" width="8.5" height="1.4" rx="0.7" />
      <rect x="5.5" y="7.3" width="8.5" height="1.4" rx="0.7" />
      <rect x="5.5" y="10.8" width="8.5" height="1.4" rx="0.7" />
    </svg>
  );
}

function BlockquoteIcon() {
  return (
    <svg {...ICON_PROPS} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      {/* Vertical accent bar */}
      <line x1="3" y1="3" x2="3" y2="13" strokeWidth="2.5" />
      {/* Text lines */}
      <line x1="6" y1="5" x2="14" y2="5" />
      <line x1="6" y1="8" x2="14" y2="8" />
      <line x1="6" y1="11" x2="11" y2="11" />
    </svg>
  );
}

function CodeBlockIcon() {
  return (
    <svg {...ICON_PROPS} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {/* Rounded rectangle */}
      <rect x="1.5" y="3" width="13" height="10" rx="2" />
      {/* Angle brackets inside */}
      <polyline points="5,6.5 3.5,8 5,9.5" strokeWidth="1.4" />
      <polyline points="11,6.5 12.5,8 11,9.5" strokeWidth="1.4" />
      <line x1="8.5" y1="6" x2="7.5" y2="10" strokeWidth="1.3" />
    </svg>
  );
}
