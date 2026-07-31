---
id: qui-y8ew
status: in_progress
deps: []
links: []
created: 2026-07-31T21:32:47Z
type: feature
priority: 1
parent: qui-0ull
tags: [ui, lane]
---
# Ribbon should only appear in edit mode

The ribbon is formatting chrome. It should not be visible while the user is annotating or leaving comments — reviewing a plan and formatting a plan are different activities, and showing bold/italic while someone is writing a margin note is noise.

Introduce an explicit mode. In edit mode the ribbon is present; in review mode (commenting/annotating) it is not.

Motion requirement: the ribbon slides out when edit mode is selected and slides back up when it is not, and doing so MUST NOT move the rest of the UI. The page must not jump or reflow as the ribbon appears and disappears — reserve its space, or overlay it, so the document stays put.

## Design

Mode lives in App as EditorMode = 'edit' | 'review' and is passed to AppShell. Animate transform, not height or display, so the transition is compositor-driven and the canvas geometry never changes. Respect prefers-reduced-motion.

## Acceptance Criteria

Switching modes slides the ribbon in and out with zero movement of the page or document text; the ribbon is absent in review mode.

