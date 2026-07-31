---
id: qui-2gwn
status: closed
deps: [qui-u2o3]
links: []
created: 2026-07-31T20:35:47Z
parent: qui-0ull
type: bug
priority: 2
tags: [editor]
---
# Markdown tables lose their layout

StarterKit ships no table schema node, so marked's GFM <table> output is dropped by Tiptap's DOM parser. Cell text may survive inline; the table structure does not. No crash.

Found during M1 verification. Not an issue for PLAN.md today, but real plans use tables and silently destroying one on load would corrupt a user's document the moment autosave writes it back — which M2 makes live.

## Design

Add @tiptap/extension-table (plus row/cell/header). Requires a dependency change, so it must happen in a scaffold commit, not inside a parallel lane. The markdown serializer must also learn to emit GFM table syntax.

## Acceptance Criteria

A plan containing a GFM table loads, renders as a table, survives a round-trip byte-stable, and is not corrupted by autosave.


## Notes

**2026-07-31T22:33:31Z**

Fixed and verified on main. A plan containing tables now survives autosave — previously the table was dropped by the DOM parser and written back missing within a second, silently destroying the user's content.

Verified with a plan containing an aligned table, an escaped pipe, inline marks, and a second ragged hand-aligned table. Editing one cell: content correct, alignment markers preserved, escaped pipe preserved, and the untouched second table stayed byte-identical. The edited table re-aligns as a whole, which is correct block granularity — a table is one block, so a changed cell means the block is re-serialized.

The lane also fixed a drift bug the shell agent spotted, and reframed it correctly: undo was never the problem, the typed save was already drifting 4 lines instead of 1 because rebuilding a list re-indented untouched siblings, rewrote bullet characters, and dropped loose-list blank lines. 18 regression tests, 11 of which fail without the fix.
