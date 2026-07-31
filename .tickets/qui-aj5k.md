---
id: qui-aj5k
status: in_progress
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

