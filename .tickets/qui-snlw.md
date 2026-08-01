---
id: qui-snlw
status: in_progress
deps: []
links: []
created: 2026-07-31T20:41:59Z
type: task
priority: 1
parent: qui-7m9o
tags: [cli, lane]
---
# M5/exit — exit protocol and approve flow

How the calling agent learns what happened. Distinct outcomes for approved, cancelled and errored, plus a machine-readable summary on stdout pointing at the final plan path. Approve writes the final plan and releases the CLI.

## Acceptance Criteria

A parent process can distinguish approval from cancellation without parsing prose.

