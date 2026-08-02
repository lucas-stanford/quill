import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import type { Comment, CommentReply, Sidecar, TextAnchor } from "../types";
import { fetchAnnotations, saveAnnotations } from "../api";
import { buildDocText, trimRange } from "./docText";
import { measureSelectionGeometry } from "./selectionGeometry";
import type { SelectionGeometry } from "./selectionGeometry";
import { createAnchor, prepareDocument, resolveAnchorIn } from "./anchor";
import {
  anchorPluginKey,
  createAnchorPlugin,
  currentAnchorRanges,
  setAnchorRanges,
} from "./anchorPlugin";
import type { AnchorPluginHandlers, AnchorRange } from "./anchorPlugin";
import { attachInternal, DRAFT_ID } from "./internal";
import type { AnnotationsInternal, DraftAnchor, SidecarSync } from "./internal";
import { orderComments, mergeRemoteComments, selectForBrief, selectOrphans } from "./select";

/**
 * annotations/useAnnotations.ts
 *
 * FROZEN SIGNATURE — see CONTRACT.md. The shape below is App.tsx's wiring
 * point; the implementation is this lane's.
 *
 * The hook owns three things:
 *
 *   1. Anchors. A comment stores a quote and its surrounding context, never an
 *      offset, and is re-matched against the document on a debounce. When the
 *      match fails the comment is orphaned — it is never attached to text that
 *      only nearly matches, because a mis-attached comment is worse than a
 *      lost one (CONTRACT.md invariant 3).
 *   2. The sidecar. Comments live in PLAN.quill.json, read with
 *      fetchAnnotations() and written back debounced and conflict-safe. A
 *      missing sidecar is not an error — Quill stays a plain markdown editor.
 *   3. Highlighting. Anchored text is decorated by a ProseMirror plugin, a
 *      view-layer concern, so the document is untouched and the markdown
 *      round-trip stays byte-identical (invariant 2).
 */

export interface UseAnnotationsOptions {
  editor: Editor | null;
  /** Only load once the plan is ready. */
  enabled: boolean;
}

export interface AnnotationsApi {
  comments: Comment[];
  /** Comments whose anchor could not be re-matched against the document. */
  orphans: Comment[];
  /** Anchor the current selection and start a new comment thread. */
  addComment: (body: string) => void;
  addReply: (commentId: string, body: string) => void;
  resolve: (commentId: string, resolved: boolean) => void;
  /**
   * Resolve several threads at once — what the AI round trip uses to close the
   * notes it was just asked to act on, in one state update and one save.
   */
  resolveMany: (commentIds: readonly string[], resolved: boolean) => void;
  remove: (commentId: string) => void;
  /** Currently focused thread, for two-way highlight with the text. */
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  /** Unresolved comments, in document order — the M4 revision brief uses this. */
  forBrief: () => Comment[];
  /** Standing feedback about the plan as a whole. Persisted in the sidecar. */
  feedback: string;
  setFeedback: (feedback: string) => void;
  sidecar: Sidecar;
}

/**
 * Re-anchoring runs off the keystroke path. 250 ms is short enough that a
 * highlight never feels detached from its text, long enough that a burst of
 * typing costs one pass instead of thirty. Between passes the decorations are
 * mapped through every transaction, so highlights track edits with no latency
 * regardless.
 */
const REANCHOR_DEBOUNCE_MS = 250;

/** Matches App's autosave feel without writing on every keystroke of a reply. */
const SIDECAR_SAVE_DEBOUNCE_MS = 600;

/** Thread author until the CLI supplies a real identity (M4/M5). */
const DEFAULT_AUTHOR = "You";

interface ResolvedAnchor {
  from: number;
  to: number;
  approximate: boolean;
}

type Resolutions = Record<string, ResolvedAnchor>;

function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isComment(value: unknown): value is Comment {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<Comment>;
  return (
    typeof c.id === "string" &&
    typeof c.body === "string" &&
    !!c.anchor &&
    typeof c.anchor === "object" &&
    typeof (c.anchor as TextAnchor).quote === "string"
  );
}

