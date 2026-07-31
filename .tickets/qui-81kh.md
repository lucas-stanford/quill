---
id: qui-81kh
status: closed
deps: [qui-r1t9]
links: []
created: 2026-07-31T20:44:43Z
type: bug
priority: 2
parent: qui-r1t9
tags: [ui, lane]
---
# Ribbon shows a wrong active state before first click

On first paint the Bulleted list button reports aria-pressed=true and renders active, with the caret at the top of a document that starts with a heading. Clicking anywhere corrects it.

The document is loaded programmatically with emitUpdate:false, so the selection-state selector never recomputes after the real content arrives and keeps the state derived from the initial empty document.

## Acceptance Criteria

Ribbon state is correct on first paint, before any user interaction.


## Notes

**2026-07-31T21:36:09Z**

Fixed. Root cause was not a stale subscription: setContent maps the outgoing selection through a whole-document replacement, so the caret from the empty initial document lands at the END of the loaded one. PLAN.md ends with a bulleted list, so the ribbon was faithfully describing a caret nobody placed. Fixed by gating on a caret the user actually owns and deriving state at render time rather than caching it.
