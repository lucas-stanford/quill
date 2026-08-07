# Quill

Reviewing a coding agent's plan in a terminal is bad. Plans are prose documents, but the CLI
renders them as a wall of scrollback you cannot annotate. You cannot put a margin note on
step 4, you cannot strike a paragraph and have the agent understand why, and you cannot hand
a plan back with "this bit, not that bit" precision. The only verbs are approve, reject, or
retype the whole thing.

Quill moves plan review into a document that behaves like Word on the web, while the trigger
and the source of truth stay in the CLI.

## The loop

```bash
quill PLAN.md          # opens the plan in your browser, blocks until you are done
```

1. The plan opens as a page — grey field, white sheet, real margins, dark by default.
2. Select a phrase; a **Comment** button appears beside it. Leave a margin note.
3. Click into the text and strike a paragraph you disagree with. There is no edit mode to
   turn on — the formatting ribbon follows your caret and leaves when it does.
4. For anything the plan gets wrong as a whole, use **Feedback on the plan** in the left
   margin. Not every objection has a sentence to hang on. Enter adds a note, so two
   objections stay two notes and the agent has to answer both.
5. Press **Update with AI**. Your comments, edits and feedback become a brief, the agent
   rewrites the plan, and the rewrite comes back as **tracked changes** — accept or reject
   each one. An agent that reports its progress is watched live: the status pill says what
   it is doing, each note closes as it is dealt with rather than all at once at the end, and
   a plan it sends mid-flight lands as tracked changes straight away. It is never timed out
   while it is talking. Reopen any note you disagree with.
6. Press **Approve**. The CLI exits, optionally turning the plan into a ticket board first.

Anything that changes the document can be taken back with **⌘Z / Ctrl+Z**, from wherever the
focus happens to be — the replacements worth undoing are made from controls outside the page.
A change the *agent* made to the file on disk is not yours to undo, and is not offered.

`PLAN.md` stays clean markdown the whole time. Comments, threads and your general feedback
live in a `PLAN.quill.json` sidecar, so the plan file is never polluted with review metadata
and every `git diff` stays readable. Editing one sentence changes one line.

## Install

```bash
npx quillmd PLAN.md
# or
npm install -g quillmd && quill PLAN.md
```

Requires Node 20+. The published package ships the built UI, so there is no build step on
install.

## Usage

```
quill [file] [options]

  file                    Path to the markdown plan (default: PLAN.md)

  --port <n>              Port to listen on (default: 7823, scans upward if taken)
  --no-open               Print the URL instead of opening a browser
  --attached              Revisions are serviced by the agent that spawned quill
  --detached              Revisions are serviced by running `copilot` here
  --revision-timeout <s>  Seconds before an unanswered revision fails
  --help, --version
```

The server binds to `127.0.0.1` only and has no authentication. It is a single-user local
tool by design.

## Driving it from an agent

Quill is built to be spawned by a coding agent that then blocks on it.

### Exit protocol

On exit, Quill writes **one line of JSON** to stdout. Everything human-readable goes to
stderr, so stdout can be parsed directly.

```bash
summary=$(quill PLAN.md --no-open)
case $? in
  0)  echo "approved: $(echo "$summary" | jq -r .planPath)" ;;
  10) echo "cancelled — nothing to do" ;;
  11) echo "errored: $(echo "$summary" | jq -r .error)" ;;
esac
```

| Code | Outcome | |
|---|---|---|
| `0` | `approved` | the reviewer approved the plan |
| `10` | `cancelled` | ended without approval, including Ctrl-C |
| `11` | `errored` | the review could not be completed |
| `1` | — | startup failure: bad arguments, missing file, no free port |

The summary carries `outcome`, `planPath`, `revision` (sha256 of the final plan),
`openComments`, and `tickets` when a board was created.

### Attached mode

With `--attached` (or `QUILL_ATTACHED=1`), **Update with AI** does not call a model. It
writes a request beside the plan and waits for the parent agent to service it:

```
.quill/revision-request.json    { id, planPath, brief, prompt, createdAt }
```

The parent rewrites `PLAN.md` on disk and drops a response:

```
.quill/revision-response.json   { id, status: "done" }
```

Quill's file watcher pushes the new plan into the browser, where it lands as tracked
changes. `brief` is the structured markup (comments, edits, instruction); `prompt` is the
same thing already rendered as instructions, so a shell-scripted agent can use it directly:

```bash
copilot -p "$(jq -r .prompt .quill/revision-request.json)" > PLAN.md
echo "{\"id\":\"$(jq -r .id .quill/revision-request.json)\",\"status\":\"done\"}" \
  > .quill/revision-response.json
```