/** The sidecar is a file on disk a human can edit — never trust its shape. */
function readFeedback(sidecar: Sidecar | undefined | null): string {
  return typeof sidecar?.feedback === "string" ? sidecar.feedback : "";
}

/**
 * The sidecar exactly as it should land on disk. `feedback` is omitted when
 * empty so a plan reviewed before the panel existed is not rewritten by merely
 * being opened — the save effect compares this JSON against what was read.
 */
function buildSidecar(comments: readonly Comment[], feedback: string): Sidecar {
  const sidecar: Sidecar = { version: 1, comments: [...comments] };
  if (feedback.trim() !== "") sidecar.feedback = feedback;
  return sidecar;
}

/** The sidecar is a file on disk a human can edit — never trust its shape. */
function sanitizeSidecar(sidecar: Sidecar | undefined | null): Comment[] {
  const comments = Array.isArray(sidecar?.comments) ? sidecar.comments : [];
  return comments.filter(isComment).map((c) => ({
    ...c,
    anchor: {
      quote: c.anchor.quote,
      prefix: typeof c.anchor.prefix === "string" ? c.anchor.prefix : "",
      suffix: typeof c.anchor.suffix === "string" ? c.anchor.suffix : "",
    },
    author: typeof c.author === "string" ? c.author : DEFAULT_AUTHOR,
    createdAt: typeof c.createdAt === "string" ? c.createdAt : new Date().toISOString(),
    resolved: c.resolved === true,
    replies: Array.isArray(c.replies) ? c.replies : [],
  }));
}

function sameResolutions(a: Resolutions, b: Resolutions): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    const x = a[key]!;
    const y = b[key];
    if (!y || x.from !== y.from || x.to !== y.to || x.approximate !== y.approximate) return false;
  }
  return true;
}

interface CapturedSelection {
  anchor: TextAnchor;
  from: number;
  to: number;
  quote: string;
}

/** Turns the live ProseMirror selection into a text-quote anchor. */
function captureSelection(view: EditorView): CapturedSelection | null {
  const { from, to } = view.state.selection;
  if (to <= from) return null;

  const doc = buildDocText(view.state.doc);
  const [start, end] = trimRange(
    doc.text,
    doc.offsetAt(from, "start"),
    doc.offsetAt(to, "end"),
  );
  if (end <= start) return null;

  return {
    anchor: createAnchor(doc.text, start, end),
    from: doc.posAt(start, "start"),
    to: doc.posAt(end, "end"),
    quote: doc.text.slice(start, end),
  };
}

