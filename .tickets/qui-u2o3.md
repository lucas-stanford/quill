---
id: qui-u2o3
status: closed
deps: [qui-8zqw]
links: []
created: 2026-07-31T20:36:51Z
type: task
priority: 0
parent: qui-79yv
tags: [editor, lane]
---
# M2/roundtrip — lossless markdown serializer

Lane branch m2/roundtrip. The load-bearing correctness problem of the project: markdown to ProseMirror and back, walking the document tree rather than hacking HTML. Also wires usePlanEditor's onChange and converts editor.css to consume theme tokens.

Critical invariant: onChange must never fire from a programmatic load, or App autosaves in an infinite loop and corrupts the file.

## Acceptance Criteria

serialize(parse(x)) is stable under repetition and the ASCII diagram in PLAN.md survives byte-identical.


## Notes

**2026-07-31T20:44:43Z**

Merged, but verification on main found the serializer reflows soft-wrapped paragraphs: one keystroke rewrites 75 lines. Tracked as qui-gpcw. Round-trip is idempotent after the first pass, but that first pass is exactly the problem.
