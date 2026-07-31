---
id: qui-ice2
status: open
deps: [qui-aadk, qui-ycaz]
links: []
created: 2026-07-31T20:41:59Z
type: task
priority: 0
parent: qui-xbyx
tags: [agent, core, lane]
---
# M4/bridge — attached and detached agent modes

Attached mode is the primary path: Quill was spawned by an agent, so 'Update with AI' enqueues a revision request the parent picks up, rewrites PLAN.md, and the M2 watcher pushes the result back to the browser.

Detached mode is what makes 'quill PLAN.md' useful standalone: with nobody listening, Quill shells out to 'copilot -p' itself with the revision prompt.

## Design

The queue is a file in the workspace so any parent agent can poll it without a protocol library. Detached mode must degrade gracefully when the copilot CLI is absent.

## Acceptance Criteria

A full revision cycle completes in both modes; detached mode fails with a clear message when no CLI is available.

