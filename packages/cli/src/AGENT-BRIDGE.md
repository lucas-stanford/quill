# The Quill agent bridge

How a parent coding agent services **Update with AI**.

Quill is opened on a plan by an agent that is blocked waiting for a human review.
When the reviewer presses **Update with AI**, quill does not call a model — it
hands the review back to *you*, the agent that spawned it, as a file on disk.
This document is the whole protocol. There is no client library, no socket, no
framing: two JSON files in a directory.

The other half of this protocol lives in `revision-protocol.ts` (shapes and
validation) and `revision.ts` (behaviour). If you change one, change all three.

---

## 1. Tell quill you are listening

Attached mode is **opt-in and never inferred**. Spawn quill with:

```sh
QUILL_ATTACHED=1 quill PLAN.md --no-open --port 7823
```

or pass `--attached`. Without one of those signals quill runs **detached** and
calls the `copilot` CLI itself — which is the right behaviour for a human
running `quill PLAN.md` by hand, and the wrong behaviour for you, because a
second model would answer a review you were about to service.

Quill prints the mode it chose, and why, on startup:

```
quill  PLAN.md
  → http://127.0.0.1:7823
  → attached (QUILL_ATTACHED=1): "Update with AI" queues .quill/revision-request.json for the parent agent
```

`--attached` / `--detached` beat the environment, so a human can always override
what the parent claimed.

## 2. Watch for `.quill/revision-request.json`

Beside the plan (`PLAN.md` → `./.quill/`), quill creates:

```
.quill/revision-request.json     quill writes, you read
.quill/revision-response.json    you write, quill consumes
```

Poll for the request file, or watch the directory. It is written atomically
(temp file + `rename`), so if it exists it is complete.

```json
{
  "id": "5d2f6a1e-6f0c-4d9f-9f83-1f2a9a4c7c11",
  "planPath": "/Users/lucas/work/PLAN.md",
  "brief": {
    "markdown": "# Plan\n\n...",
    "comments": [
      {
        "quote": "ship on Friday",
        "body": "Friday is optimistic — say next sprint.",
        "author": "lucas",
        "replies": ["agreed"],
        "orphaned": false
      }
    ],
    "edits": [
      { "kind": "deletion", "text": "and a stretch goal", "context": "…the migration and a stretch goal." }
    ],
    "instruction": "Tighten section 3."
  },
  "createdAt": "2026-07-31T22:14:03.184Z",
  "prompt": "You are revising a plan document…"
}
```

This is exactly the `QueuedRevision` type in `types.ts`, plus `prompt`. Every key
shown is always present; `brief.instruction` and `edits[].context` are the only
optional ones. `comments` and `edits` are always arrays, possibly empty.

`prompt` is the same brief already rendered as English by the browser — the exact
text quill would send a model in detached mode. Use it if you drive a model
directly (`copilot -p "$(jq -r .prompt .quill/revision-request.json)"`); ignore
it and read the structured `brief` if you would rather decide for yourself. It is
additive: a parent written against `QueuedRevision` alone is unaffected.

How to read the brief:

- **`edits` are decisions the reviewer already made.** Apply them. Do not
  re-argue a struck sentence.
- **`comments` are instructions**, each attached to the text in `quote`.
  `orphaned: true` means the quoted text no longer appears verbatim — the intent
  still stands, but do not try to resurrect the quote.
- Resolved comments are already excluded. Only what is here is live.
- `markdown` is the plan as the reviewer currently sees it, including their
  edits. Revise *that*, not the file you wrote originally.

## 3. Rewrite the plan on disk

Write the revised markdown to `planPath`. That is the delivery mechanism: quill's
file watcher (M2) sees the write and pushes the new plan to the browser over the
existing SSE stream at `GET /api/live`. There is deliberately no second transport.

Write it atomically if you can (`> PLAN.md.tmp && mv PLAN.md.tmp PLAN.md`).

## 4. Say you are done

Write `.quill/revision-response.json`:

```json
{ "id": "5d2f6a1e-6f0c-4d9f-9f83-1f2a9a4c7c11", "status": "done" }
```

That is the entire completion signal. In shell:

```sh
id=$(jq -r .id .quill/revision-request.json)
printf '{"id":"%s","status":"done"}\n' "$id" > .quill/response.tmp
mv .quill/response.tmp .quill/revision-response.json
```

Fields:

| field      | required | meaning                                                                 |
|------------|----------|-------------------------------------------------------------------------|
| `id`       | yes      | Must equal the request's `id`. A reply for another id is ignored.        |
| `status`   | yes      | `working` \| `done` \| `failed` \| `cancelled`                           |
| `markdown` | no       | The revised plan. Omit it and quill reads `planPath` — which is normally what you want, since you just wrote it. |
| `error`    | no       | Shown to the reviewer when `status` is `failed`. Always set it there.    |

- **`done`** — quill reads the plan from disk (or takes your `markdown`), reports
  `status: "done"` with that text on `GET /api/revision`, and deletes both files.
  The browser applies the text as *tracked changes*, so the reviewer can reject
  the whole revision and get their document back byte-for-byte.
- **`failed`** — put a human-readable reason in `error`; it is shown in the UI.
- **`working`** — an optional heartbeat. It flips the UI from "queued" to
  "working" and **restarts the timeout**, so a slow agent that keeps saying so is
  never timed out. Send it as often as you like.
- **`cancelled`** — you decided not to service the request.

Quill deletes the response file as soon as it reads it. Renaming into place is
recommended; if quill catches a half-written file it retries once before
reporting an unreadable response.

### The HTTP alternative

If you already know quill's port (you passed `--port`), the same payload can be
PUT instead of written:

