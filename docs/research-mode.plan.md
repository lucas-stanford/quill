# Research mode — editable, re-runnable research with real examples

## Problem

Research arrives once and then rots. `research.md` opens as a read-only tab, so
the only thing a reviewer can do with a thin section, a stale finding or a line
of enquiry that turned out to be irrelevant is notice it and move on. The plan
carries on being argued from evidence nobody can revise.

Three things are missing, and they are the same thing at three scales: you
cannot **re-run** a line of enquiry, you cannot **remove** one, and you cannot go
**find what other people did** — the comparable products, the competitors, and
above all the screens, which are the part of a design you learn most from seeing
rather than reading about.

## Principles

1. **Quill is the surface; the agent does the work.** Quill has no network
   design — localhost only, no auth, no egress story — and it is not going to
   grow one. Every request to go and find something leaves over the existing
   agent bridge and comes back as files on disk.
2. **One channel, one thing in flight.** `.quill/revision-request.json` already
   works and agents already implement it. Research requests are a `target` on
   that same channel, not a second protocol to poll. An agent should not be
   rewriting the plan and re-running research in the same moment anyway.
3. **Nothing is silently lost.** Orphaned comments go to a tray rather than
   vanishing; cut research does the same. Research is evidence, and evidence that
   disappears without trace is how a plan ends up justified by something nobody
   can find.
4. **Everything the agent writes arrives as tracked changes.** A bad re-run is
   one click from undone, exactly as a bad plan revision is.
5. **Do not put pictures in the markdown.** The parser deliberately has no image
   node: an image round-trips as literal `![alt](src)` text precisely because a
   construct the schema cannot model would be dropped on the next autosave.
   Screenshots therefore live beside the document, not inside it.

## Non-goals

- Quill fetching anything from the internet itself.
- An image node in the plan schema. See Principle 5.
- Research history or versioning beyond what git already gives.
- Making `reference.md` re-runnable. It is a spec you maintain, not evidence you
  gather. It becomes editable here and stops there.

## Open questions

- Where example screenshots come from: driving a real browser against live
  competitor sites, or press and store imagery. The first is far better evidence
  and the agent already has the tooling; it needs a note on what is reasonable to
  capture and keep.
- Whether the examples gallery is per-project only, or whether a machine-wide
  library is worth having later.
- Whether `## Implications for the plan` should become a recognised, structured
  section rather than a convention, so the propagation banner can diff it exactly
  rather than by matching a heading.

## M1 — DONE. Research you can edit: type into research.md and it saves, like the plan

1. Add `PUT /api/companions/:name`, mirroring the plan's revision-guarded write,
   so a companion save is conflict-safe against an agent writing the same file.
2. Replace the read-only drawer with the real editor for companions: the same
   schema, the same autosave lifecycle, no mode — the caret says you are editing,
   as it does in the plan.
3. Give each companion its own sidecar (`research.quill.json`) and point the
   comment rail at whichever document is on screen.
4. Watch companions and push external changes the way `/api/live` does for the
   plan, so an agent still writing research cannot leave a stale page open.

## M2 — DONE (bar the sidecar). Sections you can act on: Redo a thin section and watch it land

1. Parse the open companion into `##` sections and surface the section under the
   caret as the unit the verbs act on.
2. Add the section toolbar — **Redo**, **Deepen**, **Add**, **Cut** — beside the
   heading, following the floating selection toolbar's placement rules.
3. Extend the bridge request with `target: "plan" | "research"` and a `scope`
   carrying the heading and its current text. Absent `target` means `"plan"`, so
   every agent implementing today's protocol keeps working untouched.
4. Land the response as tracked changes confined to that section, and ask at
   request time whether this Redo replaces the section or appends a further pass.
5. Send Cut sections to a collapsed tray at the foot of the document, restorable,
   and never write a cut section back to the file.

## M3 — DONE. Examples you can see: ask for comparable screens and get a gallery of them

1. Define the examples manifest — `research/examples.json`, one entry per
   example: title, source URL, note, image path, tags, and when it was added.
2. Add the **Find examples** action: you describe what you are after ("main menu
   screens for deckbuilders", "how competitors price this"), it goes out over the
   bridge as `kind: "examples"`, and the agent gathers.
3. Render the gallery as its own companion surface — a grid of real screenshots,
   each with its source link, the agent's note, and Keep or Cut.
4. Let a kept example be cited into the open document, inserting a markdown link
   and the note at the caret, which round-trips as text and needs no image node.
5. Document the whole request and response shape in `AGENT-BRIDGE.md`, because
   the bridge is a contract with agents that are not this one.

## M4 — The loop closes: change the research and Quill asks about the plan

1. Track the revision of `research.md` the plan was last reconciled against.
2. Diff the implications section when research settles, and raise a quiet banner
   on the plan when they differ — never moving the page.
3. Wire the banner's action into the existing Update with AI flow, pre-seeded
   with what changed, so re-checking the plan is the same reviewed round trip as
   any other revision.
4. Carry unresolved research comments into the exit summary alongside
   `openComments`, so approving with research still open is a visible choice.
