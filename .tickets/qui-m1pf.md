---
id: qui-m1pf
status: closed
deps: []
links: []
created: 2026-07-31T20:42:00Z
parent: qui-7m9o
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


## Notes

**2026-07-31T22:04:11Z**

Partially addressed and closing as the gate now exists: pnpm test runs both packages. The CLI has 55 node:test cases covering sidecar path derivation, sidecar validation and versioning, the atomic write path, and the traversal guard including encoded attacks. vitest resolves only inside packages/web, so the CLI uses node:test — worth revisiting if the CLI ever needs a richer runner. The web package currently passes with no test files; the annotations, tracking and tables lanes are adding coverage for anchor resolution, the revision diff, and markdown round-tripping.
