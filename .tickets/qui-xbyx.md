---
id: qui-xbyx
status: closed
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


## Notes

**2026-07-31T22:35:04Z**

M4 scaffold committed. Revision types frozen (RevisionBrief, BriefComment, BriefEdit, RevisionState, QueuedRevision), api.ts gained requestRevision/fetchRevision/cancelRevision, App wires useRevision and renders UpdateWithAI in the title bar.

Three lanes: payload (buildBrief), bridge (packages/cli — attached queue file plus detached copilot -p), revision-ui (the button, in-flight state, and applying the result as tracked changes via the API tracking already exposes).

Attached mode deliberately reuses the M2 file watcher: the parent agent rewrites PLAN.md on disk and the existing SSE stream pushes it back, so no new transport is needed.

**2026-08-01T00:18:48Z**

M4 complete. Four lanes merged with zero conflicts (payload, bridge, revision-ui, plus the floating selection toolbar). 416 tests passing.

Full round trip verified end to end on main against a fake copilot shim: plan loaded, comment persisted to the sidecar, revision requested in detached mode, agent returned a rewritten plan containing its edit — and the plan on disk was byte-identical afterwards. The rewrite is held in RevisionState for the browser to apply as tracked changes, which is the entire safety model.

Command injection is closed: a prompt containing quotes, semicolons, backticks and command substitution reached the child as one literal argv element and created no artifacts.

Fixed post-merge: a save conflict was a dead end, which in attached mode is routine rather than exceptional — the agent rewrites the plan on disk while its revision is being reviewed as tracked changes. App now rebases onto the server revision and retries once, so the reviewer's accept/reject decisions cannot be stranded in a tab that can no longer save.
