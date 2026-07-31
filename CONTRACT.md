# CONTRACT — M2 parallel workstreams

Three workstreams build M2 concurrently in separate git worktrees. This file is the
coordination boundary. **If you follow it, the merge is trivial. If you edit outside your
lane, you cause a conflict.**

M2 is **"Edit without drift"**. Demo: edit in the browser and `PLAN.md` updates; edit
`PLAN.md` in your editor and the browser updates underneath you. M2 also introduces
**dark mode, which is the default theme.**

## Lanes and file ownership

| Lane | Branch | Owns (edit freely) | Must not touch |
|------|--------|--------------------|----------------|
| **roundtrip** | `m2/roundtrip` | `packages/web/src/editor/**`, `packages/web/src/markdown/**` (new) | `shell/`, `live/`, `App.tsx`, `packages/cli` |
| **ribbon** | `m2/ribbon` | `packages/web/src/shell/**`, `packages/web/src/styles/**` | `editor/`, `live/`, `App.tsx`, `packages/cli` |
| **sync** | `m2/sync` | `packages/cli/src/**` (except `types.ts`), `packages/web/src/live/**` | everything else under `packages/web` |

### Frozen — nobody edits these

`package.json` (all), `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig*.json`,
`vite.config.ts`, `tsup.config.ts`, `index.html`, `scripts/copy-web.mjs`,
`src/main.tsx`, `src/App.tsx`, `src/api.ts`, `src/theme.ts`, `src/types.ts` (both copies),
`PLAN.md`, `.tickets/`.

Dependencies are pre-installed and the lockfile is committed. **Do not add, remove or
upgrade a dependency.** If you are certain you need one, stop and report it instead.

## HTTP API

Same-origin in production. In dev, Vite (`:5273`) proxies `/api` to the CLI server (`:7823`).

```
GET /api/plan   -> 200 PlanResponse
PUT /api/plan   -> 200 PlanResponse | 409 ConflictResponse | 400 ErrorResponse
GET /api/live   -> text/event-stream (SSE)
```

```ts
interface PlanResponse  { path: string; name: string; markdown: string; revision: string }
interface ErrorResponse { error: string }
interface SavePlanRequest  { markdown: string; revision: string }
interface ConflictResponse { error: string; current: PlanResponse }
interface PlanChangedEvent { revision: string }
```

`revision` is the sha256 of the markdown, hex.

**PUT semantics.** The body carries the revision the edit was based on. If it does not match
the file's current hash on disk, respond **409** with `ConflictResponse` and do not write.
On success, write the file and return the new `PlanResponse`.

**SSE semantics.** `GET /api/live` holds an event stream. When the plan file changes on
disk, emit an event named `plan-changed` whose `data` is a JSON `PlanChangedEvent`.
**A write made through `PUT /api/plan` must not produce an event** — the server knows the
hash it just wrote and must suppress the echo, or the browser will fight the user's typing.

SSE rather than WebSockets is deliberate: the traffic is one-directional, `EventSource`
reconnects on its own, and it needs no dependency and no RFC 6455 framing.

## Component API

`App.tsx` (frozen) is the only wiring point. It owns the save lifecycle:

```tsx
const editor = usePlanEditor({ markdown: doc?.markdown ?? "", onChange: handleChange });

useLivePlan({ enabled: status === "ready", onChanged: ({ revision }) => { ... } });

<AppShell docName status error saveState toolbar={<Ribbon editor={editor} />}>
  <PlanEditor editor={editor} />
</AppShell>
```

```ts
interface UsePlanEditorOptions {
  markdown: string;                        // changing this REPLACES the document
  onChange?: (markdown: string) => void;   // fires on every user edit, serialized to markdown
}
function usePlanEditor(o: UsePlanEditorOptions): Editor | null

interface PlanEditorProps { editor: Editor | null }
interface RibbonProps     { editor: Editor | null }
interface AppShellProps {
  docName: string;
  status: "loading" | "ready" | "error";
  error?: string | null;
  saveState?: SaveState;   // "idle"|"dirty"|"saving"|"saved"|"stale"|"conflict"|"error"
  toolbar?: ReactNode;     // render between the title bar and the canvas
  children: ReactNode;     // the editor — render inside the white page
}

interface UseLivePlanOptions {
  enabled: boolean;
  onChanged: (event: PlanChangedEvent) => void;
}
function useLivePlan(o: UseLivePlanOptions): void
```

