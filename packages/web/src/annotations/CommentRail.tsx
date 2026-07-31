import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Comment } from "../types";
import type { AnnotationsApi } from "./useAnnotations";
import { readInternal, DRAFT_ID } from "./internal";
import type { AnnotationsInternal } from "./internal";
import { layoutBubbles, layoutHeight } from "./layout";
import type { BubbleBox } from "./layout";
import "./annotations.css";

/**
 * annotations/CommentRail.tsx
 *
 * FROZEN PROP CONTRACT — rendered into AppShell's right rail.
 *
 * Word-style margin bubbles: every card wants to sit level with its anchored
 * text and is joined to it by a thin leader line. Cards never overlap — see
 * layout.ts for the push-down rule — and the whole rail is positioned against
 * the anchors' live screen coordinates, so it stays correct while the document
 * is edited underneath it.
 *
 * Orphaned threads drop out of the anchored layout into a tray pinned to the
 * bottom of the rail, keeping their original quote so they can be re-attached
 * or dismissed. Nothing is ever silently lost.
 */

export interface CommentRailProps {
  annotations: AnnotationsApi;
}

/** Left gutter of the rail, where the leader lines live. */
const LEADER_GUTTER = 28;
/** Vertical offset from a card's top to where its leader line attaches. */
const LEADER_INSET = 14;
/** Used until a bubble has been measured, so the first paint is close. */
const ESTIMATED_BUBBLE_HEIGHT = 96;

interface PlacedBubble {
  id: string;
  top: number;
  anchorTop: number;
  height: number;
}

