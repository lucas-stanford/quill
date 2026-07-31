---
id: qui-ws0m
status: closed
deps: [qui-u2o3]
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


## Notes

**2026-07-31T22:28:41Z**

Done and merged. Tracked changes are ProseMirror decorations in plugin state, not marks — so they cannot leak into the serialized markdown and cannot disturb the source-preserving round-trip. Deleted text stays in the document with a deletion range until accepted, so a pending deletion changes nothing on disk.

Invariant 4 proven by hash: applyRevision followed by rejectAll('ai') restored sha256 d84990b6...aee97, byte-identical, cmp reports 0 differing bytes. A one-sentence AI revision produced exactly 2 changes, not a document rewrite.

The plugin is registered at the HEAD of the plugin list — load-bearing, because appending after StarterKit's keymaps let Backspace really delete the selection and silently dropped text from the file. Caught in browser testing.
