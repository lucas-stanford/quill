# CONTRACT — M4 parallel workstreams

Three workstreams build M4 concurrently in separate git worktrees. This file is the
coordination boundary. **If you follow it, the merge is trivial. If you edit outside your
lane, you cause a conflict.**

M4 is **"The AI round-trip"** — it closes the loop. Everything before it is a nicer way to
read a plan; this is what makes it a way to change one. Demo: press **Update with AI** and
the plan rewrites itself around your comments and edits, arriving as tracked changes you can
accept or reject.

## Lanes and file ownership

| Lane | Branch | Owns (edit freely) | Must not touch |
|------|--------|--------------------|----------------|
| **payload** | `m4/payload` | `packages/web/src/revision/buildBrief.ts` (+ new files under `revision/` prefixed `brief`) | everything else |
| **bridge** | `m4/bridge` | `packages/cli/src/**` (except `types.ts`) | everything under `packages/web` |
| **revision-ui** | `m4/revision-ui` | `packages/web/src/revision/**` except `buildBrief*`, plus `packages/web/src/shell/**` and `styles/**` | `editor/`, `markdown/`, `annotations/`, `tracking/`, `live/`, `App.tsx` |

### Frozen — nobody edits these

`package.json` (all), `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig*.json`,
`vite.config.ts`, `tsup.config.ts`, `index.html`, `scripts/copy-web.mjs`,
`src/main.tsx`, `src/App.tsx`, `src/api.ts`, `src/theme.ts`, `src/types.ts` (both copies),
`PLAN.md`, `.tickets/`, and everything under `editor/`, `markdown/`, `annotations/`,
`tracking/`, `live/` (M1–M3 shipped code).

**Do not add, remove or upgrade a dependency.**

## HTTP API

```
GET    /api/plan         200 PlanResponse
PUT    /api/plan         200 | 409 ConflictResponse | 400
GET    /api/live         text/event-stream, event `plan-changed`
GET    /api/annotations  200 AnnotationsResponse
PUT    /api/annotations  200 | 409 | 400
POST   /api/revision     200 RevisionState        [M4, bridge lane]
GET    /api/revision     200 RevisionState        [M4, bridge lane]
DELETE /api/revision     204                      [M4, bridge lane]
```

```ts
interface RevisionBrief { markdown: string; comments: BriefComment[]; edits: BriefEdit[]; instruction?: string }
interface BriefComment  { quote: string; body: string; author: string; replies: string[]; orphaned: boolean }
interface BriefEdit     { kind: "insertion" | "deletion"; text: string; context?: string }
type RevisionStatus = "idle" | "queued" | "working" | "done" | "failed" | "cancelled";
interface RevisionState { id: string; status: RevisionStatus; markdown?: string; error?: string; mode: "attached" | "detached" }
interface QueuedRevision { id: string; planPath: string; brief: RevisionBrief; createdAt: string }
```

## The two agent modes

**Attached** is the primary path. Quill was spawned by a coding agent, which is blocked
waiting. `POST /api/revision` writes a `QueuedRevision` to `.quill/revision-request.json`
beside the plan; the parent agent picks it up, rewrites `PLAN.md` on disk, and the **existing
M2 file watcher** pushes the new plan back to the browser. The queue is a plain file so any
parent can poll it with no protocol library.

**Detached** is what makes `quill PLAN.md` useful standalone: with nobody listening, Quill
shells out to `copilot -p` itself with the revision prompt. It must degrade with a clear
message when no CLI is on PATH — not hang, not crash.

How the server decides which mode it is in is the bridge lane's call; make it explicit and
justify it (an env var set when spawning, a flag, or a handshake).

## Component API

`App.tsx` (frozen) is the only wiring point:

```tsx
const revision = useRevision({ enabled, markdown, annotations, tracking });

<AppShell … updateWithAI={<UpdateWithAI revision={revision} pendingCount={…} />}>
```

Frozen signatures live in `revision/useRevision.ts`, `revision/buildBrief.ts`,
`revision/UpdateWithAI.tsx`. **Shapes are frozen; implementations are yours.**

## Load-bearing invariants — do not break these

1. **`onChange` must never fire from a programmatic load.** `App` autosaves whatever it
   emits; firing on load is an infinite save loop that corrupts the user's file.
2. **Untouched blocks round-trip byte-identically.** Typing one character changes exactly
   one line in `PLAN.md`. M2 and M3 both had to be fixed for this; do not regress it.
3. **Anchors are text-quote based.** They must survive the AI rewording the surrounding
   paragraph — that is precisely what M4 does, so this invariant finally gets exercised for
   real. A comment whose text is rewritten should orphan, not mis-attach.
4. **Rejecting every AI change restores the pre-revision document exactly**, proven by hash.
   This is what makes a bad rewrite safe, and it is the reason the revision arrives as
   tracked changes rather than a replacement.
5. **The plan file holds no review metadata.** Comments live in the sidecar.

## Framing the brief — this is a product decision, not a formatting detail

- **Edits are decisions already made.** The reviewer struck a sentence; the agent does not
  get to re-litigate it.
- **Comments are instructions to apply**, attached to a specific quote.
- **Resolved comments are excluded.** `annotations.forBrief()` already does this. Note it
  *includes* orphans deliberately — an orphaned note still carries reviewer intent.
- Send a structured brief, never a raw diff dump.

## Theming — dark by default

Consume design tokens with `var(--token)`; **never hardcode a colour.** Tokens for AI vs
human change authorship already exist: `--color-change-ai`, `--color-change-human`,
`--color-insertion`, `--color-deletion`.

## Build and test

```bash
pnpm install
pnpm typecheck && pnpm build && pnpm test
```
195 tests pass at head (55 CLI via node:test, 140 web via vitest). **Do not regress them.**

## Definition of done for your lane

- `pnpm typecheck`, `pnpm build` and `pnpm test` all pass.
- No edits outside your lane (`git diff --stat main` proves it).
- Real evidence in your report — diffs, output, screenshots. Claims are not accepted.
- Committed on your branch with a clear message.

## M4 scope discipline

No approve flow, no exit protocol, no ferricket handoff, no packaging. Those are M5.
