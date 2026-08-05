/**
 * tracking/plugin.ts
 *
 * The ProseMirror plugin behind tracked changes.
 *
 * ── Why a plugin and not a schema mark ──────────────────────────────────────
 *
 * The editor lane owns `usePlanEditor`, and a ProseMirror schema is built once,
 * at editor construction, from the extension list. This lane cannot add to that
 * list: it is handed a live `Editor`. The two ways in are `editor.registerPlugin()`
 * — public, supported API on both Tiptap and ProseMirror — and rebuilding
 * `editor.extensionManager` to regenerate the schema underneath a document that
 * was already parsed against the old one. The second is unsupported, would have
 * to re-run for every extension the other four lanes add, and drops our mark
 * type the moment anything else reconfigures the editor.
 *
 * So changes are held in plugin state and painted with inline `Decoration`s.
 * That also settles the invariant that matters most (CONTRACT invariant 2):
 * decorations are not document content, so `editor.getJSON()` cannot see them
 * and the frozen serializer cannot serialize them. There is no mark to leak, no
 * mark signature to split a `**bold**` run in half, and nothing to strip on the
 * way to `PLAN.md`. Marks would have needed a monkey-patch of `getJSON` on a
 * frozen call path to achieve the same thing.
 *
 * ── How a deletion is represented ───────────────────────────────────────────
 *
 * A deletion does not delete. The text stays exactly where it is and gains a
 * "deletion" range, which paints it struck through; only `accept` removes it
 * from the document. Every path that would destroy text — Backspace, Delete,
 * word/line delete, typing over a selection, pasting over a selection, cut — is
 * intercepted before the step is created and turned into a range instead. The
 * one exception is text you inserted yourself and nobody has accepted yet: that
 * is really removed, because a strike-through over an edit that never landed is
 * an edit nobody can adjudicate.
 */

import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode, Mark, ResolvedPos, Slice } from "@tiptap/pm/model";
import type { ChangeAuthor } from "../types";
import type { TrackedChange } from "./useTrackedChanges";
import {
  clampRanges,
  newChangeId,
  normalizeRanges,
  splitDeletion,
  subtractIntervals,
} from "./ranges";
import type { Interval, TrackedRange } from "./ranges";

/** Everything the user does themselves is attributed to the human reviewer. */
export const LOCAL_AUTHOR: ChangeAuthor = "human";

export interface TrackingState {
  /** While false, edits apply straight to the document as they always did. */
  enabled: boolean;
  ranges: TrackedRange[];
  /** The change `goToNext`/`goToPrevious` last landed on, highlighted. */
  activeId: string | null;
  decorations: DecorationSet;
}

/** Instructions carried on a transaction for this plugin. */
export interface TrackingMeta {
  enabled?: boolean;
  /** Ranges in the coordinates of the document this transaction produces. */
  add?: TrackedRange[];
  remove?: string[];
  activeId?: string | null;
  clear?: boolean;
  /** Insertions in this transaction are already accounted for. */
  skipRecord?: boolean;
}

export const trackingKey = new PluginKey<TrackingState>("quillTrackedChanges");

const EMPTY_STATE: TrackingState = {
  enabled: false,
  ranges: [],
  activeId: null,
  decorations: DecorationSet.empty,
};

// ─── Reading ────────────────────────────────────────────────────────────────

export function getTrackingState(state: EditorState): TrackingState {
  return trackingKey.getState(state) ?? EMPTY_STATE;
}

/** The public view of the pending changes, in document order. */
export function trackedChanges(state: EditorState): TrackedChange[] {
  return getTrackingState(state).ranges.map((range) => ({
    id: range.id,
    author: range.author,
    kind: range.kind,
    text: state.doc.textBetween(range.from, range.to, " "),
  }));
}

export function findRange(
  state: EditorState,
  id: string,
): TrackedRange | undefined {
  return getTrackingState(state).ranges.find((range) => range.id === id);
}

// ─── Decorations ────────────────────────────────────────────────────────────

