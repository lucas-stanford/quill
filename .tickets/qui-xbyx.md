---
id: qui-xbyx
status: open
deps: [qui-0ull]
links: []
created: 2026-07-31T18:51:14Z
parent: qui-kbjq
type: milestone
priority: 1
tags: [milestone]
---
# M4 — The AI round-trip

Demo: press 'Update with AI' and the plan rewrites itself around your comments and edits, arriving as tracked changes you can accept or reject.

Scope: the revision payload builder (current markdown, unresolved comments with anchors, your insertions and deletions, optional freeform instruction); attached mode where the parent agent picks up a queued revision request; detached mode where Quill shells out to 'copilot -p' itself; the Update button with in-flight state and cancellation; and rendering the returned plan as AI-authored tracked changes rather than a wholesale replacement.

Edits are framed to the agent as decisions already made. Comments are framed as instructions to apply.

This closes the loop. Everything before it is a nicer way to read a plan; this is what makes it a way to change one.

## Design

Semantic word-level diff over the ProseMirror doc so a moved paragraph does not read as a total rewrite. Attached mode is the primary path — the parent agent rewrites PLAN.md on disk and the M2 watcher pushes it back. Detached mode is what makes 'quill PLAN.md' useful standalone.

## Acceptance Criteria

A one-sentence AI change produces one tracked change, not a whole-document replacement. Rejecting every AI change restores the pre-revision plan exactly. A full revision cycle works in both attached and detached modes, and the reviewer always knows whether the AI is working, done or failed.

