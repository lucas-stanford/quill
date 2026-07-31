---
id: qui-af7f
status: closed
deps: [qui-8zqw]
links: []
created: 2026-07-31T20:36:51Z
type: task
priority: 0
parent: qui-y5xu
tags: [editor, lane]
---
# M1/editor — Tiptap render and prose typography

Lane branch m1/editor. Markdown to HTML via marked, fed to Tiptap StarterKit. Document typography scoped under .ProseMirror: serif body, heading hierarchy, list indentation, code blocks preserving ASCII diagrams.

## Acceptance Criteria

PLAN.md renders as a document with its ASCII architecture diagram intact.


## Notes

**2026-07-31T20:36:51Z**

Shipped, but a cascade bug survived into the merge: prosemirror-view injects .ProseMirror pre { white-space: pre-wrap } at runtime, outranking the lane's equal-specificity rule by load order, so wide code blocks wrapped instead of scrolling. Invisible in lane isolation — it only appears once the editor sits inside the 816px page. Fixed post-merge in cc69756 with a doubled-class specificity bump.