function decorationClass(range: TrackedRange, activeId: string | null): string {
  const classes = [
    "quill-tc",
    range.kind === "insertion" ? "quill-tc--insertion" : "quill-tc--deletion",
    `quill-tc--${range.author}`,
  ];
  if (range.id === activeId) classes.push("quill-tc--active");
  return classes.join(" ");
}

function buildDecorations(
  doc: ProseMirrorNode,
  ranges: readonly TrackedRange[],
  activeId: string | null,
): DecorationSet {
  if (ranges.length === 0) return DecorationSet.empty;
  return DecorationSet.create(
    doc,
    ranges.map((range) =>
      Decoration.inline(
        range.from,
        range.to,
        {
          class: decorationClass(range, activeId),
          "data-change-id": range.id,
          "data-change-kind": range.kind,
          "data-change-author": range.author,
        },
        { id: range.id },
      ),
    ),
  );
}

// ─── Range bookkeeping ──────────────────────────────────────────────────────

/**
 * Keep ranges tight around their content: a position typed at the very edge of
 * a change belongs to whatever the recorder decides, not to whichever
 * neighbouring range happened to be adjacent.
 */
function mapRanges(
  ranges: readonly TrackedRange[],
  tr: Transaction,
): TrackedRange[] {
  return ranges.map((range) => ({
    ...range,
    from: tr.mapping.map(range.from, 1),
    to: tr.mapping.map(range.to, -1),
  }));
}

/**
 * Text cannot be both freshly inserted and deleted, so an insertion carves
 * itself out of any deletion it lands inside. The deletion keeps its id, which
 * is what lets one accept/reject still operate on both halves.
 */
function resolveOverlaps(ranges: readonly TrackedRange[]): TrackedRange[] {
  const insertions = ranges.filter((range) => range.kind === "insertion");
  if (insertions.length === 0) return [...ranges];

  const out: TrackedRange[] = [];
  for (const range of ranges) {
    if (range.kind === "insertion") {
      out.push(range);
      continue;
    }
    for (const piece of subtractIntervals(range, insertions)) {
      out.push({ ...range, ...piece });
    }
  }
  return out;
}

function settle(
  ranges: readonly TrackedRange[],
  doc: ProseMirrorNode,
): TrackedRange[] {
  return normalizeRanges(resolveOverlaps(clampRanges(ranges, doc.content.size)));
}

/**
 * True when this transaction swapped the whole document out — a programmatic
 * load or an external reload. Pending changes describe text that is no longer
 * there, so they go with it rather than re-anchoring onto unrelated content.
 */
function replacesWholeDoc(tr: Transaction, before: ProseMirrorNode): boolean {
  const step = tr.steps[0];
  return (
    tr.steps.length === 1 &&
    step instanceof ReplaceStep &&
    step.from === 0 &&
    step.to === before.content.size
  );
}

// ─── Recording insertions ───────────────────────────────────────────────────

/** The ranges a transaction's own steps filled with new content. */
function insertedIntervals(tr: Transaction): Interval[] {
  const out: Interval[] = [];
  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i];
    // Only content steps count. Toggling bold produces AddMarkStep, and
    // wrapping a paragraph in a list produces ReplaceAroundStep; neither adds
    // text, so neither is a tracked insertion.
    if (!(step instanceof ReplaceStep) || step.slice.size === 0) continue;
    const rest = tr.mapping.slice(i + 1);
    const from = rest.map(step.from, 1);
    const to = rest.map(step.from + step.slice.size, -1);
    if (to > from) out.push({ from, to });
  }
  return out;
}

function shouldRecord(tr: Transaction, before: ProseMirrorNode): boolean {
  if (!tr.docChanged) return false;
  const meta = tr.getMeta(trackingKey) as TrackingMeta | undefined;
  if (meta?.skipRecord) return false;
  // Programmatic content loads (`setContent`) must never look like typing.
  if (tr.getMeta("preventUpdate")) return false;
  // Undo and redo are the user taking an edit back, not making one.
  if (tr.getMeta("history$")) return false;
  return !replacesWholeDoc(tr, before);
}

