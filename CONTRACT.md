# CONTRACT — M3 parallel workstreams

Five workstreams build M3 concurrently in separate git worktrees. This file is the
coordination boundary. **If you follow it, the merge is trivial. If you edit outside your
lane, you cause a conflict.**

M3 is **"Annotate and mark up"** — the reason Quill exists. Demo: select a step, leave a
margin comment, strike a paragraph you disagree with, and see both rendered like a marked-up
Word document.

## Lanes and file ownership

| Lane | Branch | Owns (edit freely) | Must not touch |
|------|--------|--------------------|----------------|
| **annotations** | `m3/annotations` | `packages/web/src/annotations/**` | everything else |
| **tracking** | `m3/tracking` | `packages/web/src/tracking/**` | everything else |
| **tables** | `m3/tables` | `packages/web/src/editor/**`, `packages/web/src/markdown/**` | everything else |
| **server** | `m3/server` | `packages/cli/src/**` (except `types.ts`) | everything under `packages/web` |
| **shell** | `m3/shell` | `packages/web/src/shell/**`, `packages/web/src/styles/**` | everything else |

### Frozen — nobody edits these

`package.json` (all), `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig*.json`,
`vite.config.ts`, `tsup.config.ts`, `index.html`, `scripts/copy-web.mjs`,
`src/main.tsx`, `src/App.tsx`, `src/api.ts`, `src/theme.ts`, `src/types.ts` (both copies),
`PLAN.md`, `.tickets/`.

Dependencies are pre-installed and the lockfile is committed. **Do not add, remove or
upgrade a dependency.** `@tiptap/extension-table` and `vitest` were added for M3 — use them.

## HTTP API

```
GET  /api/plan         -> 200 PlanResponse
PUT  /api/plan         -> 200 PlanResponse | 409 ConflictResponse | 400 ErrorResponse
GET  /api/live         -> text/event-stream (SSE), event `plan-changed`
GET  /api/annotations  -> 200 AnnotationsResponse            [M3, server lane]
PUT  /api/annotations  -> 200 AnnotationsResponse | 409 | 400 [M3, server lane]
```

Review metadata lives in a sidecar next to the plan: `PLAN.md` -> `PLAN.quill.json`.
**`PLAN.md` must contain zero review metadata.** A missing sidecar is not an error — it
degrades to an empty `Sidecar` so Quill still works as a plain markdown editor.

```ts
interface TextAnchor { quote: string; prefix: string; suffix: string }
interface Comment {
  id: string; anchor: TextAnchor; author: string; body: string;
  createdAt: string; resolved: boolean; replies: CommentReply[]; orphaned?: boolean;
}
interface Sidecar { version: 1; comments: Comment[] }
interface AnnotationsResponse { sidecar: Sidecar; revision: string }
interface SaveAnnotationsRequest { sidecar: Sidecar; revision: string }
```

`revision` is the sha256 of the serialized sidecar. Same conflict-safe write semantics as
the plan: mismatched revision -> 409, do not write. Reuse the existing atomic
temp-file-plus-rename helper. The sidecar must **not** be watched by `/api/live` — only the
plan is.

## Component API

`App.tsx` (frozen) is the only wiring point:

```tsx
const editor      = usePlanEditor({ markdown, onChange });
const annotations = useAnnotations({ editor, enabled: status === "ready" });
useTrackedChanges({ editor, enabled: status === "ready" });

<AppShell
  docName status error saveState
  mode={mode}
  modeSwitch={<ModeSwitch mode={mode} onChange={setMode} />}
  toolbar={<Ribbon editor={editor} />}
  commentRail={<CommentRail annotations={annotations} />}
>
  <PlanEditor editor={editor} />
</AppShell>
```

Frozen signatures live in `annotations/useAnnotations.ts`, `annotations/CommentRail.tsx`,
`tracking/useTrackedChanges.ts`, `shell/ModeSwitch.tsx`. **Prop and return shapes are
frozen; implementations are entirely yours.** If you need a field that does not exist, stop
and report it rather than changing the shape.

## Load-bearing invariants — do not break these

1. **`onChange` must never fire from a programmatic load.** `App` autosaves whatever
   `onChange` emits; firing on load is an infinite save loop that corrupts the user's file.
2. **Untouched blocks must round-trip byte-identically.** M2 shipped source-preserving
   serialization: each block's raw source is kept and re-emitted verbatim unless the block
   actually changed. Typing one character changes exactly one line. Any change to the
   editor schema or serializer must preserve this — verify with a real diff, not by eye.
3. **Anchors are text-quote based, never offsets.** They must survive the AI rewording the
   surrounding paragraph. Fuzzy-match on load; when matching fails, mark `orphaned` rather
   than attaching to the wrong text. A mis-attached comment is worse than a lost one.
4. **Rejecting every AI change must restore the pre-revision document exactly.** This is
   what makes a bad AI rewrite safe, and M4 depends on it.
5. **The ribbon only reports formatting for a caret the user placed.** `setContent` maps the
   selection to the end of the document, so a naive `isActive()` reports the formatting of
   whatever the plan happens to end with. `shell/useRibbonState.ts` gates on this — keep it.

## Editing versus reviewing

`EditorMode = "edit" | "review"`. The formatting ribbon belongs to **edit mode only** —
showing bold/italic while someone writes a margin note is noise.

**Motion requirement (shell lane):** the ribbon slides out when edit mode is selected and
slides back up when it is not, and **this must not move the rest of the UI**. The page must
not jump or reflow. Animate `transform`, never `height` or `display`, and reserve or overlay
the ribbon's space so canvas geometry is constant. Respect `prefers-reduced-motion`.

## Theming — dark by default

All colour comes from the design tokens defined in `styles/global.css` for both themes
(`:root` = dark, `:root[data-theme="light"]`). **Consume `var(--token)`; never hardcode a
colour.** Comment bubbles and tracked-change marks need new tokens — the **shell lane**
defines them and other lanes consume them:

`--color-comment-bg`, `--color-comment-border`, `--color-comment-anchor`,
`--color-insertion`, `--color-deletion`, `--color-change-ai`, `--color-change-human`.

Provide `var(--token, fallback)` fallbacks so your lane renders standalone before the merge.

> Cascade warning from M1: `prosemirror-view` injects `.ProseMirror pre { white-space:
> pre-wrap }` **at runtime**, outranking an equal-specificity rule by load order. To beat a
> ProseMirror default, raise specificity (`.ProseMirror.ProseMirror pre`), not `!important`.

## Build and test

```bash
pnpm install
pnpm typecheck      # must pass in every lane
pnpm build          # web first, then cli
pnpm test           # vitest — add tests for pure logic in your lane
```

## Definition of done for your lane

- `pnpm typecheck`, `pnpm build` and `pnpm test` all pass.
- No edits outside your lane (`git diff --stat main` proves it).
- Anything visual verified in **both themes**, dark first.
- Real evidence in your report — diffs, output, screenshots. Claims are not accepted.
- Committed on your branch with a clear message.

## M3 scope discipline

No AI round-trip, no approve flow, no ferricket handoff. Those are M4–M5.
