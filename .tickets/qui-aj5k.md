---
id: qui-aj5k
status: closed
deps: [qui-aadk, qui-ws0m]
links: []
created: 2026-07-31T20:41:59Z
type: task
priority: 0
parent: qui-xbyx
tags: [ui, editor, agent, lane]
---
# M4/revision-ui — Update with AI and diff rendering

The button, the optional instruction dialog, a clear in-flight state, and cancellation. The editor stays readable while a revision is in flight.

Then the part that makes revisions reviewable rather than terrifying: diff the returned markdown against the pre-revision document and apply it as AI-authored tracked changes, instead of replacing the document wholesale.

## Design

Semantic word-level diff over the ProseMirror document. A moved paragraph must not read as a total rewrite, or every revision looks catastrophic and the reviewer stops reading them.

## Acceptance Criteria

A one-sentence AI change produces one tracked change, not a whole-document replacement; the reviewer always knows whether the AI is working, done or failed, and can cancel.


## Notes

**2026-08-01T00:18:48Z**

Done and merged. 416 tests (134 CLI, 282 web).

The toolbar-follows-editing requirement is implemented as a pure focus policy tested against two whole subtrees, the page sheet and the ribbon slot, so movement WITHIN the editing chrome is not a signal at all. Show is instant, hide is debounced 240ms, and any arrival cancels a pending hide. Entering edit mode adopts existing focus rather than assuming the document has it, so clicking Edit does not flash the ribbon.

Verified with per-frame requestAnimationFrame sampling rather than before/after snapshots: across fresh load, click into text, selection drag, clicking the floating Comment button, applying Bold, and three rapid text-to-rail round trips, the page sheet, paragraph, rail, scrollTop and scrollY were each a SINGLE value across every frame. Zero flips during the rapid sequence.

Attached-mode double-apply is prevented by applying exactly once per run id; a later SSE reload of the same markdown is a no-op. The revision only ever enters through tracking.applyRevision, never as plain content.

A full park of the review bar pushed past the viewport and created a root scrollbar worth 15px of shift; it parks at translateY(12px) instead.