// ─── Transaction builders ───────────────────────────────────────────────────

function mergeMeta(tr: Transaction, patch: TrackingMeta): Transaction {
  const current = (tr.getMeta(trackingKey) as TrackingMeta | undefined) ?? {};
  return tr.setMeta(trackingKey, {
    ...current,
    ...patch,
    add: [...(current.add ?? []), ...(patch.add ?? [])],
    remove: [...(current.remove ?? []), ...(patch.remove ?? [])],
  });
}

export function setTrackingEnabled(
  state: EditorState,
  enabled: boolean,
): Transaction {
  return state.tr.setMeta(trackingKey, { enabled, skipRecord: true });
}

export function setActiveChange(
  state: EditorState,
  activeId: string | null,
): Transaction {
  return state.tr.setMeta(trackingKey, { activeId, skipRecord: true });
}

function clamp(pos: number, doc: ProseMirrorNode): number {
  return Math.max(0, Math.min(pos, doc.content.size));
}

function selectionAt(
  tr: Transaction,
  pos: number,
  bias: -1 | 1,
): TextSelection | null {
  const resolved = tr.doc.resolve(clamp(pos, tr.doc));
  const selection = TextSelection.near(resolved, bias);
  return selection instanceof TextSelection ? selection : null;
}

/**
 * Turn "delete `[from, to)`" into tracked changes.
 *
 * Nothing is destroyed except the author's own pending insertions; the rest is
 * struck. `caret` says where the cursor lands, which is what makes holding
 * Backspace walk backwards through a paragraph striking as it goes.
 */
export function buildDeletionTransaction(
  state: EditorState,
  from: number,
  to: number,
  author: ChangeAuthor,
  caret: "start" | "end" | null,
): Transaction | null {
  if (to <= from) return null;
  const tracking = getTrackingState(state);
  const { remove, strike } = splitDeletion({ from, to }, tracking.ranges, author);

  const tr = state.tr;
  for (const interval of [...remove].sort((a, b) => b.from - a.from)) {
    tr.delete(interval.from, interval.to);
  }

  const added: TrackedRange[] = [];
  for (const interval of strike) {
    const mappedFrom = tr.mapping.map(interval.from, 1);
    const mappedTo = tr.mapping.map(interval.to, -1);
    if (mappedTo > mappedFrom) {
      added.push({
        id: newChangeId(),
        author,
        kind: "deletion",
        from: mappedFrom,
        to: mappedTo,
      });
    }
  }

  mergeMeta(tr, { add: added, skipRecord: true });

  if (caret !== null) {
    const target =
      caret === "start" ? tr.mapping.map(from, -1) : tr.mapping.map(to, 1);
    const selection = selectionAt(tr, target, caret === "start" ? -1 : 1);
    if (selection) tr.setSelection(selection);
  }
  return tr;
}

function marksAt(doc: ProseMirrorNode, pos: number): readonly Mark[] {
  const resolved: ResolvedPos = doc.resolve(clamp(pos, doc));
  return resolved.marks();
}

/**
 * Remove a tracked range for real.
 *
 * `dropEmptyBlock` is used when accepting a deletion that covers a whole
 * paragraph: taking only the text would leave an empty block behind, which is a
 * blank line the reviewer never asked to keep.
 *
 * A range is never allowed to delete ACROSS a block boundary. In ProseMirror
 * `delete(from, to)` spanning two textblocks joins them, so accepting one hunk
 * would run two list items into a single step — the text of both survives, one
 * of them stops being a step, and the ticket it would have become is never
 * created. The range is therefore cut at every boundary and each piece deleted
 * on its own. Nothing about what the reviewer sees changes; the structure does
 * not collapse.
 */
