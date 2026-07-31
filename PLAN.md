# Quill — a Word-like plan editor for coding agents

## Problem

Reviewing an agent's plan in a terminal is bad. Plans are prose documents, but the CLI
renders them as a wall of scrollback you cannot annotate. You cannot put a margin note on
step 4, you cannot strike a paragraph and have the agent understand why, and you cannot
hand a plan back with "this bit, not that bit" precision. The only available verbs are
approve, reject, or retype the whole thing.

Quill moves plan review into a document surface that behaves like Word on the web, while
keeping the trigger and the source of truth in the CLI.

## Shape of the thing

```
$ copilot -p "add SSO to the billing service"
  ...agent drafts a plan, then:
  → opened plan in Quill  http://localhost:7823   (waiting for review)

# or standalone
$ quill PLAN.md
$ quill --new "migrate the ingest pipeline to Kafka"
```

The agent writes `PLAN.md`, calls `quill`, and blocks. The browser opens on a clean white
page. You edit, you comment, you strike things out. You press **Update with AI**. The agent
picks up your edits and comments, rewrites the plan, and the page updates underneath you
with the changes marked. When you are happy you press **Approve** and the CLI unblocks and
starts work.

## Principles

1. **Markdown is the source of truth.** `PLAN.md` stays clean, readable and diffable. No
   database. Comments and track-changes live in a sidecar `PLAN.quill.json`, keyed to
   anchors, so the plan file is never polluted with review metadata.
2. **The CLI is the trigger, the browser is the surface.** Quill is never a place you go;
   it is a place you are sent, and it hands control straight back.
3. **Round-trip, not one-shot.** The interesting loop is edit → AI revise → review the
   revision → repeat. Everything is built around making that loop fast and legible.
4. **Boring document chrome.** It should look like Word on the web because everybody
   already knows how Word on the web works. No novel interaction design.
5. **Single command, no setup.** `npx quill` works with zero config. No accounts, no
   daemon, localhost only by default.

## Architecture

```
  copilot / any agent
        │  spawns, blocks on exit code
        ▼
  ┌─────────────────────────┐        ┌──────────────────────┐
  │  quill  (node CLI)      │        │  PLAN.md             │  ← source of truth
  │  ├─ http server         │◄──────►│  PLAN.quill.json     │  ← comments, threads
  │  ├─ ws live sync        │  watch └──────────────────────┘
  │  └─ agent bridge        │
  └───────────┬─────────────┘
              │  serves embedded SPA
              ▼
  ┌─────────────────────────┐
  │  React + Tiptap editor  │
  │  page canvas, ribbon,   │
  │  margin comments,       │
  │  tracked changes        │
  └─────────────────────────┘
```

**Agent bridge** has two modes:

- *Attached* — the agent spawned Quill. "Update with AI" writes a revision request to a
  local queue; the parent agent reads it, rewrites `PLAN.md`, and the file watcher pushes
  the new version to the browser. This is the primary path.
- *Detached* — nobody is listening, so Quill shells out to `copilot -p` itself with the
  revision prompt. This is what makes `quill PLAN.md` useful on its own.

## Editor surface

Deliberately Word-on-the-web:

- Grey canvas, white page with real margins, serif body text, page-width measure.
- Slim ribbon: styles dropdown, bold/italic, lists, headings, comment, track-changes toggle.
- Right margin holds comment bubbles, connected to their anchor by a thin leader line.
  Clicking a bubble highlights the anchored text and vice versa.
- Tracked changes: your edits and the AI's revisions both render as insertions and
  deletions with authorship colour. Accept/reject per change or all at once.
- Nothing else. No blocks, no databases, no drag handles, no slash-command menagerie.

## The revision payload

When you press **Update with AI**, Quill sends a structured brief, not a diff dump:

```json
{
  "plan": "<current markdown>",
  "comments": [
    { "anchor": "step 4: run the backfill", "body": "backfill has to be idempotent",
      "resolved": false, "author": "lucas" }
  ],
  "edits": [
    { "type": "deletion", "text": "We will pause writes during migration." },
    { "type": "insertion", "text": "Dual-write for the duration of the cutover." }
  ],
  "instruction": "<optional freeform note from the update dialog>"
}
```

The agent is told to honour edits as decisions already made and comments as instructions to
apply, then return the full revised markdown. Revisions come back as tracked changes so a
bad rewrite is one click away from being undone.

## Handoff to ferricket

Approval is not the end. A plan's job is to become work, so **Approve** offers a second
step: break the plan into `fer` tickets. Section headings become epics, numbered steps
become tasks parented to them, and explicit ordering in the plan becomes `fer dep` edges.
You land in `fer ui` with a populated board instead of an approved document nobody acts on.

## Milestones

Each one is demoable on its own. Nothing here is a layer; every milestone is a vertical
slice that makes the product more useful than it was the day before.

**M1 — Plan on a page.** `quill PLAN.md` opens a plan in the browser as a document. CLI,
localhost server, embedded SPA, Tiptap, Word chrome. Editing may be lossy; that is M2.

**M2 — Edit without drift.** Edits round-trip to markdown byte-stably, autosave, ribbon,
and the watcher pushes external changes back to the page. The round-trip is the
load-bearing correctness problem in the project.

**M3 — Annotate and mark up.** Margin comments, tracked changes, accept/reject, resilient
anchors. The reason Quill exists.

**M4 — The AI round-trip.** "Update with AI" turns your markup into a revision that arrives
as tracked changes. Closes the loop.

**M5 — Approve, hand off, ship.** Exit protocol, plan-to-ferricket breakdown, npx package.

## Non-goals

- Multiplayer / real-time collaboration. One reviewer, one plan.
- Cloud hosting, accounts, sharing links. Localhost only.
- A general-purpose document editor. It edits plans.
- Replacing the CLI's plan mode. Quill is the review surface, not the planner.

## Open questions

- Should **Approve** auto-commit `PLAN.md`, or leave it dirty for the agent?
- Do tracked changes need to survive an agent rewrite that moves a paragraph, or is
  anchor-loss acceptable with a "orphaned comment" tray?
- Is `--new` worth it, or should drafting always be the agent's job?
