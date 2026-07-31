---
id: qui-gpcw
status: closed
deps: [qui-u2o3]
links: []
created: 2026-07-31T20:44:43Z
type: bug
priority: 0
parent: qui-u2o3
tags: [editor, lane]
---
# One keystroke reflows the whole file

Measured on merged main: typing a single character into a plan rewrites 75 lines. The serializer joins soft-wrapped paragraphs into one long line each, so the first save reflows every prose block in the document.

This defeats the entire point of M2 ('Edit without drift'), fails its acceptance criterion of a zero-line diff on an untouched plan, and breaks PLAN.md's first principle that the plan file stays clean, readable and diffable. It also undermines M4, where the AI revision flow depends on diffing the plan.

Markdown soft wraps are semantically insignificant, so a tree-walking serializer has no way to recover them — the source formatting has to be carried alongside the document and reused.

## Design

Preserve source formatting for untouched blocks. Keep each top-level block's raw source text alongside the parsed document; on serialize, emit the raw source verbatim for any block whose semantic content is unchanged, and only re-serialize blocks the user actually edited. Re-serialized blocks should be wrapped to the document's prevailing width so even edited blocks stay diff-friendly.

## Acceptance Criteria

Loading and saving an untouched plan produces a zero-line diff. Typing one character changes only the block that was edited.


## Notes

**2026-07-31T21:32:47Z**

Fixed and verified independently on merged main. Typing one character now changes exactly one line (was 75), and loading+saving an untouched plan produces a zero-line diff.

Approach: parse keeps each top-level block's raw source, keyed by the block's canonical serialization rather than by position, so insert/delete/reorder cannot shift the mapping and duplicate blocks can only collide when semantically identical. Untouched blocks are emitted verbatim; only genuinely edited blocks are re-serialized, wrapped to the document's detected prevailing width (91 for PLAN.md). Every uncertain case falls back to re-serialization, which is always safe.