function deleteRange(
  tr: Transaction,
  range: Interval,
  dropEmptyBlock: boolean,
): void {
  const pieces = splitAtBlockBoundaries(tr, range);

  /*
   * One textblock, or none: this is an ordinary range — quite possibly a whole
   * inserted node, whose range takes in the node's own open and close tokens —
   * and it is deleted exactly as given. Narrowing it to the block's content
   * would leave the empty node behind.
   */
  if (pieces === null) {
    if (dropEmptyBlock) {
      const resolved = tr.doc.resolve(clamp(range.from, tr.doc));
      const wholeBlock =
        resolved.depth === 1 &&
        resolved.parent.isTextblock &&
        range.from === resolved.start() &&
        range.to === resolved.end() &&
        tr.doc.childCount > 1;
      if (wholeBlock) {
        tr.delete(resolved.before(), resolved.after());
        return;
      }
    }
    tr.delete(range.from, range.to);
    return;
  }

  /*
   * Two or more: deleting straight through would join them. Each block's share
   * is deleted on its own, and a block left with nothing goes with it — an
   * emptied step is not a step, and keeping the husk would put a blank item in
   * the list.
   */
  for (const piece of pieces) {
    const resolved = tr.doc.resolve(clamp(piece.from, tr.doc));
    const emptied =
      resolved.parent.isTextblock &&
      piece.from === resolved.start() &&
      piece.to === resolved.end() &&
      (resolved.depth > 1 || tr.doc.childCount > 1);
    if (emptied) tr.delete(resolved.before(), resolved.after());
    else tr.delete(piece.from, piece.to);
  }
}

/**
 * The parts of `range` that each lie within a single textblock, back to front
 * so earlier positions stay valid as the transaction is built — or `null` when
 * the range touches at most one textblock and needs no special handling.
 */
function splitAtBlockBoundaries(tr: Transaction, range: Interval): Interval[] | null {
  const from = clamp(range.from, tr.doc);
  const to = clamp(range.to, tr.doc);
  if (to <= from) return null;

  const pieces: Interval[] = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    const start = Math.max(from, pos + 1);
    const end = Math.min(to, pos + 1 + node.content.size);
    if (end > start) pieces.push({ from: start, to: end });
    return false;
  });

  if (pieces.length < 2) return null;
  return pieces.sort((a, b) => b.from - a.from);
}

function resolveTargets(
  state: EditorState,
  ids: readonly string[],
): TrackedRange[] {
  const wanted = new Set(ids);
  return getTrackingState(state).ranges.filter((range) => wanted.has(range.id));
}

/**
 * Accept: an insertion becomes ordinary text, a deletion finally happens.
 * Ranges are applied back to front so earlier positions stay valid.
 */
export function buildAcceptTransaction(
  state: EditorState,
  ids: readonly string[],
): Transaction | null {
  const targets = resolveTargets(state, ids);
  if (targets.length === 0) return null;

  const tr = state.tr;
  const deletions = targets
    .filter((range) => range.kind === "deletion")
    .sort((a, b) => b.from - a.from);
  for (const range of deletions) deleteRange(tr, range, true);

  return mergeMeta(tr, { remove: targets.map((r) => r.id), skipRecord: true });
}

/**
 * Reject: an insertion is removed, a deletion is un-struck.
 *
 * This is the exact inverse of how the change was applied, which is what makes
 * `rejectAll("ai")` restore the pre-revision document byte for byte.
 */
export function buildRejectTransaction(
  state: EditorState,
  ids: readonly string[],
): Transaction | null {
  const targets = resolveTargets(state, ids);
  if (targets.length === 0) return null;

  const tr = state.tr;
  const insertions = targets
    .filter((range) => range.kind === "insertion")
    .sort((a, b) => b.from - a.from);
  for (const range of insertions) deleteRange(tr, range, false);

  return mergeMeta(tr, { remove: targets.map((r) => r.id), skipRecord: true });
}

// ─── Intercepting destructive input ─────────────────────────────────────────

const WORD_BOUNDARY = /\s/;

