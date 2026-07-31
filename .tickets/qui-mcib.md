---
id: qui-mcib
status: in_progress
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