```sh
curl -sS -X PUT http://127.0.0.1:7823/api/revision \
  -H 'Content-Type: application/json' \
  -d "{\"id\":\"$id\",\"status\":\"done\"}"
```

Identical semantics. The file is the primary interface because it needs no port,
survives a restart of your poller, and works from a `Makefile`.

## 4a. Research requests

Most requests are about the plan. Some are about one section of a companion
document beside it — `research.md` — because research is an accumulation of
lines of enquiry and the reviewer wants one of them re-run, pushed further, or
replaced.

Those requests arrive on **this same channel**, with two extra fields:

```json
{
  "id": "…",
  "planPath": "/Users/lucas/work/PLAN.md",
  "target": "research",
  "scope": {
    "document": "research.md",
    "heading": "## Prior art",
    "text": "## Prior art\n\nThin. We looked at one game.\n",
    "kind": "redo",
    "mode": "replace",
    "note": "Look at at least four comparable games."
  },
  "brief": { "markdown": "…the whole research document…", "comments": [], "edits": [] },
  "prompt": "…",
  "createdAt": "…"
}
```

**`target` is absent for a plan request.** If you already implement this
protocol and never read these fields, nothing changes for you: every request you
have ever handled still says nothing about a target, and still means the plan.

When `target` is `"research"`:

| Field | |
|---|---|
| `scope.document` | the file to edit, always beside the plan |
| `scope.heading` | the section's heading, verbatim |
| `scope.text` | that section exactly as it stands right now |
| `scope.kind` | `redo` (it is unreliable, go again), `deepen` (keep it, go further), `add` (a new line of enquiry), `examples` (go and find pictures — see below) |
| `scope.mode` | `replace` that section, or `append` your answer after it as a further pass |
| `scope.note` | the reviewer's own words, when they gave any |

**Edit `scope.document`, not the plan**, and leave every other section
byte-identical — the request is targeted, and rewriting the whole file turns one
question into a diff nobody can read. Then answer exactly as you would for a
plan: write `.quill/revision-response.json` with `{ "id": …, "status": "done" }`.

Quill reads the file you edited — not the plan — and hands it back to the
browser. One request is in flight at a time regardless of target, so you will
never be asked to rewrite the plan and re-run research in the same moment.

### `kind: "examples"` — bring back pictures

This one does not edit the research document at all. Some of a design is learned
by reading and some of it only by looking, so the reviewer has asked for
screenshots of how comparable products did something. `scope.note` says what to
look for.

Write two things beside the plan:

```
research/examples/…            the images: png, jpg, webp, gif or avif
research/examples.json         one entry each
```

```json
{
  "version": 1,
  "examples": [
    {
      "id": "sts-main-menu",
      "title": "Slay the Spire — main menu",
      "source": "https://store.steampowered.com/app/646570/",
      "note": "Three buttons, no submenu. Continue is the default.",
      "image": "sts-main-menu.png",
      "tags": ["main menu"],
      "addedAt": "2026-08-05T00:00:00.000Z"
    }
  ]
}
```

**Keep the entries that are already in that file** — you are adding to a gallery,
not replacing one. Every example carries its `source`; a screenshot with no
source is a picture, not evidence, and Quill labels it as such. Then answer
`done` as usual. Quill re-reads the manifest and serves the images to its own
page; it never fetches anything itself.

## 5. Timeouts and cancellation

- A revision that is never answered fails after **5 minutes** with a message
  telling the human what to implement. Change it with `--revision-timeout 900`,
  `QUILL_REVISION_TIMEOUT=900`, or `--revision-timeout off`.
- **If `.quill/revision-request.json` disappears, stop work.** That is quill's
  cancel signal — the reviewer pressed cancel, the revision timed out, or quill
  exited. Deleting the file yourself is *not* a completion signal; quill ignores
  it and keeps waiting for a response file.
- A request file left behind by a dead quill is cleared at the next startup, so
  you will never pick up a request for a browser that is gone.

## 6. What quill will never do

- **Quill never writes the agent's output to the plan.** In attached mode *you*
  wrote the plan, which is your business. In detached mode the model's output is
  returned to the browser and applied as tracked changes, never saved. Rejecting
  every change restores the pre-revision document exactly; that is the safety
  model, and writing straight to disk would bypass it.
- Quill never puts review metadata in the plan. Comments live in
  `PLAN.quill.json`.
- Quill never runs your prompt through a shell. In detached mode the prompt is
  one element of an argv array passed to `copilot -p`, so quotes, backticks,
  `$(…)` and newlines in reviewer text are inert bytes.

## 7. Detached mode, for reference

With no parent listening, `POST /api/revision` spawns:

```
copilot -p "<the rendered prompt>"
```

stdout is the revised markdown. It is returned in `RevisionState.markdown` and
never written to disk. If `copilot` is not on `PATH`, exits non-zero, or prints
nothing, the revision fails with a specific message instead of hanging.

The prompt is rendered by the browser (`formatBriefPrompt`) and sent with the
request, so the product has exactly one prompt implementation. The CLI passes it
through verbatim and has no formatter of its own; a request without a `prompt`
is a `400`, not a prompt quill invents.

## 8. The HTTP surface

| method   | path            | result                                                              |
|----------|-----------------|---------------------------------------------------------------------|
| `POST`   | `/api/revision` | `200 RevisionState` — body `{ "brief": RevisionBrief, "prompt": string }` |
| `GET`    | `/api/revision` | `200 RevisionState`                                                  |
| `PUT`    | `/api/revision` | `200 RevisionState` — attached-mode completion signal                |
| `DELETE` | `/api/revision` | `204` — cancels, kills the child, clears the queue file              |

`POST` while a revision is in flight is refused with `409` and the current state;
one revision at a time, never two agents rewriting one plan. A missing, blank or
non-string `prompt` is refused with `400` and the offending field named.