function previousWordStart(text: string, offset: number): number {
  let i = offset;
  while (i > 0 && WORD_BOUNDARY.test(text[i - 1])) i--;
  while (i > 0 && !WORD_BOUNDARY.test(text[i - 1])) i--;
  return i;
}

function nextWordEnd(text: string, offset: number): number {
  let i = offset;
  while (i < text.length && WORD_BOUNDARY.test(text[i])) i++;
  while (i < text.length && !WORD_BOUNDARY.test(text[i])) i++;
  return i;
}

/** Length of the last/first grapheme, so emoji are not split in half. */
function lastCodePointLength(text: string): number {
  const chars = [...text];
  return chars.length > 0 ? chars[chars.length - 1].length : 1;
}

function firstCodePointLength(text: string): number {
  const first = [...text][0];
  return first ? first.length : 1;
}

/**
 * What a collapsed Backspace/Delete would remove.
 *
 * Returns null when ProseMirror should handle it after all: at a block boundary
 * the key joins two blocks rather than removing text, and nothing is lost, so
 * there is nothing to track.
 */
function collapsedDeleteRange(
  $pos: ResolvedPos,
  backward: boolean,
  event: KeyboardEvent,
): Interval | null {
  const parent = $pos.parent;
  if (!parent.isTextblock) return null;

  const text = parent.textBetween(0, parent.content.size);
  // Inline leaf nodes (hard breaks) make text offsets and document offsets
  // disagree; hand those back rather than guess at a position.
  if (text.length !== parent.content.size) return null;

  const offset = $pos.parentOffset;
  const start = $pos.start();

  if (backward) {
    if (offset === 0) return null;
    let begin: number;
    if (event.metaKey) begin = 0;
    else if (event.altKey) begin = previousWordStart(text, offset);
    else begin = offset - lastCodePointLength(text.slice(0, offset));
    return { from: start + begin, to: $pos.pos };
  }

  if (offset >= parent.content.size) return null;
  let end: number;
  if (event.metaKey) end = parent.content.size;
  else if (event.altKey) end = nextWordEnd(text, offset);
  else end = offset + firstCodePointLength(text.slice(offset));
  return { from: $pos.pos, to: start + end };
}

function handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
  if (!getTrackingState(view.state).enabled) return false;
  if (event.key !== "Backspace" && event.key !== "Delete") return false;

  const { state } = view;
  const selection = state.selection;
  const backward = event.key === "Backspace";

  let target: Interval | null;
  if (!selection.empty) {
    target = { from: selection.from, to: selection.to };
  } else {
    target = collapsedDeleteRange(selection.$head, backward, event);
  }
  if (!target) return false;

  const tr = buildDeletionTransaction(
    state,
    target.from,
    target.to,
    LOCAL_AUTHOR,
    backward ? "start" : "end",
  );
  if (!tr) return false;
  view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Typing over a selection is a deletion and an insertion at once. The old text
 * is struck and the new text lands after it, exactly as Word does.
 */
function handleTextInput(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  if (!getTrackingState(view.state).enabled) return false;
  // A plain insertion needs no interception: appendTransaction records it.
  if (from === to || text === "") return false;

  const tr = buildDeletionTransaction(view.state, from, to, LOCAL_AUTHOR, "end");
  if (!tr) return false;

  const pos = tr.selection.from;
  tr.insert(pos, view.state.schema.text(text, [...marksAt(tr.doc, pos)]));
  mergeMeta(tr, {
    add: [
      {
        id: newChangeId(),
        author: LOCAL_AUTHOR,
        kind: "insertion",
        from: pos,
        to: pos + text.length,
      },
    ],
    skipRecord: true,
  });
  const selection = selectionAt(tr, pos + text.length, 1);
  if (selection) tr.setSelection(selection);
  view.dispatch(tr.scrollIntoView());
  return true;
}

