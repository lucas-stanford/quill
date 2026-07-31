---
id: qui-aadk
status: closed
deps: [qui-mcib, qui-ws0m]
links: []
created: 2026-07-31T20:41:59Z
type: task
priority: 0
parent: qui-xbyx
tags: [agent, lane]
---
# M4/payload — revision brief builder

Assemble the structured brief sent to the agent: current markdown, unresolved comments with their anchors, the reviewer's insertions and deletions, and any freeform instruction from the update dialog.

Framing matters as much as content. Edits are presented as decisions already made; comments as instructions to apply. Resolved comments are excluded.

## Acceptance Criteria

The brief for a hand-annotated plan is complete, ordered, and contains no resolved comments.


## Notes

**2026-07-31T22:52:53Z**

Done and merged. 237 tests (55 CLI, 182 web), up from 195.

The brief is ordered by resolving each anchor against the markdown, so the agent reads comments in the order the text presents them, with orphans last. Orphans are never re-resolved — a lost note stays lost rather than being re-attached somewhere plausible.

A deletion and insertion adjacent in the document are recognised as one REPLACE rather than two unrelated events, which is what the reviewer actually did when they typed over a selection.

The rendered prompt closes the main ambiguity trap explicitly: it tells the agent it is editing a document, not doing the work the plan describes, so a note saying 'make this idempotent' rewrites the plan rather than producing code. It also demands the full document back with no preamble and no code fence, and warns that a partial document is a destroyed document.

Deliberate call: AI-authored pending changes are excluded from edits. BriefEdit has no author field, so shipping the AI's own unresolved proposals as 'decisions already made' would put words in the reviewer's mouth.

Raised a real integration problem — detached mode needs the prompt CLI-side while the formatter lives in the web package. Resolved by carrying the rendered prompt in the request so there is exactly one prompt implementation.