### Detached mode

The default. Quill runs `copilot -p <prompt>` itself, spawned with an argument array rather
than a shell string. The model's output is **never written to your plan** — it returns to
the browser as tracked changes, so a bad rewrite is one click from being undone.

## Naming

Naming is review, so it is asked for in the review round. Tick **Ask for name candidates**
in the Update-with-AI dialog and the agent brings back eight to twelve, each with a line on
why it works, alongside the revision — they appear at the end of the comments, with the rest
of the annotations.

A poll renames **what it was about**. Leave the field blank for the project and picking a
candidate rewrites the document's `# H1` and nothing else; type a placeholder — a character,
a town, a faction — and it replaces every whole-word mention of it in the plan. Steer it if
you already know what you want ("one word, weird west, no compound words").

Rounds accumulate rather than replace: what you dropped is listed back to the agent so the
next round cannot offer it again, and the steering that produced each round stays with it.
Candidates live in `research/options.json`. Taking one is an ordinary edit — ⌘Z takes it
back.

## Companion documents

A plan is an argument, and an argument is only reviewable next to its evidence. If a
`research.md` or a `reference.md` sits beside the plan, Quill offers it as a button in the
title bar and opens it as a read-only reading pane over the document.

Research is not only readable, it is **workable**. The drawer lists the document's `##`
sections — its lines of enquiry — and each one can be:

| | |
|---|---|
| **Redo** | it is thin, stale or wrong; go and find out again |
| **Deepen** | keep it, and answer one more question |
| **Add** | open a new line of enquiry |
| **Cut** | take it out — recoverable from a tray, because research is evidence |

Redo and Deepen ask whether the answer should replace the section or arrive as a further
pass, then go out over the same agent bridge as **Update with AI** (see `AGENT-BRIDGE.md`,
§4a). One request is in flight at a time regardless of which document it is about. When the
answer lands, **Undo the re-run** puts the document back exactly as it was.

There is also **Find examples**. Some of a design is learned by reading and some of it only
by looking, so you can ask for screenshots of how comparable products did something. They
arrive in a **sidebar beside the document** rather than behind a tab — the pictures are the
evidence for what the words claim, so you want them in view while you read. Click one for
the full image and its source; **Cite** puts a markdown link in the section you are reading
without leaving it. The picture stays out of the document, because the schema has no image
node on purpose.

You can also just type in it: companions autosave, and a write is refused if the agent
changed the file underneath you rather than clobbering whichever side raced slower.

When the research's **implications** change — the section the milestones were argued from —
the plan says so, in a line pinned over the canvas that never moves the page: *"research.md
now says something different."* Re-check the plan and it becomes an ordinary revision with
the reason attached; or say it still holds and the mark moves on. Only the implications are
watched, so correcting a citation is not a reason to be told the plan is stale.

Opening a companion never touches the plan — the editor underneath keeps its pending
tracked changes and comment anchors, so a glance at the research costs nothing. `Esc` or a
click outside closes it.

## Handoff to ferricket

A plan's job is to become work. If [ferricket](https://github.com/prabirshrestha/ferricket)
is installed, approving can break the plan into tickets: headings become epics, the steps
beneath them become tasks, and numbered steps get dependency edges — numbered steps are
sequential, bullets are not, so bullets are left unordered rather than inventing an order
the author never wrote.

```
## Migrate the datastore        →  epic
1. Snapshot the tables.         →  task
2. Backfill the new schema.     →  task, depends on the snapshot
3. Cut reads over.              →  task, depends on the backfill
```

The handoff is optional. A missing `fer` is reported, never fatal.

## What is where

| Path | |
|---|---|
| `PLAN.md` | your plan — clean, diffable markdown, the source of truth |
| `PLAN.quill.json` | comments and threads (anchored by quoted text), plus your feedback notes |
| `research.md`, `reference.md` | optional companions — read-only tabs beside the plan |
| `research/examples.json` | the examples gallery — screenshots and their sources |
| `research/options.json` | candidate names, round by round |
| `.quill/` | transient revision request/response, attached mode only |

Comments are anchored by the text they quote plus surrounding context, never by offsets, so
they survive the agent rewording the paragraph around them. When an anchor genuinely cannot
be found, the comment is orphaned into a tray rather than silently re-attached to the wrong
sentence.

## Development

```bash
pnpm install
pnpm build          # web bundle, then the CLI that embeds it
pnpm test           # 614 tests
pnpm typecheck
```

`packages/cli` is the Node CLI and server; `packages/web` is the React editor, whose build
output is embedded into the CLI package.