function handlePaste(view: EditorView, _event: ClipboardEvent, slice: Slice): boolean {
  if (!getTrackingState(view.state).enabled) return false;
  const { selection } = view.state;
  if (selection.empty || slice.size === 0) return false;

  const tr = buildDeletionTransaction(
    view.state,
    selection.from,
    selection.to,
    LOCAL_AUTHOR,
    "end",
  );
  if (!tr) return false;

  const pos = tr.selection.from;
  tr.replaceSelection(slice);
  const end = Math.max(pos, tr.selection.to);
  mergeMeta(tr, {
    add: [
      {
        id: newChangeId(),
        author: LOCAL_AUTHOR,
        kind: "insertion",
        from: pos,
        to: end,
      },
    ],
    skipRecord: true,
  });
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** Cut still copies; it just strikes instead of removing. */
function handleCut(view: EditorView, event: Event): boolean {
  if (!getTrackingState(view.state).enabled) return false;
  const { selection } = view.state;
  if (selection.empty) return false;

  const clipboard = (event as ClipboardEvent).clipboardData;
  if (!clipboard) return false;
  event.preventDefault();
  clipboard.setData(
    "text/plain",
    view.state.doc.textBetween(selection.from, selection.to, "\n\n", " "),
  );

  const tr = buildDeletionTransaction(
    view.state,
    selection.from,
    selection.to,
    LOCAL_AUTHOR,
    "end",
  );
  if (tr) view.dispatch(tr.scrollIntoView());
  return true;
}

// ─── The plugin ─────────────────────────────────────────────────────────────

export function createTrackingPlugin(enabled = false): Plugin<TrackingState> {
  return new Plugin<TrackingState>({
    key: trackingKey,

    state: {
      init: () => ({ ...EMPTY_STATE, enabled }),

      apply(tr, previous, oldState, newState) {
        const meta = tr.getMeta(trackingKey) as TrackingMeta | undefined;
        if (!tr.docChanged && !meta) return previous;

        let ranges = previous.ranges;
        if (tr.docChanged) {
          ranges = replacesWholeDoc(tr, oldState.doc) ? [] : mapRanges(ranges, tr);
        }
        if (meta?.clear) ranges = [];
        if (meta?.remove?.length) {
          const gone = new Set(meta.remove);
          ranges = ranges.filter((range) => !gone.has(range.id));
        }
        if (meta?.add?.length) ranges = [...ranges, ...meta.add];

        ranges = settle(ranges, newState.doc);

        let activeId = meta && "activeId" in meta ? meta.activeId! : previous.activeId;
        if (activeId && !ranges.some((range) => range.id === activeId)) {
          activeId = null;
        }

        return {
          enabled: meta?.enabled ?? previous.enabled,
          ranges,
          activeId,
          decorations: buildDecorations(newState.doc, ranges, activeId),
        };
      },
    },

    /**
     * Every insertion, whatever produced it — typing, IME, paste, drop or a
     * command — arrives here as a step and is recorded. Deletions never do:
     * they are intercepted above, before a step exists.
     */
    appendTransaction(transactions, oldState, newState) {
      if (!getTrackingState(newState).enabled) return null;

      const collected: Interval[] = [];
      let before = oldState.doc;
      for (const tr of transactions) {
        for (const interval of collected) {
          interval.from = tr.mapping.map(interval.from, 1);
          interval.to = tr.mapping.map(interval.to, -1);
        }
        if (shouldRecord(tr, before)) collected.push(...insertedIntervals(tr));
        before = tr.doc;
      }

      const added: TrackedRange[] = collected
        .filter((interval) => interval.to > interval.from)
        .map((interval) => ({
          id: newChangeId(),
          author: LOCAL_AUTHOR,
          kind: "insertion" as const,
          ...interval,
        }));
      if (added.length === 0) return null;

      return newState.tr.setMeta(trackingKey, { add: added, skipRecord: true });
    },

    props: {
      decorations: (state) => getTrackingState(state).decorations,
      handleKeyDown,
      handleTextInput,
      handlePaste,
      handleDOMEvents: { cut: handleCut },
    },
  });
}
