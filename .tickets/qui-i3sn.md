---
id: qui-i3sn
status: closed
deps: [qui-7fd0]
links: []
created: 2026-07-31T20:41:59Z
type: task
priority: 3
parent: qui-0ull
tags: [ui, review, lane]
---
# M3/orphans — orphaned comment tray

When re-anchoring fails the comment goes to a tray with its original quote, so it can be re-attached or dismissed. No comment is ever silently lost by a rewrite.

## Acceptance Criteria

A comment whose anchor is destroyed appears in the tray with its quote intact.


## Notes

**2026-07-31T22:28:41Z**

Done and merged. Verified by rewriting a commented line on disk: the comment left the margin, did NOT re-attach elsewhere, and landed in the tray with its quote and orphaned:true persisted, while sibling comments stayed anchored. Re-attach from the tray restores it.