/** Nearest scrollable ancestor — the page canvas, in practice. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export function useAnnotations({ editor, enabled }: UseAnnotationsOptions): AnnotationsApi {
  const [comments, setComments] = useState<Comment[]>([]);
  const [feedback, setFeedbackState] = useState("");
  const [resolutions, setResolutions] = useState<Resolutions>({});
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftAnchor | null>(null);
  const [selectionQuote, setSelectionQuote] = useState("");
  const [selectionKey, setSelectionKey] = useState("");
  const [editorFocused, setEditorFocused] = useState(false);
  const [geometry, setGeometry] = useState(0);
  const [sync, setSync] = useState<SidecarSync>("idle");
  const [syncDetail, setSyncDetail] = useState<string | null>(null);

  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const revisionRef = useRef("");
  const loadedRef = useRef(false);
  const loadAttemptedRef = useRef(false);
  const deletedRef = useRef<Set<string>>(new Set());
  const savedJsonRef = useRef<string | null>(null);
  const reanchorTimer = useRef<number | null>(null);
  const geometryFrame = useRef<number | null>(null);

  /* ── Geometry ──────────────────────────────────────────────────────────
     At most one bump per frame: a burst of transactions must not become a
     burst of React renders. */

  const bumpGeometry = useCallback(() => {
    if (geometryFrame.current !== null) return;
    geometryFrame.current = window.requestAnimationFrame(() => {
      geometryFrame.current = null;
      setGeometry((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (geometryFrame.current !== null) window.cancelAnimationFrame(geometryFrame.current);
      if (reanchorTimer.current !== null) window.clearTimeout(reanchorTimer.current);
    };
  }, []);

  /* ── Re-anchoring ──────────────────────────────────────────────────── */

  const runReanchor = useCallback(() => {
    const view = editor?.view;
    if (!view || editor?.isDestroyed) return;

    const doc = buildDocText(view.state.doc);
    const prepared = prepareDocument(doc.text);
    const next: Resolutions = {};

    for (const comment of commentsRef.current) {
      const match = resolveAnchorIn(prepared, comment.anchor);
      if (!match) continue;
      next[comment.id] = {
        from: doc.posAt(match.start, "start"),
        to: doc.posAt(match.end, "end"),
        approximate: match.strategy === "fuzzy",
      };
    }

    setResolutions((prev) => (sameResolutions(prev, next) ? prev : next));
    setComments((prev) => {
      let changed = false;
      const updated = prev.map((c) => {
        const orphaned = !next[c.id];
        if (c.orphaned === orphaned) return c;
        changed = true;
        return { ...c, orphaned };
      });
      return changed ? updated : prev;
    });
  }, [editor]);

  const scheduleReanchor = useCallback(() => {
    if (reanchorTimer.current !== null) window.clearTimeout(reanchorTimer.current);
    reanchorTimer.current = window.setTimeout(() => {
      reanchorTimer.current = null;
      runReanchor();
    }, REANCHOR_DEBOUNCE_MS);
  }, [runReanchor]);

  // Re-match when the comment set changes (load, add, delete, re-attach).
  useEffect(() => {
    if (!editor) return;
    runReanchor();
  }, [editor, comments.length, runReanchor]);

  /* ── Editor plumbing ───────────────────────────────────────────────── */

  const handlersRef = useRef<AnchorPluginHandlers>({
    onAnchorClick: () => {},
    onCommentShortcut: () => false,
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.registerPlugin(createAnchorPlugin(() => handlersRef.current));
    runReanchor();
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(anchorPluginKey);
    };
  }, [editor, runReanchor]);

  useEffect(() => {
    if (!editor) return;

    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) scheduleReanchor();
      bumpGeometry();
    };
    const onSelection = () => {
      const { state } = editor.view;
      const { from, to } = state.selection;
      const text = to > from ? state.doc.textBetween(from, to, " ", " ").trim() : "";
      setSelectionQuote((prev) => (prev === text ? prev : text));
      const key = text ? `${from}:${to}` : "";
      setSelectionKey((prev) => (prev === key ? prev : key));
    };
    const onFocus = () => setEditorFocused(true);
    const onBlur = () => setEditorFocused(false);

    editor.on("transaction", onTransaction);
    editor.on("selectionUpdate", onSelection);
    editor.on("focus", onFocus);
    editor.on("blur", onBlur);
    return () => {
      editor.off("transaction", onTransaction);
      editor.off("selectionUpdate", onSelection);
      editor.off("focus", onFocus);
      editor.off("blur", onBlur);
    };
  }, [editor, scheduleReanchor, bumpGeometry]);

  // Anchor geometry also moves when the window or the page does.
  useEffect(() => {
    if (!editor) return;
    const onResize = () => bumpGeometry();
    window.addEventListener("resize", onResize);

    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => bumpGeometry());
    observer?.observe(editor.view.dom as HTMLElement);

    return () => {
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  }, [editor, bumpGeometry]);

  // Publish resolved ranges to the decoration plugin.
  useEffect(() => {
    const view = editor?.view;
    if (!view || editor?.isDestroyed) return;

    const ranges: AnchorRange[] = [];
    for (const comment of comments) {
      const at = resolutions[comment.id];
      if (!at) continue;
      ranges.push({
        id: comment.id,
        from: at.from,
        to: at.to,
        resolved: comment.resolved,
        approximate: at.approximate,
      });
    }
    view.dispatch(setAnchorRanges(view.state.tr, ranges, activeId));
    bumpGeometry();
  }, [editor, comments, resolutions, activeId, bumpGeometry]);

  /* ── Sidecar ───────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!enabled || loadedRef.current) return;
    let cancelled = false;

    setSync("loading");
    fetchAnnotations()
      .then((response) => {
        if (cancelled) return;
        const loaded = sanitizeSidecar(response.sidecar);
        const loadedFeedback = readFeedback(response.sidecar);
        revisionRef.current = response.revision;
        savedJsonRef.current = JSON.stringify(buildSidecar(loaded, loadedFeedback));
        loadedRef.current = true;
        loadAttemptedRef.current = true;
        setComments(loaded);
        setFeedbackState(loadedFeedback);
        setSync("idle");
        setSyncDetail(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // A sidecar that cannot be read must never take the editor down — the
        // endpoint may simply not be up yet. Commenting keeps working locally
        // and the next write retries the load.
        loadAttemptedRef.current = true;
        setSync("unavailable");
        setSyncDetail(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  /**
   * Fold anything on disk this session has not seen into local state. Returns
   * true when it did, in which case the write is abandoned: the save effect
   * runs again with the union instead of clobbering the file.
   */
  const adoptRemote = useCallback(
    (remote: Sidecar, local: readonly Comment[], localFeedback: string): boolean => {
      const onDisk = sanitizeSidecar(remote);
      const diskFeedback = readFeedback(remote);
      const merged = mergeRemoteComments(onDisk, local, deletedRef.current);
      /*
       * Standing feedback is a single field, so it cannot be merged the way a
       * list of threads can. What is on screen wins — this is a one-reviewer
       * product — except when there is nothing on screen to lose, which is how
       * feedback written before this session is picked up rather than erased.
       */
      const takeFeedback = localFeedback.trim() === "" && diskFeedback.trim() !== "";
      if (!merged && !takeFeedback) return false;

      savedJsonRef.current = JSON.stringify(buildSidecar(onDisk, diskFeedback));
      if (merged) setComments(merged);
      if (takeFeedback) setFeedbackState(diskFeedback);
      setSync("idle");
      setSyncDetail(null);
      return true;
    },
    [],
  );

  const persist = useCallback(async (next: Sidecar, json: string) => {
    setSync("saving");
    try {
      if (!loadedRef.current) {
        // The load failed earlier. Try again, so a server that came up late is
        // picked up without a page reload.
        const current = await fetchAnnotations();
        revisionRef.current = current.revision;
        loadedRef.current = true;
        if (adoptRemote(current.sidecar, next.comments, next.feedback ?? "")) return;
      }
      const saved = await saveAnnotations(next, revisionRef.current);
      revisionRef.current = saved.revision;
      savedJsonRef.current = json;
      setSync("saved");
      setSyncDetail(null);
    } catch (error: unknown) {
      // Most likely a stale revision. Re-read, adopt anything on disk this
      // session has never seen, then try once more: this is a single-reviewer
      // product, so what is on screen wins for threads both sides know.
      try {
        const current = await fetchAnnotations();
        revisionRef.current = current.revision;
        loadedRef.current = true;
        if (adoptRemote(current.sidecar, next.comments, next.feedback ?? "")) return;
        const saved = await saveAnnotations(next, revisionRef.current);
        revisionRef.current = saved.revision;
        savedJsonRef.current = json;
        setSync("saved");
        setSyncDetail(null);
      } catch (retryError: unknown) {
        setSync(loadedRef.current ? "error" : "unavailable");
        const reported = retryError instanceof Error ? retryError : error;
        setSyncDetail(reported instanceof Error ? reported.message : String(reported));
      }
    }
  }, [adoptRemote]);

  const sidecar = useMemo<Sidecar>(
    () => buildSidecar(comments, feedback),
    [comments, feedback],
  );

  useEffect(() => {
    if (!enabled) return;
    const json = JSON.stringify(sidecar);
    // Never write before the first read has been attempted — opening the plan
    // must not rewrite the sidecar — and never write a no-op. A read that
    // *failed* does not block writing: the write retries the read first, so a
    // server that comes up late is picked up without a reload.
    if (savedJsonRef.current === null && !loadAttemptedRef.current) return;
    if (json === savedJsonRef.current) return;

    const timer = window.setTimeout(() => void persist(sidecar, json), SIDECAR_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [sidecar, enabled, persist]);

  /* ── Mutations ─────────────────────────────────────────────────────── */

  const setActiveId = useCallback((id: string | null) => setActiveIdState(id), []);

  const addComment = useCallback(
    (body: string) => {
      const view = editor?.view;
      const text = body.trim();
      if (!view || !text) return;

      const pending = draftRef.current;
      const captured: CapturedSelection | null = pending
        ? { anchor: pending.anchor, from: pending.from, to: pending.to, quote: pending.quote }
        : captureSelection(view);
      if (!captured) return;

      const comment: Comment = {
        id: newId(),
        anchor: captured.anchor,
        author: DEFAULT_AUTHOR,
        body: text,
        createdAt: new Date().toISOString(),
        resolved: false,
        replies: [],
        orphaned: false,
      };

      setComments((prev) => [...prev, comment]);
      setResolutions((prev) => ({
        ...prev,
        [comment.id]: { from: captured.from, to: captured.to, approximate: false },
      }));
      setDraft(null);
      setActiveIdState(comment.id);
    },
    [editor],
  );

  const addReply = useCallback((commentId: string, body: string) => {
    const text = body.trim();
    if (!text) return;
    const reply: CommentReply = {
      id: newId(),
      author: DEFAULT_AUTHOR,
      body: text,
      createdAt: new Date().toISOString(),
    };
    setComments((prev) =>
      prev.map((c) => (c.id === commentId ? { ...c, replies: [...c.replies, reply] } : c)),
    );
  }, []);

  const resolve = useCallback((commentId: string, resolved: boolean) => {
    setComments((prev) => prev.map((c) => (c.id === commentId ? { ...c, resolved } : c)));
  }, []);

  const resolveMany = useCallback((commentIds: readonly string[], resolved: boolean) => {
    if (commentIds.length === 0) return;
    const wanted = new Set(commentIds);
    setComments((prev) => {
      let changed = false;
      const next = prev.map((c) => {
        if (!wanted.has(c.id) || c.resolved === resolved) return c;
        changed = true;
        return { ...c, resolved };
      });
      // Same array when nothing moved, so a no-op cannot dirty the sidecar and
      // trigger a save of bytes that already match the file.
      return changed ? next : prev;
    });
  }, []);

  const setFeedback = useCallback((next: string) => {
    setFeedbackState(next);
  }, []);

  const remove = useCallback((commentId: string) => {
    deletedRef.current.add(commentId);
    setComments((prev) => prev.filter((c) => c.id !== commentId));
    setResolutions((prev) => {
      if (!(commentId in prev)) return prev;
      const next = { ...prev };
      delete next[commentId];
      return next;
    });
    setActiveIdState((prev) => (prev === commentId ? null : prev));
  }, []);

  /* ── Lane-private extras, handed to the rail ───────────────────────── */

  const beginDraft = useCallback((): boolean => {
    const view = editor?.view;
    if (!view) return false;
    const captured = captureSelection(view);
    if (!captured) return false;
    setDraft({
      quote: captured.quote,
      from: captured.from,
      to: captured.to,
      anchor: captured.anchor,
    });
    setActiveIdState(null);
    return true;
  }, [editor]);

  const cancelDraft = useCallback(() => setDraft(null), []);

  const reattach = useCallback(
    (commentId: string): boolean => {
      const view = editor?.view;
      if (!view) return false;
      const captured = captureSelection(view);
      if (!captured) return false;

      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId ? { ...c, anchor: captured.anchor, orphaned: false } : c,
        ),
      );
      setResolutions((prev) => ({
        ...prev,
        [commentId]: { from: captured.from, to: captured.to, approximate: false },
      }));
      setActiveIdState(commentId);
      return true;
    },
    [editor],
  );

  const revealAnchor = useCallback(
    (commentId: string) => {
      const view = editor?.view;
      const at = resolutions[commentId];
      if (!view || !at) return;

      let coords: { top: number; bottom: number };
      try {
        coords = view.coordsAtPos(at.from);
      } catch {
        return;
      }
      const scroller = scrollParent(view.dom as HTMLElement);
      if (!scroller) return;

      const box = scroller.getBoundingClientRect();
      const margin = 96;
      if (coords.top < box.top + margin) {
        scroller.scrollBy({ top: coords.top - box.top - margin, behavior: "smooth" });
      } else if (coords.bottom > box.bottom - margin) {
        scroller.scrollBy({ top: coords.bottom - box.bottom + margin, behavior: "smooth" });
      }
    },
    [editor, resolutions],
  );

  const measureSelection = useCallback((): SelectionGeometry | null => {
    const view = editor?.view;
    if (!view || editor?.isDestroyed) return null;
    return measureSelectionGeometry(view);
  }, [editor]);

  const focusDocument = useCallback(() => {
    const view = editor?.view;
    if (!view || editor?.isDestroyed) return;
    view.focus();
  }, [editor]);

  const measure = useCallback(
    (layer: HTMLElement): Map<string, number> => {
      const tops = new Map<string, number>();
      const view = editor?.view;
      if (!view || editor?.isDestroyed) return tops;

      const origin = layer.getBoundingClientRect().top;
      const topFor = (pos: number): number | null => {
        try {
          return view.coordsAtPos(pos).top - origin;
        } catch {
          return null;
        }
      };

      // Read ranges back out of the plugin: they are mapped through every
      // transaction, so bubbles track edits between re-anchor passes.
      for (const range of currentAnchorRanges(view.state)) {
        const top = topFor(range.from);
        if (top !== null) tops.set(range.id, top);
      }
      const pending = draftRef.current;
      if (pending) {
        const top = topFor(pending.from);
        if (top !== null) tops.set(DRAFT_ID, top);
      }
      return tops;
    },
    [editor],
  );

  handlersRef.current = {
    onAnchorClick: (id) => setActiveIdState(id),
    onCommentShortcut: () => beginDraft(),
  };

  /* ── Public shape ──────────────────────────────────────────────────── */

  const ordered = useMemo(
    () => orderComments(comments, (c) => resolutions[c.id]?.from),
    [comments, resolutions],
  );

  const orphans = useMemo(() => selectOrphans(ordered), [ordered]);

  const approximate = useMemo(() => {
    const ids = new Set<string>();
    for (const [id, at] of Object.entries(resolutions)) if (at.approximate) ids.add(id);
    return ids;
  }, [resolutions]);

  /**
   * Resolved threads are settled business and must not reach the AI; orphans
   * do reach it, because the reviewer's instruction still stands even when the
   * text it pointed at has moved.
   */
  const forBrief = useCallback(() => selectForBrief(ordered), [ordered]);

  const api: AnnotationsApi = {
    comments: ordered,
    orphans,
    addComment,
    addReply,
    resolve,
    resolveMany,
    remove,
    activeId,
    setActiveId,
    forBrief,
    feedback,
    setFeedback,
    sidecar,
  };

  const internal: AnnotationsInternal = {
    geometry,
    measure,
    selectionQuote,
    selectionKey,
    editorFocused,
    measureSelection,
    focusDocument,
    draft,
    beginDraft,
    cancelDraft,
    reattach,
    revealAnchor,
    approximate,
    sync,
    syncDetail,
    author: DEFAULT_AUTHOR,
  };

  return attachInternal(api, internal);
}
