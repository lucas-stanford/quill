---
id: qui-m1pf
status: open
deps: []
links: []
created: 2026-07-31T20:42:00Z
type: chore
priority: 2
tags: [release, quality]
---
# No automated test or lint gate

The repo has no test runner and no linter. Every milestone so far has been verified by hand with curl and Playwright, which does not scale and will not catch regressions once the markdown serializer, anchor re-matching and diff logic are all interacting.

The markdown round-trip in particular is exactly the kind of pure function that should be property-tested against a corpus of real plans.

## Design

Adding a runner is a dependency change, so it must land in a scaffold commit rather than a parallel lane.

## Acceptance Criteria

Round-trip fidelity and anchor re-matching are covered by automated checks runnable with a single command.

