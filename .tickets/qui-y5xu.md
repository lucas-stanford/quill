---
id: qui-y5xu
status: closed
deps: []
links: []
created: 2026-07-31T18:51:14Z
parent: qui-kbjq
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


## Notes

**2026-07-31T19:01:19Z**

M1 split into 3 parallel lanes, each in its own git worktree off the scaffold commit 9688ca4:

  m1/cli     ../quill-wt/cli     packages/cli/src/**            CLI args, port scan, localhost server, GET /api/plan
  m1/editor  ../quill-wt/editor  packages/web/src/editor/**     Tiptap + marked, prose typography
  m1/chrome  ../quill-wt/chrome  packages/web/src/shell,styles  grey field, white page, title bar, 3 states

Coordination via CONTRACT.md: frozen HTTP contract (PlanResponse), frozen component props (AppShellProps, PlanEditorProps), frozen wiring in App.tsx, and strict file ownership so the merge is conflict-free. Dependencies pre-installed and lockfile committed so no lane touches package.json.

**2026-07-31T19:22:28Z**

M1 complete. Merged m1/cli, m1/editor, m1/chrome into main with zero conflicts — the frozen contract held.

Verified end to end:
  quill --help/--version        exit 0
  missing file / dir / non-.md  clear error, exit 1
  port 7823 busy                scans to 7824
  GET /api/plan                 200, PLAN.md, 6518 bytes, sha256 revision
  GET /                         200 SPA
  path traversal raw + %2e%2e   serves index.html, never /etc/passwd
  browser at 1440 and 1024      no horizontal scroll, 0 console errors

One integration bug found and fixed post-merge (cc69756): prosemirror-view injects
.ProseMirror pre { white-space: pre-wrap } at runtime, outranking the editor lane's
rule by load order, so the ASCII diagram wrapped instead of scrolling. Invisible to
both lanes in isolation — it only appears once the editor sits inside the 816px page.
Worth remembering: parallel lanes cannot catch cross-lane CSS cascade conflicts.
