---
id: qui-r1t9
status: closed
deps: [qui-af7f]
links: []
created: 2026-07-31T20:36:51Z
type: task
priority: 0
parent: qui-79yv
tags: [ui, lane]
---
# M2/ribbon — ribbon, save states, dark mode

Lane branch m2/ribbon. Slim Word-like ribbon (styles dropdown, bold/italic/code, lists, quote, code block) staying live with the selection, human save-state copy, a theme toggle, and the full two-theme design-token system with dark as the default.

## Acceptance Criteria

Ribbon reflects caret state, both themes are first-class, dark is what a first-time user sees.


## Notes

**2026-07-31T20:36:51Z**

Done. All 20 contract tokens defined for both themes. Selection sync via useEditorState so active states track the caret. Dark: canvas #17171a with a lifted #232326 page and #e6e6e6 body text (~11.7:1) — page elevation carried by a 1px border rather than a shadow, since shadows barely read on dark. stale and conflict got genuinely informative copy rather than one-word labels.
