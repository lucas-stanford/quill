---
id: qui-8zqw
status: closed
deps: []
links: []
created: 2026-07-31T20:36:51Z
type: task
priority: 0
parent: qui-y5xu
tags: [cli, lane]
---
# M1/cli — CLI and localhost server

Lane branch m1/cli. Argument parsing via node:util parseArgs, free-port scanning by real listen() attempts, 127.0.0.1-only HTTP server, static SPA serving with a path-traversal guard, and GET /api/plan returning markdown plus a sha256 revision.

## Acceptance Criteria

quill PLAN.md serves the SPA and the plan API; bad input exits non-zero with a clear message.


## Notes

**2026-07-31T20:36:51Z**

Verified: --help/--version exit 0; missing file, directory and non-.md all exit 1 with clear errors; port 7823 busy scans to 7824; GET /api/plan 200; traversal raw and %2e%2e-encoded both serve index.html, never /etc/passwd.
