---
id: qui-0ull
status: open
deps: [qui-79yv]
links: []
created: 2026-07-31T18:51:14Z
type: milestone
priority: 1
tags: [milestone]
---
# M3 — Annotate and mark up

Demo: select 'run the backfill', leave a margin comment, strike a paragraph you disagree with, and see both rendered like a marked-up Word document.

Scope: the anchor model; margin comment bubbles with leader lines, threaded replies and resolve; tracked-change marks for insertions and deletions with authorship colour; per-change accept/reject plus accept-all and next/previous navigation; and an orphan tray for comments whose anchor is lost.

All review metadata lives in the PLAN.quill.json sidecar. PLAN.md stays clean and diffable.

This is the reason Quill exists — the whole point is annotating a plan rather than approving or rejecting it wholesale.

## Design

Text-quote anchoring in the spirit of W3C annotation: exact quote plus prefix/suffix context, fuzzy re-match on load, orphan rather than silently mis-attach. Anchors must survive the AI rewording the surrounding paragraph. Deletions are struck, not removed, until accepted.

## Acceptance Criteria

A reviewer can annotate any span, thread a discussion and resolve it. PLAN.md contains zero review metadata after a full annotate cycle. A comment stays attached after its paragraph is reworded, or lands in the tray — never silently lost.

