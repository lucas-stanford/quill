/**
 * tracking/revision.ts
 *
 * `applyRevision(markdown)`: take a whole rewritten plan and land it in the
 * open document as AI-authored tracked changes.
 *
 * The point is that a revision must be *reviewable*. Replacing the document
 * with the new markdown would be one enormous change nobody can judge, and
 * would throw away the reviewer's ability to keep half of it. So the new
 * markdown is parsed, diffed against the live document (see `diff.ts`), and the
 * result is applied as the smallest set of insertions and strike-throughs that
 * expresses it.
 *
 * Nothing here destroys content. Insertions add text or whole blocks; deletions
 * only mark. That is what makes rejecting every AI change restore the document
 * exactly — the inverse of an insertion is deleting the range that was
 * inserted, and the inverse of a deletion is forgetting about it.
 */

import type { JSONContent } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { markdownToJSON } from "../markdown";
import type { ChangeAuthor } from "../types";
import { diffDocuments } from "./diff";
import type { DiffBlock } from "./diff";
import { trackingKey } from "./plugin";
import { newChangeId } from "./ranges";
import type { ChangeKind, TrackedRange } from "./ranges";

/** A run of text in a block, and where it lives in the document. */
interface TextSegment {
  from: number;
  to: number;
  /** Offset of this run within the block's plain text. */
  offset: number;
}

export interface BlockInfo {
  index: number;
  /** Position before the block node. */
  from: number;
  /** Position after the block node. */
  to: number;
  type: string;
  text: string;
  segments: TextSegment[];
}

export type RevisionEdit =
  | { kind: "markDeleted"; from: number; to: number }
  | { kind: "insertText"; pos: number; text: string }
  | { kind: "insertNode"; pos: number; json: JSONContent };

// ─── Reading both sides the same way ────────────────────────────────────────

/**
 * Top-level blocks of the live document, with a map from text offsets back to
 * document positions.
 *
 * The text is assembled by walking text nodes in document order — the same walk
 * `textOfJSON` does on the parsed markdown — so the two sides of the diff are
 * always described in the same terms.
 */
export function scanBlocks(doc: ProseMirrorNode): BlockInfo[] {
  const blocks: BlockInfo[] = [];
  doc.forEach((node, offset, index) => {
    const segments: TextSegment[] = [];
    let text = "";
    node.nodesBetween(0, node.content.size, (child, pos) => {
      if (child.isText && child.text) {
        const from = offset + 1 + pos;
        segments.push({ from, to: from + child.text.length, offset: text.length });
        text += child.text;
      }
      return true;
    });
    blocks.push({
      index,
      from: offset,
      to: offset + node.nodeSize,
      type: node.type.name,
      text,
      segments,
    });
  });
  return blocks;
}

/** Plain text of a parsed markdown node, in document order. */
export function textOfJSON(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(textOfJSON).join("");
}

export function jsonBlocks(doc: JSONContent): DiffBlock<JSONContent>[] {
  return (doc.content ?? []).map((node) => ({
    type: node.type ?? "",
    text: textOfJSON(node),
    node,
  }));
}

function offsetToPos(block: BlockInfo, offset: number): number | null {
  for (const segment of block.segments) {
    const length = segment.to - segment.from;
    if (offset <= segment.offset + length) {
      return segment.from + (offset - segment.offset);
    }
  }
  const last = block.segments[block.segments.length - 1];
  return last ? last.to : null;
}

function blockTextSpan(block: BlockInfo): { from: number; to: number } | null {
  if (block.segments.length === 0) return null;
  return {
    from: block.segments[0].from,
    to: block.segments[block.segments.length - 1].to,
  };
}

// ─── Planning ───────────────────────────────────────────────────────────────

function editPosition(edit: RevisionEdit): number {
  return edit.kind === "markDeleted" ? edit.from : edit.pos;
}

/**
 * The document edits that turn the live document into `markdown`, expressed
 * against the live document's positions and in ascending order.
 */
