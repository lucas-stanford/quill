---
id: qui-81kh
status: open
deps: []
links: []
created: 2026-07-31T20:44:43Z
type: bug
priority: 2
parent: qui-79yv
tags: [ui, lane]
---
# Ribbon shows a wrong active state before first click

On first paint the Bulleted list button reports aria-pressed=true and renders active, with the caret at the top of a document that starts with a heading. Clicking anywhere corrects it.

The document is loaded programmatically with emitUpdate:false, so the selection-state selector never recomputes after the real content arrives and keeps the state derived from the initial empty document.

## Acceptance Criteria

Ribbon state is correct on first paint, before any user interaction.

