---
id: qui-mcib
status: closed
deps: [qui-7fd0, qui-y8ew]
links: []
created: 2026-07-31T20:41:59Z
type: task
priority: 0
parent: qui-0ull
tags: [ui, review, lane]
---
# M3/comments — margin bubbles and threads

The visible reason Quill exists. Right-margin comment cards connected to their anchored text by a thin leader line. Select text to comment; clicking a bubble highlights its anchor and vice versa. Threaded replies and resolve.

Converts the page canvas into a page + comment-rail layout. M1 deliberately left .page-canvas-inner as a separate wrapper for exactly this.

## Design

Bubbles must never overlap: lay them out by preferred anchor position then push down on collision. Resolving removes a comment from the AI brief in M4.

## Acceptance Criteria

Any span can be annotated and threaded; bubbles align to their anchors without overlapping; both themes look right.


## Notes

**2026-07-31T22:28:40Z**

Done and merged. Bubbles laid out by measured anchor y, sorted in document order, pushed down on collision with a minimum 10px gap; the active thread gets a bounded pull-up. Highlighting uses ProseMirror inline decorations from the annotations lane's own plugin, so no node or mark is ever written to the document and the byte-identical round-trip is preserved. Verified: comment created with author, timestamp, quote, reply/resolve/delete, and a live anchor highlight in the text.
