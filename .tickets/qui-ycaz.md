---
id: qui-ycaz
status: closed
deps: [qui-8zqw]
links: []
created: 2026-07-31T20:36:51Z
type: task
priority: 0
parent: qui-79yv
tags: [cli, lane]
---
# M2/sync — conflict-safe writes and SSE live sync

Lane branch m2/sync. PUT /api/plan with revision checking and 409 on conflict, atomic temp-file-plus-rename writes, directory-level file watching, an SSE change stream at GET /api/live, and the useLivePlan browser half.

The subtle requirement: a write made through PUT must not produce a change event, or the browser reloads the document the user is typing into.

## Acceptance Criteria

An external edit emits a plan-changed event; an API write emits nothing; a stale revision is rejected 409 without writing.


## Notes

**2026-07-31T20:36:51Z**

Done. Echo suppression compares the current file hash against the last hash we wrote, rather than using a one-shot boolean, so rapid saves cannot wedge it. Race-safe because the assignment after await rename runs as a microtask continuation, ahead of the watcher's macrotask, with a 50ms debounce for margin. Watches the containing directory filtered by basename so atomic-rename saves from vim/VS Code/agents do not break the watch. Verified: external edit produced an event, API write produced none.