function sameNumberMap(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    const other = b.get(key);
    if (other === undefined || Math.abs(other - value) > 0.5) return false;
  }
  return true;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function initials(author: string): string {
  const parts = author.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export function CommentRail({ annotations }: CommentRailProps) {
  const internal = readInternal(annotations);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const bubbleRefs = useRef(new Map<string, HTMLElement>());
  const resizeObserver = useRef<ResizeObserver | null>(null);

  const [anchorTops, setAnchorTops] = useState<Map<string, number>>(() => new Map());
  const [heights, setHeights] = useState<Map<string, number>>(() => new Map());
  const [replyingTo, setReplyingTo] = useState<string | null>(null);

  const { comments, orphans, activeId } = annotations;
  const geometry = internal?.geometry ?? 0;
  const draft = internal?.draft ?? null;

  const anchored = useMemo(
    () => comments.filter((c) => c.orphaned !== true),
    [comments],
  );

  /* ── Measurement ───────────────────────────────────────────────────────
     Anchor tops come from the editor's live coordinates; bubble heights come
     from the DOM. Both are re-read after every layout-affecting change and
     only committed when they actually moved, so this cannot loop. */

  const measureAnchors = useCallback(() => {
    const layer = layerRef.current;
    if (!layer || !internal) return;
    const next = internal.measure(layer);
    setAnchorTops((prev) => (sameNumberMap(prev, next) ? prev : next));
  }, [internal]);

  const measureHeights = useCallback(() => {
    const next = new Map<string, number>();
    for (const [id, el] of bubbleRefs.current) next.set(id, el.offsetHeight);
    setHeights((prev) => (sameNumberMap(prev, next) ? prev : next));
  }, []);

  useLayoutEffect(() => {
    measureAnchors();
  }, [measureAnchors, geometry, comments, draft, orphans.length]);

  useLayoutEffect(() => {
    measureHeights();
  });

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measureHeights());
    resizeObserver.current = observer;
    for (const el of bubbleRefs.current.values()) observer.observe(el);
    return () => {
      observer.disconnect();
      resizeObserver.current = null;
    };
  }, [measureHeights]);

  const registerBubble = useCallback((id: string) => {
    return (el: HTMLElement | null) => {
      const map = bubbleRefs.current;
      const previous = map.get(id);
      if (previous && previous !== el) resizeObserver.current?.unobserve(previous);
      if (el) {
        map.set(id, el);
        resizeObserver.current?.observe(el);
      } else {
        map.delete(id);
      }
    };
  }, []);

  /* ── Layout ────────────────────────────────────────────────────────── */

  const placements = useMemo<PlacedBubble[]>(() => {
    const boxes: BubbleBox[] = [];
    const order = new Map<string, number>();

    anchored.forEach((comment, index) => {
      order.set(comment.id, index);
      boxes.push({
        id: comment.id,
        anchorTop: Math.max(0, anchorTops.get(comment.id) ?? 0),
        height: heights.get(comment.id) ?? ESTIMATED_BUBBLE_HEIGHT,
      });
    });

    if (draft) {
      order.set(DRAFT_ID, anchored.length);
      boxes.push({
        id: DRAFT_ID,
        anchorTop: Math.max(0, anchorTops.get(DRAFT_ID) ?? 0),
        height: heights.get(DRAFT_ID) ?? ESTIMATED_BUBBLE_HEIGHT,
      });
    }

    // Document order, with the draft slotted in at its own anchor.
    boxes.sort(
      (a, b) => a.anchorTop - b.anchorTop || order.get(a.id)! - order.get(b.id)!,
    );

    return layoutBubbles(boxes, draft ? DRAFT_ID : activeId);
  }, [anchored, anchorTops, heights, draft, activeId]);

  const placementById = useMemo(() => {
    const map = new Map<string, PlacedBubble>();
    for (const placement of placements) map.set(placement.id, placement);
    return map;
  }, [placements]);

  const layerHeight = useMemo(() => layoutHeight(placements), [placements]);

  /* ── Interaction ───────────────────────────────────────────────────── */

  const focusThread = useCallback(
    (id: string) => {
      if (activeId === id) return;
      annotations.setActiveId(id);
      internal?.revealAnchor(id);
    },
    [activeId, annotations, internal],
  );

  const startDraft = useCallback(() => {
    if (!internal?.beginDraft()) return;
    setReplyingTo(null);
  }, [internal]);

  const hasSelection = (internal?.selectionQuote ?? "").length > 0;

  return (
    <aside className="comment-rail" aria-label="Comments">
      <div
        className="comment-rail-layer"
        ref={layerRef}
        style={{ height: `${layerHeight}px` }}
      >
        <svg className="comment-rail-leaders" aria-hidden="true">
          {placements.map((placement) => (
            <Leader
              key={placement.id}
              placement={placement}
              active={placement.id === activeId || placement.id === DRAFT_ID}
            />
          ))}
        </svg>

        {anchored.map((comment) => {
          const placement = placementById.get(comment.id);
          return (
            <CommentBubble
              key={comment.id}
              ref={registerBubble(comment.id)}
              comment={comment}
              top={placement?.top ?? 0}
              active={activeId === comment.id}
              approximate={internal?.approximate.has(comment.id) === true}
              replying={replyingTo === comment.id}
              onFocusThread={() => focusThread(comment.id)}
              onReplyOpen={() => {
                focusThread(comment.id);
                setReplyingTo(comment.id);
              }}
              onReplyCancel={() => setReplyingTo(null)}
              onReply={(body) => {
                annotations.addReply(comment.id, body);
                setReplyingTo(null);
              }}
              onResolve={() => annotations.resolve(comment.id, !comment.resolved)}
              onDelete={() => annotations.remove(comment.id)}
            />
          );
        })}

        {draft ? (
          <DraftBubble
            ref={registerBubble(DRAFT_ID)}
            quote={draft.quote}
            top={placementById.get(DRAFT_ID)?.top ?? 0}
            author={internal?.author ?? "You"}
            onCancel={() => internal?.cancelDraft()}
            onSubmit={(body) => annotations.addComment(body)}
          />
        ) : null}

        {anchored.length === 0 && !draft ? (
          <p className="comment-rail-empty">
            Select text in the plan, then <strong>Comment</strong> to leave a margin note.
          </p>
        ) : null}
      </div>

      {orphans.length > 0 ? (
        <OrphanTray
          orphans={orphans}
          canReattach={hasSelection}
          onReattach={(id) => internal?.reattach(id)}
          onDismiss={(id) => annotations.remove(id)}
        />
      ) : null}

      <div className="comment-rail-footer">
        <button
          type="button"
          className="comment-action comment-action--primary"
          onClick={startDraft}
          disabled={!hasSelection}
          title={
            hasSelection
              ? "Comment on the selected text (⌘⌥M)"
              : "Select text in the plan first"
          }
        >
          <CommentGlyph />
          Comment
        </button>
        <SyncBadge internal={internal} count={comments.length} />
      </div>
    </aside>
  );
}

