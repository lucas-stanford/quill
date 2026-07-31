---
id: qui-7fd0
status: closed
deps: []
links: []
created: 2026-07-31T20:41:59Z
type: task
priority: 0
parent: qui-0ull
tags: [core, review, lane]
---
# M3/anchors — anchor model and sidecar store

The foundation the rest of M3 stands on. Review metadata lives in a versioned PLAN.quill.json sidecar keyed by anchors, so PLAN.md itself stays clean and diffable.

Anchors must survive the AI rewording the paragraph around them, which rules out storing offsets. Store the exact quote plus a window of prefix/suffix context and re-anchor by fuzzy match on load. When re-anchoring fails, orphan the comment rather than silently attaching it to the wrong text — a mis-attached comment is worse than a lost one.

## Design

Text-quote anchoring in the spirit of the W3C annotation model: exact quote, context window, fuzzy fallback, then orphan. Sidecar schema is versioned and its absence degrades to a plain markdown editor rather than erroring. Server gets GET/PUT for the sidecar alongside the plan.

## Acceptance Criteria

A comment stays attached after its paragraph is reworded, orphans rather than mis-attaching when it cannot, and PLAN.md contains zero review metadata after a full annotate cycle.


## Notes

**2026-07-31T22:28:40Z**

Done and merged, verified on main. Anchors are quote plus ~48 chars of prefix/suffix, never offsets. Resolution: exact occurrence, then context-scored disambiguation for repeated quotes with a tie orphaning rather than guessing, then banded fuzzy Levenshtein accepted only at >=0.80 similarity. That threshold is deliberately stricter than the ~0.75 typical of text-quote libraries because a mis-attached comment is worse than a lost one. Verified end to end: commenting leaves PLAN.md byte-identical and writes everything to the sidecar.
