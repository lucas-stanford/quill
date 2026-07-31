---
id: qui-ws0m
status: open
deps: []
links: []
created: 2026-07-31T20:41:59Z
type: task
priority: 0
parent: qui-0ull
tags: [editor, review, lane]
---
# M3/track — tracked changes and accept/reject

Insertions and deletions rendered as marks with per-author colour, for both the human reviewer and the AI. Deletions are struck through, not removed, until accepted.

Per-change accept/reject from a hover affordance, plus accept-all, reject-all, and next/previous navigation. Rejecting every change must restore the document exactly — this is what makes a bad AI rewrite safe to undo, so it is the load-bearing guarantee of M4.

## Acceptance Criteria

Human and AI changes are visually distinguishable and individually reversible; rejecting all AI changes restores the pre-revision document exactly.

