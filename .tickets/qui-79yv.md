---
id: qui-79yv
status: closed
deps: [qui-y5xu]
links: []
created: 2026-07-31T18:51:14Z
parent: qui-kbjq
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


## Notes

**2026-07-31T20:35:26Z**

M2 in progress. Scaffold committed (App owns the save lifecycle; conflict-safe PUT + SSE contract; dark-mode token system with dark as default). Split into 3 parallel lanes in worktrees off the scaffold commit:

  m2/roundtrip  packages/web/src/{editor,markdown}   lossless markdown serializer  [running]
  m2/ribbon     packages/web/src/{shell,styles}      ribbon, save states, themes   [done]
  m2/sync       packages/cli/src, web/src/live       PUT 409 + SSE watcher         [done]

Decision: SSE instead of WebSockets for live sync. Traffic is one-directional, EventSource
reconnects natively, and it needs no dependency and no RFC 6455 framing. PLAN.md's diagram
still says 'ws live sync' — worth updating when the plan is next revised.

Decision: dark mode is now the default theme (user request). Coordinated across lanes via a
20-token CSS custom property contract in CONTRACT.md: the ribbon lane defines values for both
themes, every other lane consumes var(--token) and hardcodes no colour. index.html sets
data-theme before first paint so there is no flash.