Prop shapes are frozen. Implementations are entirely yours.

**Critical invariant for `usePlanEditor`:** `App` never feeds the markdown from `onChange`
back in as the `markdown` prop, so you can treat a change of `markdown` as an authoritative
external reload. But you must not fire `onChange` as a result of loading `markdown` — only
real user edits. Firing on programmatic load causes an infinite save loop.

## Theming — dark by default

`index.html` sets `data-theme="dark"` or `"light"` on `<html>` before first paint, reading
`localStorage["quill-theme"]`. `src/theme.ts` (frozen) exports `useTheme()`, `getTheme()`,
`applyTheme()`. **Dark is the default and must be what a first-time user sees.**

Both themes are first-class. Light mode must remain the credible Word-on-the-web look it is
today; dark mode must feel like a real dark word processor, not an inverted document.

### Design token contract

The **ribbon lane** defines every token below, for both themes, in `styles/global.css`:

```css
:root { /* dark values — the default */ }
:root[data-theme="light"] { /* light overrides */ }
```

Set `color-scheme: dark` / `light` per theme so scrollbars and form controls follow.

**Every other lane consumes these with `var(--token)` and must never hardcode a colour.**
This is the whole coordination mechanism for theming — a hardcoded hex in the editor lane
will look broken in one of the two themes.

| Token | Meaning |
|---|---|
| `--color-canvas` | the field behind the page |
| `--color-page` | the page surface |
| `--color-page-border` | page edge, if any |
| `--color-shadow` | page elevation shadow colour |
| `--color-text` | body text |
| `--color-text-muted` | secondary/status text |
| `--color-heading` | heading text |
| `--color-rule` | horizontal rules and hairlines |
| `--color-code-bg` / `--color-code-border` / `--color-code-text` | fenced code blocks |
| `--color-inline-code-bg` / `--color-inline-code-text` | inline code |
| `--color-link` | links |
| `--color-accent` | brand / active control |
| `--color-titlebar-bg` / `--color-titlebar-border` | title bar and ribbon chrome |
| `--color-control-hover` / `--color-control-active` | toolbar button states |
| `--color-selection` | text selection background |

A dark page needs a *softer* white than `#fff` inverted — aim for a near-black page surface
distinct from the canvas behind it, with body text near `#e6e6e6` rather than pure white, so
long-form reading is comfortable. Keep contrast at WCAG AA for body text in both themes.

The ribbon lane owns the theme toggle control in the title bar, using `useTheme()`.

**Division of visual responsibility:** ribbon lane owns everything outside the text — canvas,
page, title bar, toolbar, and all token definitions. Roundtrip lane owns everything inside
the text — typography of headings, paragraphs, lists, code, and the `.ProseMirror` content
area — and consumes tokens only. The ribbon lane must not style `.ProseMirror` descendants.

> Cascade warning, learned the hard way in M1: `prosemirror-view` injects its own
> `.ProseMirror pre { white-space: pre-wrap }` stylesheet **at runtime**, which outranks an
> equal-specificity rule by load order. If you need to beat a ProseMirror default, raise
> specificity (e.g. `.ProseMirror.ProseMirror pre`) rather than reaching for `!important`.

## Build

```bash
pnpm install
pnpm build          # web first, then cli (cli copies web/dist into its own dist/web)
pnpm typecheck      # must pass in every lane
```

## Definition of done for your lane

- `pnpm typecheck` passes and `pnpm build` succeeds.
- No edits outside your lane (`git diff --stat main` proves it).
- Anything visual verified in **both themes**, dark first.
- Committed on your branch with a clear message.

## M2 scope discipline

No comments, no tracked changes, no AI, no ferricket. Those are M3–M5 and building them now
will be reverted.
