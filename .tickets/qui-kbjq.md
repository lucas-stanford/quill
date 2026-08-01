---
id: qui-kbjq
status: closed
deps: []
links: []
created: 2026-07-31T22:05:18Z
type: epic
priority: 0
tags: [release]
---
# Quill 1.0 — a Word-like plan reviewer for coding agents

Reviewing an agent's plan in a terminal is bad: you cannot annotate it, so the only verbs are approve, reject, or retype. Quill moves plan review into a document surface that behaves like Word on the web, while the trigger and the source of truth stay in the CLI.

Five milestones, each a vertical slice that is demoable on its own:
  M1  the plan appears in the browser as a document
  M2  edits round-trip to disk without drift, both directions
  M3  the plan can be annotated and marked up
  M4  the markup becomes an AI revision, delivered as tracked changes
  M5  an approved plan becomes work, and the thing ships

Everything below this epic ladders up to shipping npx quill.

## Acceptance Criteria

npx quill PLAN.md works on a clean machine, and the full loop — review, annotate, revise with AI, approve, break into tickets — works end to end.


## Notes

**2026-08-01T05:09:28Z**

Shipped. Five milestones, 438 tests, npx quillmd works on a clean machine.

The loop works end to end: an agent writes PLAN.md and runs quill; the reviewer annotates and marks up a Word-like page; Update with AI turns that markup into a revision delivered as tracked changes; Approve releases the CLI and optionally turns the plan into a ferricket board.
