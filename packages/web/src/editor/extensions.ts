/**
 * editor/extensions.ts
 *
 * The document schema, in one place.
 *
 * StarterKit ships no table node. `marked` emits `<table>` for a GFM table and
 * Tiptap's DOM parser drops any element the schema has no node for, so before
 * these extensions were registered a plan containing a table lost it on load —
 * and, once M2 made autosave live, lost it on disk about a second later.
 *
 * Exported separately from the hook so tests can build the *same* schema the
 * browser runs without mounting an editor. A round-trip test that used a
 * hand-written schema would prove nothing about the real one.
 */

import StarterKit from "@tiptap/starter-kit";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import type { Extensions } from "@tiptap/react";

/**
 * Column resizing stays off. A column width is a browser-only measurement that
 * GFM has nowhere to store, so the handles would offer an edit that no save can
 * keep — and every drag would mark the document dirty for nothing.
 */
export const editorExtensions: Extensions = [
  StarterKit,
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
];
