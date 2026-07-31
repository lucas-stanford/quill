---
id: qui-aadk
status: open
deps: [qui-mcib, qui-ws0m]
links: []
created: 2026-07-31T20:41:59Z
type: task
priority: 0
parent: qui-xbyx
tags: [agent, lane]
---
# M4/payload — revision brief builder

Assemble the structured brief sent to the agent: current markdown, unresolved comments with their anchors, the reviewer's insertions and deletions, and any freeform instruction from the update dialog.

Framing matters as much as content. Edits are presented as decisions already made; comments as instructions to apply. Resolved comments are excluded.

## Acceptance Criteria

The brief for a hand-annotated plan is complete, ordered, and contains no resolved comments.

