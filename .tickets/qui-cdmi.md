---
id: qui-cdmi
status: closed
deps: []
links: []
created: 2026-07-31T20:35:47Z
type: chore
priority: 3
tags: [docs]
---
# PLAN.md architecture diagram still says 'ws live sync'

M2 implements live sync with Server-Sent Events, not WebSockets. The ASCII diagram in PLAN.md still shows 'ws live sync'. Update it when the plan is next revised so the spec matches the build.

## Acceptance Criteria

PLAN.md describes the transport actually in use.


## Notes

**2026-07-31T21:36:09Z**

PLAN.md diagram now reads 'sse live sync'.
