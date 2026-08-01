---
id: qui-7m9o
status: closed
deps: [qui-xbyx]
links: []
created: 2026-07-31T18:51:14Z
parent: qui-kbjq
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


## Notes

**2026-08-01T00:22:02Z**

M5 scaffold committed. Types frozen (ReviewOutcome, ReviewSummary, TicketPreview, TicketPlan), api.ts gained fetchTicketPlan and finishReview, App wires useApprove and renders ApproveButton in the title bar.

Three lanes: exit (packages/cli — POST /api/review/finish with distinct exit codes and a one-line JSON summary on stdout, plus GET /api/tickets/preview and the fer shell-out), approve (the confirm step, ticket preview, and the terminal state after the server exits), package (npx-able tarball with prebuilt web assets and the README).

Note for the exit lane: the server exits after responding to finish, so the browser's fetch may resolve as the connection dies. The approve lane has to handle that without showing a network error at the moment of success.

**2026-08-01T05:09:28Z**

M5 complete. 438 tests passing (149 CLI, 289 web).

Final verification from a clean npx install: left a comment on step 2, previewed the breakdown, approved with the ticket handoff. Result — exit code 0, one JSON line on stdout, PLAN.md byte-identical, the comment in PLAN.quill.json anchored by quote, and 7 tickets on a board with the numbered steps chained as dependencies.
