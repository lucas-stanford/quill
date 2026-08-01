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
3. Switch to **Edit** and strike a paragraph you disagree with.
4. Press **Update with AI**. Your comments and edits become a brief, the agent rewrites the
   plan, and the rewrite comes back as **tracked changes** — accept or reject each one.
5. Press **Approve**. The CLI exits, optionally turning the plan into a ticket board first.

`PLAN.md` stays clean markdown the whole time. Comments and threads live in a
`PLAN.quill.json` sidecar, so the plan file is never polluted with review metadata and every
`git diff` stays readable. Editing one sentence changes one line.

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
| `PLAN.quill.json` | comments and threads, anchored by quoted text |
| `.quill/` | transient revision request/response, attached mode only |

Comments are anchored by the text they quote plus surrounding context, never by offsets, so
they survive the agent rewording the paragraph around them. When an anchor genuinely cannot
be found, the comment is orphaned into a tray rather than silently re-attached to the wrong
sentence.

## Development

```bash
pnpm install
pnpm build          # web bundle, then the CLI that embeds it
pnpm test           # 438 tests
pnpm typecheck
```

`packages/cli` is the Node CLI and server; `packages/web` is the React editor, whose build
output is embedded into the CLI package.
