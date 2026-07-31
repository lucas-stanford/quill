---
id: qui-7m9o
status: open
deps: [qui-xbyx]
links: []
created: 2026-07-31T18:51:14Z
type: milestone
priority: 2
tags: [milestone]
---
# M5 — Approve, hand off, ship

Demo: press Approve, watch the plan become a populated ferricket board, and the terminal picks up where it left off.

Scope: the exit protocol and agent handback contract (distinct outcomes for approved, cancelled and errored, plus a machine-readable summary pointing at the final plan); the Approve flow; plan-to-ticket breakdown where headings become epics, steps become parented tasks and stated ordering becomes fer dep edges; and packaging for npx with a README that shows the loop in ten lines.

A plan's job is to become work. Approving a document nobody acts on is not a finished feature.

## Design

Shell out to the fer CLI rather than writing .tickets files directly, so ferricket owns its own format. Bundle the built SPA in the published tarball — no postinstall build step. A parent process must be able to distinguish approval from cancellation without parsing prose.

## Acceptance Criteria

'npx quill PLAN.md' works on a machine that has never seen the repo. Approving hands control back to the terminal and optionally lands the user on a fer board with correct parents and dependencies.

