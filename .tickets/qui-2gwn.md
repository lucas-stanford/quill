---
id: qui-2gwn
status: in_progress
deps: []
links: []
created: 2026-07-31T20:35:47Z
type: bug
priority: 2
tags: [editor]
---
# Markdown tables lose their layout

StarterKit ships no table schema node, so marked's GFM <table> output is dropped by Tiptap's DOM parser. Cell text may survive inline; the table structure does not. No crash.

Found during M1 verification. Not an issue for PLAN.md today, but real plans use tables and silently destroying one on load would corrupt a user's document the moment autosave writes it back — which M2 makes live.

## Design

Add @tiptap/extension-table (plus row/cell/header). Requires a dependency change, so it must happen in a scaffold commit, not inside a parallel lane. The markdown serializer must also learn to emit GFM table syntax.

## Acceptance Criteria

A plan containing a GFM table loads, renders as a table, survives a round-trip byte-stable, and is not corrupted by autosave.