/* ── Leader line ──────────────────────────────────────────────────────────
   Anchor edge → elbow → card edge. Drawn in the rail's left gutter so it
   reads as a thread running from the text out to the margin. */

function Leader({ placement, active }: { placement: PlacedBubble; active: boolean }) {
  const anchorY = placement.anchorTop + 2;
  const cardY = placement.top + LEADER_INSET;
  const points = [
    [0, anchorY],
    [LEADER_GUTTER * 0.45, anchorY],
    [LEADER_GUTTER * 0.75, cardY],
    [LEADER_GUTTER, cardY],
  ]
    .map(([x, y]) => `${x},${y}`)
    .join(" ");

  return (
    <g className={active ? "comment-leader comment-leader--active" : "comment-leader"}>
      <polyline points={points} />
      <circle cx={1.5} cy={anchorY} r={2} />
    </g>
  );
}

/* ── Comment bubble ─────────────────────────────────────────────────────── */

interface CommentBubbleProps {
  comment: Comment;
  top: number;
  active: boolean;
  approximate: boolean;
  replying: boolean;
  ref: (el: HTMLElement | null) => void;
  onFocusThread: () => void;
  onReplyOpen: () => void;
  onReplyCancel: () => void;
  onReply: (body: string) => void;
  onResolve: () => void;
  onDelete: () => void;
}

function CommentBubble({
  comment,
  top,
  active,
  approximate,
  replying,
  ref,
  onFocusThread,
  onReplyOpen,
  onReplyCancel,
  onReply,
  onResolve,
  onDelete,
}: CommentBubbleProps) {
  const classes = ["comment-bubble"];
  if (active) classes.push("comment-bubble--active");
  if (comment.resolved) classes.push("comment-bubble--resolved");

  return (
    <article
      ref={ref}
      className={classes.join(" ")}
      style={{ transform: `translateY(${Math.round(top)}px)` }}
      onMouseDown={onFocusThread}
      aria-label={`Comment by ${comment.author}`}
    >
      <header className="comment-bubble-head">
        <span className="comment-avatar" aria-hidden="true">
          {initials(comment.author)}
        </span>
        <span className="comment-author">{comment.author}</span>
        <time className="comment-time" dateTime={comment.createdAt}>
          {formatTime(comment.createdAt)}
        </time>
      </header>

      <p className="comment-quote" title={comment.anchor.quote}>
        {comment.anchor.quote}
      </p>

      {approximate ? (
        <p className="comment-flag" title="The text moved; this anchor was re-matched approximately.">
          re-anchored approximately
        </p>
      ) : null}

      <p className="comment-body">{comment.body}</p>

      {comment.replies.length > 0 ? (
        <ol className="comment-replies">
          {comment.replies.map((reply) => (
            <li key={reply.id} className="comment-reply">
              <span className="comment-author">{reply.author}</span>
              <time className="comment-time" dateTime={reply.createdAt}>
                {formatTime(reply.createdAt)}
              </time>
              <p className="comment-body">{reply.body}</p>
            </li>
          ))}
        </ol>
      ) : null}

      {replying ? (
        <Composer
          placeholder="Reply…"
          submitLabel="Reply"
          onCancel={onReplyCancel}
          onSubmit={onReply}
        />
      ) : (
        <footer className="comment-bubble-actions">
          <button type="button" className="comment-action" onClick={onReplyOpen}>
            Reply
          </button>
          <button
            type="button"
            className="comment-action"
            onClick={onResolve}
            aria-pressed={comment.resolved}
          >
            {comment.resolved ? "Unresolve" : "Resolve"}
          </button>
          <button
            type="button"
            className="comment-action comment-action--danger"
            onClick={onDelete}
          >
            Delete
          </button>
        </footer>
      )}
    </article>
  );
}

/* ── Draft bubble ───────────────────────────────────────────────────────── */

interface DraftBubbleProps {
  quote: string;
  top: number;
  author: string;
  ref: (el: HTMLElement | null) => void;
  onCancel: () => void;
  onSubmit: (body: string) => void;
}

