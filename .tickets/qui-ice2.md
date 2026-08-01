---
id: qui-ice2
status: closed
deps: [qui-aadk, qui-ycaz]
links: []
created: 2026-07-31T20:41:59Z
type: task
priority: 0
parent: qui-xbyx
tags: [agent, core, lane]
---
# M4/bridge — attached and detached agent modes

Attached mode is the primary path: Quill was spawned by an agent, so 'Update with AI' enqueues a revision request the parent picks up, rewrites PLAN.md, and the M2 watcher pushes the result back to the browser.

Detached mode is what makes 'quill PLAN.md' useful standalone: with nobody listening, Quill shells out to 'copilot -p' itself with the revision prompt.

## Design

The queue is a file in the workspace so any parent agent can poll it without a protocol library. Detached mode must degrade gracefully when the copilot CLI is absent.

## Acceptance Criteria

A full revision cycle completes in both modes; detached mode fails with a clear message when no CLI is available.


## Notes

**2026-07-31T23:17:17Z**

Done and merged, verified independently on main. 316 tests (134 CLI, 182 web).

Both security properties proven by test, not by claim:

  Command injection — sent a prompt containing "; touch PWNED; $(touch PWNED); `touch PWNED`; rm -rf ... plus a newline. It arrived at the child as a single literal argv element, no shell interpretation, zero artifacts created. Spawned with an argument array, never a shell string.

  The model's output is never written to the plan. After a full detached revision the plan file was byte-identical; the rewrite came back only in RevisionState.markdown for the browser to apply as tracked changes. Writing it to disk would bypass the entire safety model.

Attached mode verified end to end: POST writes .quill/revision-request.json carrying id, planPath, brief, createdAt and prompt; a simulated parent agent rewrote the plan and dropped a revision-response.json; Quill reported done with the new markdown and cleaned the queue directory.

Good judgement call: the lane deleted its own fallback prompt renderer rather than keeping it. A fallback is a second prompt implementation nobody maintains, and it fires exactly when something is already wrong.
