/**
 * annotations/anchorPlugin.ts
 *
 * Highlights anchored text without touching the document.
 *
 * ProseMirror decorations are a view-layer concern: they never enter the
 * document, so `editor.getJSON()` is byte-for-byte what it was before a comment
 * existed and the markdown round-trip stays exact (CONTRACT.md invariant 2).
 * A mark would have failed that test.
 *
 * The plugin owns two things:
 *   - the decoration set, which it maps through every transaction so highlights
 *     stay glued to their text between the debounced re-anchor passes;
 *   - clicks on anchored text, which focus the matching bubble (the other half
 *     of the two-way highlight).
 */

import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

export interface AnchorRange {
  id: string;
  from: number;
  to: number;
  resolved: boolean;
  /** True when the anchor was recovered by fuzzy match rather than exactly. */
  approximate: boolean;
}

interface AnchorSpec {
  commentId: string;
}

interface AnchorPluginState {
  decorations: DecorationSet;
}

interface AnchorMeta {
  ranges: readonly AnchorRange[];
  activeId: string | null;
}

export const anchorPluginKey = new PluginKey<AnchorPluginState>("quillCommentAnchors");

export interface AnchorPluginHandlers {
  /** Clicked anchored text — focus its thread. */
  onAnchorClick(id: string): void;
  /** Mod-Alt-M: start a comment on the selection. Returns true if handled. */
  onCommentShortcut(): boolean;
}

function buildDecorations(
  doc: PMNode,
  ranges: readonly AnchorRange[],
  activeId: string | null,
): DecorationSet {
  const decorations: Decoration[] = [];
  const max = doc.content.size;

  for (const range of ranges) {
    const from = Math.max(0, Math.min(range.from, max));
    const to = Math.max(0, Math.min(range.to, max));
    if (to <= from) continue;

    const classes = ["quill-anchor"];
    if (range.resolved) classes.push("quill-anchor--resolved");
    if (range.approximate) classes.push("quill-anchor--approximate");
    if (range.id === activeId) classes.push("quill-anchor--active");

    decorations.push(
      Decoration.inline(
        from,
        to,
        { class: classes.join(" ") },
        { commentId: range.id } satisfies AnchorSpec,
      ),
    );
  }

  return DecorationSet.create(doc, decorations);
}

/** Queues a decoration rebuild on the next transaction. */
export function setAnchorRanges(
  tr: Transaction,
  ranges: readonly AnchorRange[],
  activeId: string | null,
): Transaction {
  const meta: AnchorMeta = { ranges, activeId };
  return tr.setMeta(anchorPluginKey, meta);
}

/** Current, transaction-mapped ranges — the source of truth for bubble tops. */
export function currentAnchorRanges(state: EditorState): Array<{ id: string; from: number; to: number }> {
  const pluginState = anchorPluginKey.getState(state);
  if (!pluginState) return [];
  const out: Array<{ id: string; from: number; to: number }> = [];
  pluginState.decorations.find().forEach((decoration) => {
    const spec = decoration.spec as Partial<AnchorSpec>;
    if (typeof spec.commentId === "string") {
      out.push({ id: spec.commentId, from: decoration.from, to: decoration.to });
    }
  });
  return out;
}

export function createAnchorPlugin(getHandlers: () => AnchorPluginHandlers): Plugin<AnchorPluginState> {
  return new Plugin<AnchorPluginState>({
    key: anchorPluginKey,

    state: {
      init: () => ({ decorations: DecorationSet.empty }),
      apply(tr, value, _oldState, newState) {
        const meta = tr.getMeta(anchorPluginKey) as AnchorMeta | undefined;
        if (meta) {
          return { decorations: buildDecorations(newState.doc, meta.ranges, meta.activeId) };
        }
        if (!tr.docChanged) return value;
        return { decorations: value.decorations.map(tr.mapping, tr.doc) };
      },
    },

    props: {
      decorations(state) {
        return anchorPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
      },

      handleClick(view, pos) {
        const set = anchorPluginKey.getState(view.state)?.decorations;
        if (!set) return false;

        const hits = set
          .find(pos, pos)
          .filter((d) => d.from <= pos && pos <= d.to)
          .sort((a, b) => a.to - a.from - (b.to - b.from));

        const spec = hits[0]?.spec as Partial<AnchorSpec> | undefined;
        if (spec?.commentId) getHandlers().onAnchorClick(spec.commentId);
        // Never swallow the click: the caret still goes where the user clicked.
        return false;
      },

      handleKeyDown(_view, event) {
        const isShortcut =
          (event.metaKey || event.ctrlKey) &&
          event.altKey &&
          event.key.toLowerCase() === "m";
        if (!isShortcut) return false;
        return getHandlers().onCommentShortcut();
      },
    },
  });
}
