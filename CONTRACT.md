# CONTRACT — M1 parallel workstreams

Three workstreams build M1 concurrently in separate git worktrees. This file is the
coordination boundary. **If you follow it, the merge is trivial. If you edit outside your
lane, you cause a conflict.**

## Lanes and file ownership

| Lane | Branch | Owns (edit freely) | Must not touch |
|------|--------|--------------------|----------------|
| **cli** | `m1/cli` | `packages/cli/src/**` except `types.ts` | everything under `packages/web` |
| **editor** | `m1/editor` | `packages/web/src/editor/**` | `shell/`, `styles/`, `App.tsx`, `packages/cli` |
| **chrome** | `m1/chrome` | `packages/web/src/shell/**`, `packages/web/src/styles/**` | `editor/`, `App.tsx`, `packages/cli` |

### Frozen — nobody edits these

`package.json` (all), `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig*.json`,
`vite.config.ts`, `tsup.config.ts`, `index.html`, `scripts/copy-web.mjs`,
`src/main.tsx`, `src/App.tsx`, `src/api.ts`, `src/types.ts` (both copies), `PLAN.md`, `.tickets/`.

Dependencies are pre-installed and the lockfile is committed. **Do not add, remove or
upgrade a dependency.** If you are certain you need one, stop and report it instead.

## HTTP API

The web app is same-origin in production. In dev, Vite (`:5273`) proxies `/api` to the CLI
server (`:7823` by default, override with `QUILL_API`).

```
GET /api/plan  ->  200 PlanResponse | 404|500 ErrorResponse
```

```ts
interface PlanResponse {
  path: string;      // absolute path on disk
  name: string;      // basename, e.g. "PLAN.md"
  markdown: string;  // raw source
  revision: string;  // opaque content hash (M2 uses it for conflict-safe writes)
}
interface ErrorResponse { error: string }
```

Defined in `packages/cli/src/types.ts` and mirrored in `packages/web/src/types.ts`. Both
are frozen for M1. Writes (`PUT`) are M2 — do not build them.

## Component API

`App.tsx` (frozen) is the only wiring point:

```tsx
<AppShell docName={plan?.name ?? "Untitled"} status={status} error={error}>
  {plan ? <PlanEditor markdown={plan.markdown} /> : null}
</AppShell>
```

```ts
interface AppShellProps {
  docName: string;
  status: "loading" | "ready" | "error";
  error?: string | null;
  children: ReactNode;   // the editor — render it inside the white page
}
interface PlanEditorProps { markdown: string }
```

Prop shapes are frozen. Implementations are entirely yours.

**Division of visual responsibility:** chrome owns everything outside the text — the grey
field, the white page, its width, padding, shadow and the title bar. Editor owns everything
inside the text — typography of headings, paragraphs, lists, code, tables, and the
`ProseMirror` content area. Chrome must not style `.ProseMirror` descendants; editor must
not set page width, background or padding.

## Build

```bash
pnpm install
pnpm build          # web first, then cli (cli copies web/dist into its own dist/web)
pnpm typecheck      # must pass in every lane
```

`pnpm -F @quill/web build` and `pnpm -F @quill/cli build` work independently. The CLI build
requires `packages/web/dist` to exist.

## Definition of done for your lane

- `pnpm typecheck` passes.
- `pnpm build` succeeds.
- No edits outside your lane (`git diff --stat main` proves it).
- Committed on your branch with a clear message.

## M1 scope discipline

M1 is **render only**. No saving, no websockets, no comments, no tracked changes, no AI, no
ribbon. Those are M2–M5 and building them now will be reverted. Getting the foundation
clean and the page beautiful is the whole job.
