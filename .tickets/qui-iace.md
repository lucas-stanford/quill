---
id: qui-iace
status: open
deps: []
links: []
created: 2026-07-31T22:33:31Z
type: bug
priority: 3
parent: qui-0ull
tags: [editor]
---
# Task list items lose their checkbox on edit

GFM task list items (- [ ] x) have no schema node, so an edited list rebuilds them with the brackets escaped as \[ \], turning a checkbox into literal text. Content survives and untouched lists round-trip verbatim, so nothing is destroyed, but the semantics are lost the moment the user edits that list.

Agent-written plans use checklists often enough that this will be hit.

## Design

Either add a task-item schema node, or teach the serializer to recognise and preserve the checkbox prefix when rebuilding a list item.

## Acceptance Criteria

Editing a list containing task items preserves - [ ] and - [x] as checkboxes.

