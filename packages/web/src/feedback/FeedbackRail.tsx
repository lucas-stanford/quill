/**
 * feedback/FeedbackRail.tsx
 *
 * Feedback on the plan as a whole — the notes that are not about any one
 * sentence, in the left margin opposite the anchored comments.
 *
 * Three decisions.
 *
 * **It is a list, not a box.** "This is three milestones, not one" and "you
 * never say how it deploys" are two objections. Handed to an agent as one
 * paragraph, the second gets answered by accident or not at all; as two
 * numbered notes it has to address both. Enter commits a note, so the rhythm is
 * type-Enter-type-Enter rather than composing an essay.
 *
 * **A sent note is closed, not deleted.** When a revision lands, the notes that
 * went out are resolved — the composer is empty and the list is visibly settled,
 * so it is obvious what has been asked for and what has not. They stay visible,
 * struck through, because "did I already ask for that?" is a real question, and
 * one click reopens a note if the answer was unsatisfying.
 *
 * **It is on the left.** The right rail positions its bubbles against live text
 * coordinates measured from the top of the bubble layer, so anything else in
 * that column moves every anchor. Nothing over here is measured against
 * anything.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent } from "react";
import type { AnnotationsApi } from "../annotations";
import type { FeedbackEntry } from "../types";
import "./feedback.css";
/**
 * The width at which BOTH rails fit beside a full-width page:
 * 300 + 24 + 816 + 24 + 300 + 2x24 gutter. Below it the page would have to
 * shrink or be covered, and the page is the product — so the rail collapses to
 * a handle instead, and covers nothing until asked.
 */
const DOCKED_QUERY = "(min-width: 1512px)";

function useDocked(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia(DOCKED_QUERY);
      media.addEventListener("change", notify);
      // Belt and braces: a `change` event is the right signal and fires on a
      // real resize, but a window that is resized without one — a devtools
      // metrics override, an OS zoom change — would otherwise leave the rail
      // docked with nowhere to dock.
      window.addEventListener("resize", notify);
      return () => {
        media.removeEventListener("change", notify);
        window.removeEventListener("resize", notify);
      };
    },
    () => window.matchMedia(DOCKED_QUERY).matches,
    () => true,
  );
}

export function FeedbackRail({ annotations }: { annotations: AnnotationsApi }) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const docked = useDocked();

  const notes = annotations.feedback;
  const openCount = notes.filter((entry) => !entry.resolved).length;
  const expanded = docked || open;

  const commit = () => {
    const text = draft.trim();
    if (text === "") return;
    annotations.addFeedback(text);
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    /*
     * Enter commits; Shift+Enter is a newline. A note is usually one sentence,
     * so the common case gets the bare key and the rarer multi-line note pays
     * the modifier — the bargain a chat composer makes.
     */
    event.preventDefault();
    commit();
  };

  if (!expanded) {
    return (
      <aside className="feedback-rail feedback-rail--collapsed" aria-label="Feedback on the plan">
        <button
          type="button"
          className="feedback-handle"
          onClick={() => setOpen(true)}
          aria-expanded={false}
        >
          Feedback
          {openCount > 0 ? <span className="feedback-count">{openCount}</span> : null}
        </button>
      </aside>
    );
  }

  return (
    <aside className="feedback-rail" aria-label="Feedback on the plan">
      <div className="feedback-inner">
        <div className="feedback-head">
          <h2 className="feedback-title">Feedback on the plan</h2>
          {openCount > 0 ? (
            <span className="feedback-count" aria-label={`${openCount} open`}>
              {openCount}
            </span>
          ) : null}
          {docked ? null : (
            <button
              type="button"
              className="feedback-action"
              onClick={() => setOpen(false)}
              aria-expanded
            >
              Hide
            </button>
          )}
        </div>

        {notes.length > 0 ? (
          <ul className="feedback-list">
            {notes.map((entry) => (
              <FeedbackNote
                key={entry.id}
                entry={entry}
                editing={editingId === entry.id}
                onEdit={() => setEditingId(entry.id)}
                onEditDone={(body) => {
                  annotations.editFeedback(entry.id, body);
                  setEditingId(null);
                }}
                onEditCancel={() => setEditingId(null)}
                onResolve={() => annotations.resolveFeedback(entry.id, !entry.resolved)}
                onDelete={() => annotations.removeFeedback(entry.id)}
              />
            ))}
          </ul>
        ) : null}

        <textarea
          className="feedback-input"
          value={draft}
          placeholder={
            notes.length === 0
              ? "Anything about the plan as a whole — its shape, what is missing, what it is for."
              : "Add another note."
          }
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          // Leaving the field is not a reason to lose what was typed in it.
          onBlur={commit}
          rows={3}
          spellCheck
          aria-label="Add feedback about the plan"
        />
        <p className="feedback-hint">
          <kbd>Enter</kbd> adds · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
        </p>
      </div>
    </aside>
  );
}

interface FeedbackNoteProps {
  entry: FeedbackEntry;
  editing: boolean;
  onEdit: () => void;
  onEditDone: (body: string) => void;
  onEditCancel: () => void;
  onResolve: () => void;
  onDelete: () => void;
}

function FeedbackNote({
  entry,
  editing,
  onEdit,
  onEditDone,
  onEditCancel,
  onResolve,
  onDelete,
}: FeedbackNoteProps) {
  const [text, setText] = useState(entry.body);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    setText(entry.body);
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [editing, entry.body]);

  if (editing) {
    return (
      <li className="feedback-note feedback-note--editing">
        <textarea
          ref={inputRef}
          className="feedback-note-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onEditDone(text);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onEditCancel();
            }
          }}
          rows={3}
          aria-label="Edit this note"
        />
        <div className="feedback-note-actions">
          <button type="button" className="feedback-action" onClick={() => onEditDone(text)}>
            Save
          </button>
          <button type="button" className="feedback-action" onClick={onEditCancel}>
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className={entry.resolved ? "feedback-note feedback-note--resolved" : "feedback-note"}>
      <p className="feedback-note-body">{entry.body}</p>
      <div className="feedback-note-actions">
        {/* A sent note is settled business; rewording it would tell nobody
            anything, so reopening is the action offered instead. */}
        {entry.resolved ? null : (
          <button type="button" className="feedback-action" onClick={onEdit}>
            Edit
          </button>
        )}
        <button
          type="button"
          className="feedback-action"
          onClick={onResolve}
          aria-pressed={entry.resolved}
        >
          {entry.resolved ? "Reopen" : "Resolve"}
        </button>
        <button
          type="button"
          className="feedback-action feedback-action--danger"
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </li>
  );
}
