import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent } from "@tiptap/react";
import { usePlanEditor } from "../editor";
import type { CompanionsApi } from "./useCompanions";
import { useCompanionDoc } from "./useCompanionDoc";
import { useSectionRevision } from "./useSectionRevision";
import { removeSection } from "./sections";
import type { Section } from "./sections";
import "./companions.css";

/**
 * companions/CompanionDrawer.tsx
 *
 * The research, on top of the plan rather than instead of it — and now
 * something you can act on rather than only read.
 *
 * An overlay, deliberately. Swapping the page's contents would mean unmounting
 * the plan's editor, and with it every pending tracked change and every
 * measured comment anchor; the reviewer would pay for a glance at the research
 * with the state of their review. Painting over it costs nothing to close.
 *
 * The unit of action is the `##` section, because that is the unit research is
 * made of: a line of enquiry, with its findings and its citations. You re-run
 * one, push one further, or cut one, and the sections you were happy with are
 * left alone.
 */
export function CompanionDrawer({ companions }: { companions: CompanionsApi }) {
  const { open, close } = companions;
  const name = open?.name ?? null;
  const panelRef = useRef<HTMLDivElement | null>(null);

  const document = useCompanionDoc(name);
  const [activeIndex, setActiveIndex] = useState(0);
  const [asking, setAsking] = useState<null | {
    kind: "redo" | "deepen" | "add";
    section: Section | null;
  }>(null);
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [cut, setCut] = useState<{ title: string; text: string }[]>([]);

  const revision = useSectionRevision({
    document: name,
    markdown: document.markdown,
    onResult: document.replaceAll,
  });

  const editor = usePlanEditor({
    markdown: document.content,
    onChange: document.onChange,
  });

  const sections = document.sections;
  const active = sections[Math.min(activeIndex, Math.max(0, sections.length - 1))] ?? null;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      // Whatever is on top goes first: the ask dialog, then the drawer.
      if (asking !== null) setAsking(null);
      else close();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, close, asking]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
    setCut([]);
    setAsking(null);
  }, [name]);

  const busy = revision.status === "queued" || revision.status === "working";

  const statusLine = useMemo(() => {
    if (revision.error) return revision.error;
    if (busy) return `Asking the agent about ${revision.pending ?? "the document"}…`;
    if (revision.status === "done") return "The agent answered.";
    switch (document.saveState) {
      case "dirty":
        return "Unsaved changes";
      case "saving":
        return "Saving…";
      case "saved":
        return "Saved";
      case "stale":
        return "Reloaded — the agent had rewritten this file";
      case "error":
        return document.error ?? "Save failed";
      default:
        return null;
    }
  }, [busy, revision.error, revision.pending, revision.status, document.saveState, document.error]);

  if (!open) return null;

  const ask = (kind: "redo" | "deepen" | "add", section: Section | null) => {
    setNote("");
    setMode(kind === "add" ? "append" : "replace");
    setAsking({ kind, section });
  };

  const send = () => {
    if (!asking) return;
    revision.run(asking.section, asking.kind, mode, note);
    setAsking(null);
  };

  const cutSection = (section: Section) => {
    setCut((prev) => [...prev, { title: section.title, text: section.text }]);
    document.replaceAll(removeSection(document.markdown, section));
  };

  const restore = (index: number) => {
    const entry = cut[index];
    if (!entry) return;
    setCut((prev) => prev.filter((_, i) => i !== index));
    document.replaceAll(`${document.markdown.replace(/\s+$/, "")}\n\n${entry.text.trim()}\n`);
  };

  return (
    <div className="companion-scrim" onMouseDown={close}>
      <div
        className="companion-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`${open.label} — ${open.name}`}
        tabIndex={-1}
        ref={panelRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="companion-head">
          <div className="companion-title">
            <span className="companion-label">{open.label}</span>
            <span className="companion-filename">{open.name}</span>
          </div>
          {statusLine ? (
            <span className="companion-status" aria-live="polite">
              {statusLine}
            </span>
          ) : null}
          {revision.undo ? (
            <button type="button" className="companion-action" onClick={revision.undo}>
              Undo the re-run
            </button>
          ) : null}
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

        <div className="companion-split">
          <nav className="companion-outline" aria-label="Lines of enquiry">
            <ul className="companion-outline-list">
              {sections.map((section) => (
                <li key={`${section.index}-${section.title}`}>
                  <button
                    type="button"
                    className="companion-outline-item"
                    data-active={section.index === active?.index || undefined}
                    onClick={() => setActiveIndex(section.index)}
                  >
                    {section.title}
                  </button>
                </li>
              ))}
              {sections.length === 0 ? (
                <li className="companion-outline-empty">No sections yet.</li>
              ) : null}
            </ul>

            <div className="companion-verbs">
              <button
                type="button"
                className="companion-action"
                disabled={!active || busy}
                onClick={() => active && ask("redo", active)}
                title="Re-run this line of enquiry from scratch"
              >
                Redo
              </button>
              <button
                type="button"
                className="companion-action"
                disabled={!active || busy}
                onClick={() => active && ask("deepen", active)}
                title="Keep it and go further"
              >
                Deepen
              </button>
              <button
                type="button"
                className="companion-action"
                disabled={busy}
                onClick={() => ask("add", null)}
                title="Open a new line of enquiry"
              >
                Add
              </button>
              <button
                type="button"
                className="companion-action companion-action--danger"
                disabled={!active || busy}
                onClick={() => active && cutSection(active)}
                title="Remove it from the document — recoverable below"
              >
                Cut
              </button>
            </div>

            {cut.length > 0 ? (
              <div className="companion-cut">
                <h3 className="companion-cut-title">Cut ({cut.length})</h3>
                {/* Research is evidence. Cutting it must not be the same act as
                    destroying it — the reason an orphaned comment gets a tray
                    rather than vanishing. */}
                <ul className="companion-cut-list">
                  {cut.map((entry, index) => (
                    <li key={`${entry.title}-${index}`} className="companion-cut-item">
                      <span className="companion-cut-name">{entry.title}</span>
                      <button
                        type="button"
                        className="companion-action"
                        onClick={() => restore(index)}
                      >
                        Restore
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </nav>

          <div className="companion-body">
            <div className="companion-sheet">
              {editor ? <EditorContent editor={editor} /> : null}
            </div>
          </div>
        </div>

        {asking ? (
          <div className="companion-ask" role="dialog" aria-label="Ask the agent">
            <p className="companion-ask-what">
              {asking.kind === "add"
                ? "Open a new line of enquiry"
                : asking.kind === "redo"
                  ? `Re-run “${asking.section?.title}” from scratch`
                  : `Take “${asking.section?.title}” further`}
            </p>
            <textarea
              className="companion-ask-input"
              autoFocus
              rows={3}
              value={note}
              placeholder={
                asking.kind === "add"
                  ? "What do you want to know?"
                  : asking.kind === "deepen"
                    ? "What should it answer that it does not?"
                    : "Anything to steer the re-run? (optional)"
              }
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  send();
                }
              }}
            />
            {asking.kind !== "add" ? (
              <div className="companion-ask-mode">
                {/* Replacing is clean; appending keeps what we believed before.
                    Which is right depends on whether the old pass was wrong or
                    merely thin, so it is asked rather than assumed. */}
                <label>
                  <input
                    type="radio"
                    checked={mode === "replace"}
                    onChange={() => setMode("replace")}
                  />
                  Replace this section
                </label>
                <label>
                  <input
                    type="radio"
                    checked={mode === "append"}
                    onChange={() => setMode("append")}
                  />
                  Add as a further pass
                </label>
              </div>
            ) : null}
            <div className="companion-ask-actions">
              <button
                type="button"
                className="companion-action companion-action--primary"
                onClick={send}
                disabled={asking.kind !== "redo" && note.trim() === ""}
              >
                Ask the agent
              </button>
              <button type="button" className="companion-action" onClick={() => setAsking(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
