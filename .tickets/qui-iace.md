---
id: qui-iace
status: closed
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


## Notes

**2026-08-02T00:43:31Z**

Fixed and verified through a real save. A plan whose checklist item is edited now keeps every checkbox and changes exactly one line.

Root cause was not just escaping: marked returns the checkbox as its own leading text token, so a rebuilt item became two paragraphs with the marker stranded on its own line — a tight item silently turned loose. The checkbox is now merged into the item's paragraph on parse, and only the leading marker is left unescaped on serialize, so ordinary bracketed prose still escapes.

8 regression tests, including nested task items, ordered task items, and the two negative cases (bracketed prose, brackets mid-item).