export function planRevision(
  doc: ProseMirrorNode,
  markdown: string,
): RevisionEdit[] {
  const oldBlocks = scanBlocks(doc);

  let parsed: JSONContent;
  try {
    parsed = markdownToJSON(markdown);
  } catch {
    return [];
  }
  const newBlocks = jsonBlocks(parsed);

  const ops = diffDocuments(
    oldBlocks.map((block) => ({ type: block.type, text: block.text })),
    newBlocks,
  );

  const edits: RevisionEdit[] = [];
  for (const op of ops) {
    if (op.type === "delete") {
      const span = blockTextSpan(oldBlocks[op.oldIndex]);
      if (span) edits.push({ kind: "markDeleted", ...span });
      continue;
    }

    if (op.type === "insert") {
      const anchor = oldBlocks[op.beforeOldIndex];
      const pos = anchor ? anchor.from : doc.content.size;
      if (op.block.node) edits.push({ kind: "insertNode", pos, json: op.block.node });
      continue;
    }

    const block = oldBlocks[op.oldIndex];
    let offset = 0;
    for (const wordOp of op.ops) {
      if (wordOp.type === "equal") {
        offset += wordOp.text.length;
        continue;
      }
      if (wordOp.type === "delete") {
        const from = offsetToPos(block, offset);
        const to = offsetToPos(block, offset + wordOp.text.length);
        if (from !== null && to !== null && to > from) {
          edits.push({ kind: "markDeleted", from, to });
        }
        offset += wordOp.text.length;
        continue;
      }
      const pos = offsetToPos(block, offset);
      if (pos !== null) edits.push({ kind: "insertText", pos, text: wordOp.text });
    }
  }

  return edits.sort((a, b) => editPosition(a) - editPosition(b));
}

// ─── Applying ───────────────────────────────────────────────────────────────

interface PendingRange {
  kind: ChangeKind;
  from: number;
  to: number;
  /**
   * Number of steps already in the transaction when these positions were
   * valid. The final positions are found by mapping through everything after.
   */
  stepIndex: number;
}

/**
 * Build the single transaction that applies a revision.
 *
 * Edits run front to back with each position mapped through the steps applied
 * so far, and the ranges they produce are mapped forward at the end, so one
 * transaction carries the whole revision and undo takes all of it back at once.
 */
export function buildRevisionTransaction(
  state: EditorState,
  markdown: string,
  author: ChangeAuthor = "ai",
): Transaction | null {
  const edits = planRevision(state.doc, markdown);
  if (edits.length === 0) return null;

  const tr = state.tr;
  const pending: PendingRange[] = [];

  for (const edit of edits) {
    if (edit.kind === "markDeleted") {
      const from = tr.mapping.map(edit.from, 1);
      const to = tr.mapping.map(edit.to, -1);
      if (to > from) {
        pending.push({ kind: "deletion", from, to, stepIndex: tr.steps.length });
      }
      continue;
    }

    const pos = tr.mapping.map(edit.pos, 1);

    if (edit.kind === "insertText") {
      const resolved = tr.doc.resolve(pos);
      if (!resolved.parent.isTextblock) continue;
      tr.insert(pos, state.schema.text(edit.text, [...resolved.marks()]));
      pending.push({
        kind: "insertion",
        from: pos,
        to: pos + edit.text.length,
        stepIndex: tr.steps.length,
      });
      continue;
    }

    let node: ProseMirrorNode;
    try {
      node = state.schema.nodeFromJSON(edit.json);
    } catch {
      // A block the current schema cannot represent (a table before the tables
      // lane lands, say). Skipping it loses that one block of the revision
      // rather than throwing the whole thing away.
      continue;
    }
    try {
      tr.insert(pos, node);
    } catch {
      continue;
    }
    pending.push({
      kind: "insertion",
      from: pos,
      to: pos + node.nodeSize,
      stepIndex: tr.steps.length,
    });
  }

  const ranges: TrackedRange[] = pending
    .map((item) => {
      const rest = tr.mapping.slice(item.stepIndex);
      return {
        id: newChangeId(),
        author,
        kind: item.kind,
        from: rest.map(item.from, 1),
        to: rest.map(item.to, -1),
      };
    })
    .filter((range) => range.to > range.from);

  if (ranges.length === 0 && tr.steps.length === 0) return null;
  return tr.setMeta(trackingKey, { add: ranges, skipRecord: true });
}
