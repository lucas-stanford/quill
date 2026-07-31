/**
 * markdown/table.ts
 *
 * GFM table geometry: the pure, DOM-free half of table support.
 *
 * This module knows nothing about Tiptap nodes. It is handed rows of
 * already-serialized cell text and hands back the pipe table, which keeps the
 * fiddly parts — pipe escaping, alignment markers, column padding — in one
 * place that is trivial to test.
 *
 * ── Why the output is padded ────────────────────────────────────────────────
 *
 * A rebuilt table is emitted column-aligned because a plan is read as a diff as
 * often as it is read in a browser, and a ragged pipe table is unreadable in a
 * diff. This costs nothing in fidelity: GFM strips leading and trailing
 * whitespace from every cell, so padding is invisible to the parser.
 *
 * It costs nothing in *stability* either, which matters more. The padding is a
 * pure function of the cell text, so the same table always produces the same
 * bytes — which is what lets this same rendering double as the source-map key
 * in `serialize.ts`. A table the author hand-aligned differently is not
 * reformatted: it never reaches this module at all, because `docToMarkdown`
 * finds its original source and replays it verbatim.
 */

import { textWidth } from "./source";

/** Column alignment as GFM can express it; `null` is "unspecified". */
export type ColumnAlign = "left" | "center" | "right" | null;

/**
 * Narrowest delimiter we emit. `:-:` needs three characters, and holding every
 * column to the same floor keeps short columns from collapsing to `|-|`.
 */
const MIN_COLUMN_WIDTH = 3;

/** Coerce anything (a node attribute, a marked token field) to a ColumnAlign. */
export function normalizeAlign(value: unknown): ColumnAlign {
  return value === "left" || value === "center" || value === "right"
    ? value
    : null;
}

/**
 * Make one serialized cell safe to sit between pipes.
 *
 * Two hazards. A literal `|` would end the cell early, so it is escaped —
 * including inside code spans and links, because GFM splits a row on pipes
 * *before* it parses anything inline. And a newline would end the row, so soft
 * breaks are folded to spaces; a table cell is a single line by definition.
 */
export function escapeCellText(text: string): string {
  return text.replace(/[ \t]*\r?\n[ \t]*/g, " ").replace(/\|/g, "\\|");
}

/** The `---` / `:--` / `:-:` / `--:` marker for one column. */
function delimiterFor(align: ColumnAlign, width: number): string {
  const w = Math.max(width, MIN_COLUMN_WIDTH);
  switch (align) {
    case "left":
      return `:${"-".repeat(w - 1)}`;
    case "right":
      return `${"-".repeat(w - 1)}:`;
    case "center":
      return `:${"-".repeat(w - 2)}:`;
    default:
      return "-".repeat(w);
  }
}

/** Pad one cell to the column width, following the column's own alignment. */
function padCell(text: string, width: number, align: ColumnAlign): string {
  const slack = Math.max(0, width - textWidth(text));
  if (slack === 0) return text;
  switch (align) {
    case "right":
      return " ".repeat(slack) + text;
    case "center": {
      const left = Math.floor(slack / 2);
      return " ".repeat(left) + text + " ".repeat(slack - left);
    }
    default:
      return text + " ".repeat(slack);
  }
}

/**
 * Render a GFM pipe table.
 *
 * `rows[0]` is the header — GFM has no other way to start a table, so a
 * document whose first row is a body row still emits it as the header rather
 * than dropping it. Short rows are padded with empty cells and the column count
 * is taken from the *widest* row, so a cell can never fall off the end.
 *
 * Returns "" for a table with no rows at all, which the caller drops.
 */
export function renderGfmTable(
  rows: string[][],
  aligns: ColumnAlign[],
): string {
  if (rows.length === 0) return "";

  const columns = Math.max(1, ...rows.map((row) => row.length));
  const widths: number[] = [];
  for (let c = 0; c < columns; c++) {
    let width = MIN_COLUMN_WIDTH;
    for (const row of rows) width = Math.max(width, textWidth(row[c] ?? ""));
    widths.push(width);
  }

  const alignAt = (c: number): ColumnAlign => aligns[c] ?? null;
  const renderRow = (row: string[]): string => {
    const cells: string[] = [];
    for (let c = 0; c < columns; c++) {
      cells.push(padCell(row[c] ?? "", widths[c], alignAt(c)));
    }
    return `| ${cells.join(" | ")} |`;
  };

  const lines = [renderRow(rows[0])];
  lines.push(
    `| ${widths.map((w, c) => delimiterFor(alignAt(c), w)).join(" | ")} |`,
  );
  for (let r = 1; r < rows.length; r++) lines.push(renderRow(rows[r]));

  return lines.join("\n");
}
