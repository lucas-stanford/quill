---
id: qui-57aa
status: closed
deps: [qui-m1pf]
links: []
created: 2026-07-31T20:42:00Z
type: task
priority: 2
parent: qui-7m9o
tags: [release, lane]
---
# M5/package — npx packaging and README

Ship it. Bundled SPA in the published tarball, correct bin entry, no postinstall build, and a README that shows the loop in ten lines.

## Acceptance Criteria

'npx quill PLAN.md' works on a machine that has never seen the repo.


## Notes

**2026-08-01T05:09:28Z**

Done. Published name is quillmd (quill is taken on npm by the rich-text editor); the command stays quill. 264 kB tarball, 6 files, no source or tests leak. A prepack check refuses to publish without the built UI, which would install cleanly then fail on first run.

Verified by packing, installing into a clean directory outside the repo, and running the entire product loop from the installed package. Every command in the README was run before being written down.
