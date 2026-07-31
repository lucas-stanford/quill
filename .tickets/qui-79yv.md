---
id: qui-79yv
status: open
deps: [qui-y5xu]
links: []
created: 2026-07-31T18:51:14Z
type: milestone
priority: 0
tags: [milestone]
---
# M2 — Edit without drift

Demo: edit in the browser and PLAN.md updates; edit PLAN.md in your editor and the browser updates underneath you.

Scope: lossless markdown round-trip (markdown to ProseMirror to markdown, byte-stable for untouched content); the slim ribbon (styles, bold/italic, lists, headings) with keyboard equivalents; debounced autosave with a quiet saved/saving indicator; and a file watcher pushing external changes over a websocket.

The round-trip is the load-bearing correctness problem in the whole project. If a plan loses its ASCII diagrams or mangles a code fence, nothing built on top matters.

## Design

Property-test the round-trip over a corpus of real agent plans: nested lists, fenced code, tables, ASCII diagrams. Tag Quill's own writes so the watcher does not echo them back and clobber in-flight local edits. Debounce both directions.

## Acceptance Criteria

Loading and saving an untouched plan produces a zero-line diff including code fences and diagrams. An external write to PLAN.md appears in the browser within a second without destroying unsaved local edits.