function DraftBubble({ quote, top, author, ref, onCancel, onSubmit }: DraftBubbleProps) {
  return (
    <article
      ref={ref}
      className="comment-bubble comment-bubble--draft comment-bubble--active"
      style={{ transform: `translateY(${Math.round(top)}px)` }}
      aria-label="New comment"
    >
      <header className="comment-bubble-head">
        <span className="comment-avatar" aria-hidden="true">
          {initials(author)}
        </span>
        <span className="comment-author">{author}</span>
      </header>
      <p className="comment-quote" title={quote}>
        {quote}
      </p>
      <Composer
        autoFocus
        placeholder="Add a comment…"
        submitLabel="Comment"
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    </article>
  );
}

/* ── Composer ───────────────────────────────────────────────────────────── */

interface ComposerProps {
  placeholder: string;
  submitLabel: string;
  autoFocus?: boolean;
  onCancel: () => void;
  onSubmit: (body: string) => void;
}

function Composer({ placeholder, submitLabel, autoFocus, onCancel, onSubmit }: ComposerProps) {
  const [value, setValue] = useState("");
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (autoFocus) areaRef.current?.focus();
  }, [autoFocus]);

  const submit = () => {
    if (!value.trim()) return;
    onSubmit(value);
    setValue("");
  };

  return (
    <div className="comment-composer">
      <textarea
        ref={areaRef}
        className="comment-input"
        rows={3}
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="comment-bubble-actions">
        <button
          type="button"
          className="comment-action comment-action--primary"
          onClick={submit}
          disabled={!value.trim()}
        >
          {submitLabel}
        </button>
        <button type="button" className="comment-action" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ── Orphan tray ────────────────────────────────────────────────────────── */

interface OrphanTrayProps {
  orphans: Comment[];
  canReattach: boolean;
  onReattach: (id: string) => void;
  onDismiss: (id: string) => void;
}

function OrphanTray({ orphans, canReattach, onReattach, onDismiss }: OrphanTrayProps) {
  return (
    <section className="orphan-tray" aria-label="Orphaned comments">
      <h2 className="orphan-tray-title">
        <UnlinkGlyph />
        Orphaned ({orphans.length})
      </h2>
      <p className="orphan-tray-hint">
        The text these were attached to is gone. Select the new text to re-attach.
      </p>
      <ul className="orphan-list">
        {orphans.map((comment) => (
          <li key={comment.id} className="orphan-item">
            <p className="comment-quote" title={comment.anchor.quote}>
              {comment.anchor.quote}
            </p>
            <p className="comment-body">{comment.body}</p>
            <div className="comment-bubble-actions">
              <button
                type="button"
                className="comment-action"
                onClick={() => onReattach(comment.id)}
                disabled={!canReattach}
                title={
                  canReattach
                    ? "Attach this comment to the selected text"
                    : "Select the replacement text in the plan first"
                }
              >
                Re-attach
              </button>
              <button
                type="button"
                className="comment-action comment-action--danger"
                onClick={() => onDismiss(comment.id)}
              >
                Dismiss
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── Sync badge ─────────────────────────────────────────────────────────── */

function SyncBadge({
  internal,
  count,
}: {
  internal: AnnotationsInternal | null;
  count: number;
}) {
  const sync = internal?.sync ?? "idle";
  if (sync === "unavailable" || sync === "error") {
    return (
      <span
        className="comment-sync comment-sync--warn"
        title={internal?.syncDetail ?? "The comment sidecar could not be written."}
      >
        Not saved to sidecar
      </span>
    );
  }
  if (sync === "saving") return <span className="comment-sync">Saving…</span>;
  return (
    <span className="comment-sync">
      {count === 0 ? "No comments" : `${count} comment${count === 1 ? "" : "s"}`}
    </span>
  );
}

/* ── Glyphs ─────────────────────────────────────────────────────────────── */

function CommentGlyph() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6A1.5 1.5 0 0 1 12.5 11H6.5L3 14v-3H3.5A1.5 1.5 0 0 1 2 9.5z" />
    </svg>
  );
}

function UnlinkGlyph() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6.5 9.5 4.9 11a2.7 2.7 0 0 1-3.8-3.8l1.6-1.6" />
      <path d="M9.5 6.5 11.1 5a2.7 2.7 0 0 1 3.8 3.8l-1.6 1.6" />
      <line x1="6.2" y1="2.2" x2="6.2" y2="3.8" />
      <line x1="9.8" y1="12.2" x2="9.8" y2="13.8" />
    </svg>
  );
}
