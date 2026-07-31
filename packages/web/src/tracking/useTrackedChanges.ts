import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";
import type { ChangeAuthor } from "../types";
import {
  buildAcceptTransaction,
  buildRejectTransaction,
  createTrackingPlugin,
  findRange,
  getTrackingState,
  setTrackingEnabled,
  trackedChanges,
  trackingKey,
} from "./plugin";
import { buildRevisionTransaction } from "./revision";
import { createChangePopover } from "./changePopover";
import type { ChangePopover } from "./changePopover";
import "./trackedChanges.css";

export interface UseTrackedChangesOptions {
  editor: Editor | null;
  /** While true, user edits are recorded as tracked insertions/deletions. */
  enabled: boolean;
}

export interface TrackedChange {
  id: string;
  author: ChangeAuthor;
  kind: "insertion" | "deletion";
  text: string;
}

export interface TrackedChangesApi {
  changes: TrackedChange[];
  accept: (id: string) => void;
  reject: (id: string) => void;
  acceptAll: () => void;
  /** Rejecting every AI change must restore the pre-revision document exactly. */
  rejectAll: (author?: ChangeAuthor) => void;
  goToNext: () => void;
  goToPrevious: () => void;
  /** Applies an AI revision as tracked changes rather than replacing the doc. */
  applyRevision: (markdown: string) => void;
}

/**
 * Tracked changes: coloured insertions, struck-through deletions, and the
 * accept/reject verbs over them.
 *
 * The document itself is never marked up. Changes live in a ProseMirror plugin
 * registered here at runtime (`plugin.ts` explains why that beats adding a mark
 * to a schema this lane does not own) and are painted with decorations, so
 * `editor.getJSON()` — and therefore the markdown that `App` autosaves — is
 * exactly the document, with no tracking metadata anywhere in it.
 *
 * `App` calls this hook for its effects and ignores the return value, so the
 * per-change accept/reject affordance is a DOM popover this lane owns, and the
 * rest of the API is reachable from `window.__quillTracking` until M4 wires it
 * into the shell.
 */
