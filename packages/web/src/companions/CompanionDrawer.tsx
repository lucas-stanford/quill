import { useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { markdownToJSON } from "../markdown";
import { editorExtensions } from "../editor";
import type { CompanionsApi } from "./useCompanions";
import "./companions.css";

/**
 * companions/CompanionDrawer.tsx
 *
 * The research, on top of the plan rather than instead of it.
 *
 * An overlay, deliberately. Swapping the page's contents would mean unmounting
 * the plan's editor, and with it every pending tracked change and every
 * measured comment anchor — the reviewer would pay for a glance at the research
 * with the state of their review. Painting over it costs nothing to close.
 *
 * Read-only. The plan is the artifact that becomes tickets; the companions are
 * what it was argued from. Rendered through the same schema and stylesheet as
 * the plan so a heading is a heading and a table is a table.
 */
export function CompanionDrawer({ companions }: { companions: CompanionsApi }) {
  const { open, close } = companions;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const doc = useMemo(
    () => (open ? markdownToJSON(open.markdown) : null),
    [open],
  );

  const editor = useEditor(
    {
      extensions: editorExtensions,
      content: doc ?? { type: "doc", content: [] },
      editable: false,
      immediatelyRender: false,
    },
    // Re-created per document: this instance holds no user state, so there is
    // nothing to lose by rebuilding it, and rebuilding is what keeps a reopened
    // companion from showing the previous one for a frame.
    [open?.name, open?.markdown],
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    // Capture: Escape means "close the thing on top", and the thing on top is
    // this. Anything below that also listens for it must not act as well.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, close]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="companion-scrim" onMouseDown={close}>
      <div
        className="companion-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`${open.label} — ${open.name}`}
        tabIndex={-1}
        ref={panelRef}
        // The scrim closes; the panel is where you read, so a click, a drag to
        // select a paragraph, or a scroll inside it must not.
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="companion-head">
          <div className="companion-title">
            <span className="companion-label">{open.label}</span>
            <span className="companion-filename">{open.name}</span>
          </div>
          <button
            type="button"
            className="companion-close"
            onClick={close}
            aria-label="Close"
            title="Close (Esc)"
          >
            ✕
          </button>
        </header>

        <div className="companion-body">
          <div className="companion-sheet">
            {editor ? <EditorContent editor={editor} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
