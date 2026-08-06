# CONTRACT — M5 parallel workstreams

Three workstreams build M5 concurrently in separate git worktrees. This file is the
coordination boundary.

M5 is **"Approve, hand off, ship"** — the last milestone. Demo: press Approve, watch the plan
become a populated ferricket board, and the terminal picks up where it left off. Then
`npx quill PLAN.md` works on a machine that has never seen the repo.

## Lanes and file ownership

| Lane | Branch | Owns (edit freely) | Must not touch |
|------|--------|--------------------|----------------|
| **exit** | `m5/exit` | `packages/cli/src/**` (except `types.ts`) | everything under `packages/web` |
| **approve** | `m5/approve` | `packages/web/src/approve/**`, `packages/web/src/shell/**`, `styles/**` | `editor/`, `markdown/`, `annotations/`, `tracking/`, `revision/`, `live/`, `App.tsx`, `packages/cli` |
| **package** | `m5/package` | `README.md` (new), `packages/cli/package.json`, `packages/cli/scripts/**`, root `package.json` | all source under `src/` |

The **package** lane is the only lane permitted to touch a `package.json`, and only for
packaging metadata — **not** to add, remove or upgrade a dependency.

### Frozen — nobody else edits these

`pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig*.json`, `vite.config.ts`, `tsup.config.ts`,
`index.html`, `src/main.tsx`, `src/App.tsx`, `src/api.ts`, `src/theme.ts`, `src/types.ts`
(both copies), `PLAN.md`, `.tickets/`, and all shipped M1–M4 source.

## HTTP API

```
GET      /api/companions      research.md / reference.md
GET/PUT  /api/companions/:name  editable; PUT is revision-guarded
GET/PUT  /api/examples        the screenshot gallery's manifest
GET      /api/examples/media/:file
GET/PUT  /api/plan            M1/M2
GET      /api/live            M2 (SSE)
GET/PUT  /api/annotations     M3
POST/GET/DELETE /api/revision M4
GET      /api/tickets/preview 200 TicketPlan       [M5, exit lane]
POST     /api/review/finish   200 ReviewSummary    [M5, exit lane]
```

```ts
type ReviewOutcome = "approved" | "cancelled" | "errored";
interface FinishReviewRequest { outcome: ReviewOutcome; createTickets?: boolean }
interface ReviewSummary {
  outcome: ReviewOutcome; planPath: string; revision: string;
  openComments: number; tickets?: string[]; error?: string;
}
interface TicketPreview { title: string; level: number; parent?: number; deps: number[]; body?: string }
interface TicketPlan { available: boolean; tickets: TicketPreview[]; reason?: string }
```

## Component API

`App.tsx` (frozen) is the only wiring point:

```tsx
const approve = useApprove({ enabled, annotations, tracking });
<AppShell … approveButton={<ApproveButton approve={approve} />}>
```

Frozen signatures are in `approve/useApprove.ts` and `approve/ApproveButton.tsx`.

## Load-bearing invariants — do not break these

1. **`onChange` must never fire from a programmatic load** — `App` autosaves whatever it
   emits; firing on load is an infinite save loop that corrupts the user's file.
2. **Untouched blocks round-trip byte-identically.** Typing one character changes exactly
   one line in `PLAN.md`. This has been broken twice and fixed twice; do not regress it.
3. **The plan file holds no review metadata.** Comments and the reviewer's general feedback
   live in `PLAN.quill.json`.
4. **The AI's output is never written to the plan by the server.** It returns in
   `RevisionState.markdown` and lands as tracked changes so it can be rejected.
5. **The formatting ribbon appears only while the user is actively editing.** This is the
   user's most-repeated piece of feedback. It is hidden on load and hidden when focus leaves
   the document. There is no longer a mode gating it — the caret is the only signal — so
   showing it more eagerly is a regression.
6. **Nothing may move the page.** The ribbon and review bar animate `transform` only.
7. **A file's own doc comment goes at the top, above the imports.** It is what the
   file is for, and a reader looking for that should not have to scroll past a
   dependency list to find it. Comments about a specific declaration stay with
   the declaration.

## Build and test

```bash
pnpm install
pnpm typecheck && pnpm build && pnpm test
```
**521 tests pass at head** (198 CLI via node:test, 323 web via vitest). Do not regress them.

## Definition of done for your lane

- `pnpm typecheck`, `pnpm build` and `pnpm test` all pass.
- No edits outside your lane (`git diff --stat main` proves it).
- Real evidence in your report — diffs, output, screenshots. Claims are not accepted.
- Committed on your branch with a clear message.
