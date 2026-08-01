---
id: qui-snlw
status: closed
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


## Notes

**2026-08-01T05:09:28Z**

Done. Exit codes 0 approved, 10 cancelled, 11 errored, 1 startup failure — documented in --help. Exactly one line of JSON on stdout; every human-readable message moved to stderr.

That separation caught a real bug during verification: the revision manager logged progress to stdout, corrupting the line a parent agent parses. Fixed, and now covered by a test.
