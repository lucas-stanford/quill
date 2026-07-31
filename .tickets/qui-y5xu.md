---
id: qui-y5xu
status: in_progress
deps: []
links: []
created: 2026-07-31T18:51:14Z
type: milestone
priority: 0
tags: [milestone]
---
# M1 — Plan on a page

Demo: run 'quill PLAN.md' and a plan appears in the browser as a document, not a terminal dump.

Scope: the quill CLI (file arg, --port, --no-open, free-port scan, browser launch); a localhost-bound HTTP server serving an embedded React SPA; a Tiptap editor rendering the plan; and the Word-on-the-web chrome — grey field, centred white page, real margins, serif body, constrained measure, page shadow.

This milestone is about the surface existing at all. Editing can be lossy here; making it faithful is M2.

## Design

pnpm workspace. tsup for the CLI, Vite for the app, SPA build output embedded in the CLI package so there is no separate serve step. Refuse non-loopback binds without an explicit opt-in flag.

## Acceptance Criteria

'quill PLAN.md' on a clean checkout opens a browser showing the plan as a page-like document. A screenshot reads as a word processor, not a markdown preview.