export function useTrackedChanges({
  editor,
  enabled,
}: UseTrackedChangesOptions): TrackedChangesApi {
  const [changes, setChanges] = useState<TrackedChange[]>([]);
  const popoverRef = useRef<ChangePopover | null>(null);

  // ── The plugin ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (!trackingKey.getState(editor.state)) {
      // Ahead of everything else: ProseMirror consults `handleKeyDown` plugin
      // by plugin and stops at the first one that claims the event, so a
      // tracking plugin appended after StarterKit's keymaps would watch
      // Backspace really delete the selection before it ever saw it.
      editor.registerPlugin(createTrackingPlugin(), (plugin, plugins) => [
        plugin,
        ...plugins,
      ]);
    }
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(trackingKey);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (!trackingKey.getState(editor.state)) return;
    if (getTrackingState(editor.state).enabled === enabled) return;
    editor.view.dispatch(setTrackingEnabled(editor.state, enabled));
  }, [editor, enabled]);

  // ── Mirror the plugin's changes into React ───────────────────────────────
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const sync = () => {
      const next = trackedChanges(editor.state);
      setChanges((previous) => (sameChanges(previous, next) ? previous : next));
    };
    sync();
    editor.on("transaction", sync);
    return () => {
      editor.off("transaction", sync);
    };
  }, [editor]);

  const dispatch = useCallback(
    (build: (state: EditorState) => Transaction | null) => {
      if (!editor || editor.isDestroyed) return;
      const tr = build(editor.state);
      if (tr) editor.view.dispatch(tr);
    },
    [editor],
  );

  const accept = useCallback(
    (id: string) => dispatch((state) => buildAcceptTransaction(state, [id])),
    [dispatch],
  );

  const reject = useCallback(
    (id: string) => dispatch((state) => buildRejectTransaction(state, [id])),
    [dispatch],
  );

  const acceptAll = useCallback(
    () =>
      dispatch((state) =>
        buildAcceptTransaction(state, idsOf(state, undefined)),
      ),
    [dispatch],
  );

  const rejectAll = useCallback(
    (author?: ChangeAuthor) =>
      dispatch((state) => buildRejectTransaction(state, idsOf(state, author))),
    [dispatch],
  );

  /**
   * Walk to the next/previous change, select it and scroll it into view. The
   * walk is anchored on the caret rather than an index, so it stays correct
   * while changes are being accepted and rejected underneath it.
   */
  const goTo = useCallback(
    (direction: 1 | -1) => {
      if (!editor || editor.isDestroyed) return;
      const { ranges } = getTrackingState(editor.state);
      if (ranges.length === 0) return;

      const { from, to } = editor.state.selection;
      const target =
        direction === 1
          ? (ranges.find((range) => range.from > from) ?? ranges[0])
          : ([...ranges].reverse().find((range) => range.to < to) ??
            ranges[ranges.length - 1]);

      const tr = editor.state.tr;
      tr.setSelection(
        TextSelection.between(tr.doc.resolve(target.from), tr.doc.resolve(target.to)),
      );
      tr.setMeta(trackingKey, { activeId: target.id, skipRecord: true });
      editor.view.dispatch(tr.scrollIntoView());
      editor.view.focus();
      popoverRef.current?.showFor(target.id);
    },
    [editor],
  );

  const goToNext = useCallback(() => goTo(1), [goTo]);
  const goToPrevious = useCallback(() => goTo(-1), [goTo]);

  const applyRevision = useCallback(
    (markdown: string) =>
      dispatch((state) => buildRevisionTransaction(state, markdown, "ai")),
    [dispatch],
  );

  // ── Per-change accept/reject on hover ────────────────────────────────────
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const popover = createChangePopover(editor.view, {
      describe: (id) => {
        const range = findRange(editor.state, id);
        return range ? { author: range.author, kind: range.kind } : null;
      },
      accept: (id) => dispatch((state) => buildAcceptTransaction(state, [id])),
      reject: (id) => dispatch((state) => buildRejectTransaction(state, [id])),
    });
    popoverRef.current = popover;
    return () => {
      popover.destroy();
      popoverRef.current = null;
    };
  }, [editor, dispatch]);

  // Alt+Down / Alt+Up walk the review, the way F5/Shift+F5 do in Word.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        goTo(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        goTo(-1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goTo]);

  const api = useMemo<TrackedChangesApi>(
    () => ({
      changes,
      accept,
      reject,
      acceptAll,
      rejectAll,
      goToNext,
      goToPrevious,
      applyRevision,
    }),
    [
      changes,
      accept,
      reject,
      acceptAll,
      rejectAll,
      goToNext,
      goToPrevious,
      applyRevision,
    ],
  );

  /**
   * `App.tsx` is frozen and drops this hook's return value, so nothing can
   * reach acceptAll/rejectAll/applyRevision from the page. Publishing the API
   * keeps it drivable — by M4's revision flow, and by the tests that prove
   * rejecting a revision restores the document.
   */
  useEffect(() => {
    window.__quillTracking = api;
    return () => {
      if (window.__quillTracking === api) delete window.__quillTracking;
    };
  }, [api]);

  return api;
}

function idsOf(state: EditorState, author: ChangeAuthor | undefined): string[] {
  return getTrackingState(state)
    .ranges.filter((range) => author === undefined || range.author === author)
    .map((range) => range.id);
}

function sameChanges(a: TrackedChange[], b: TrackedChange[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((change, i) => {
    const other = b[i];
    return (
      change.id === other.id &&
      change.kind === other.kind &&
      change.author === other.author &&
      change.text === other.text
    );
  });
}

declare global {
  interface Window {
    /** Tracked-changes API for the page; see the note above. */
    __quillTracking?: TrackedChangesApi;
  }
}
