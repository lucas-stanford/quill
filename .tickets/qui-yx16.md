---
id: qui-yx16
status: closed
deps: [qui-8zqw]
links: []
created: 2026-07-31T20:36:51Z
type: task
priority: 0
parent: qui-y5xu
tags: [ui, lane]
---
# M1/chrome — Word-like page chrome

Lane branch m1/chrome. Grey canvas, centred 816px white page with 96px margins, soft elevation, slim title bar with inline-SVG nib mark, and designed loading/ready/error states.

## Acceptance Criteria

A screenshot reads as a word processor, not a markdown preview.


## Notes

**2026-07-31T20:36:51Z**

Verified at 1440px and 1024px with no horizontal scroll and zero console errors. Left .page-canvas-inner as a separate wrapper so M3 can convert it to a page + comment-rail grid without touching page styles.
