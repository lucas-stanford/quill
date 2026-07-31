import type { ReactNode } from "react";
import type { TrackedChangesApi } from "../tracking";
import type { EditorMode, LoadStatus, SaveState } from "../types";
import { useTheme } from "../theme";
import { ReviewBar } from "./ReviewBar";
import "./AppShell.css";

/** FROZEN PROP CONTRACT — the shape may not change; the implementation is yours. */
export interface AppShellProps {
  /** Document name for the title bar, e.g. "PLAN.md". */
  docName: string;
  status: LoadStatus;
  /** Present only when status === "error". */
  error?: string | null;
  /** Autosave lifecycle — surface it quietly, the way Word shows "Saved". */
  saveState?: SaveState;
  /**
   * The formatting ribbon. Belongs to edit mode only.
   * It must slide in and out WITHOUT moving the page — animate transform and
   * reserve or overlay its space; never animate height or toggle display.
   */
  toolbar?: ReactNode;
  /** Edit vs review. Drives ribbon visibility. */
  mode?: EditorMode;
  /** The edit/review control. Render it in the title bar. */
  modeSwitch?: ReactNode;
  /** Comment bubbles, rendered in the right margin beside the page. */
  commentRail?: ReactNode;
  /** Tracked-change controls. M4 surfaces accept/reject from here. */
  tracking?: TrackedChangesApi;
  /** The Update with AI control. Render it in the title bar. */
  updateWithAI?: ReactNode;
  /** The editor. Render it inside the white page. */
  children: ReactNode;
}

export function AppShell({
  docName,
  status,
  error,
  saveState,
  toolbar,
  mode = "edit",
  modeSwitch,
  commentRail,
  tracking,
  updateWithAI,
  children,
}: AppShellProps) {
  /*
   * The ribbon stays mounted in both modes and slides on `transform`.
   * Unmounting it (or animating its height) would collapse its space and
   * shove the page up — precisely the jump this must never cause.
   */
  const ribbonHidden = mode !== "edit";

  return (
    <div className="shell" data-mode={mode}>
      <header className="titlebar">
        <div className="titlebar-brand" aria-label="Quill">
          <QuillNib />
          <span className="titlebar-wordmark">Quill</span>
        </div>
        <span className="titlebar-docname">{docName}</span>
        <div className="titlebar-right">
          {updateWithAI}
          {modeSwitch}
          <div aria-live="polite" aria-atomic="true">
            <StatusBadge status={status} saveState={saveState} />
          </div>
          <ThemeToggle />
        </div>
      </header>

      {/*
       * `inert` while hidden so a keyboard user cannot Tab into a toolbar they
       * cannot see, and so screen readers skip it. It is belt and braces with
       * the CSS `visibility: hidden` applied once the slide finishes: `inert`
       * covers the 200 ms while the ribbon is still visible but on its way
       * out, `visibility` covers browsers without `inert`.
       */}
      <div
        className="ribbon-slot"
        data-hidden={ribbonHidden || undefined}
        inert={ribbonHidden}
        aria-hidden={ribbonHidden || undefined}
      >
        {toolbar}
      </div>

      <main className="page-canvas">
        <div className="page-canvas-inner">
          <div className="page-sheet">
            {status === "loading" && <LoadingSkeleton />}
            {status === "error" && (
              <ErrorView error={error ?? "An unexpected error occurred."} />
            )}
            {status === "ready" && children}
          </div>
          {/*
           * The rail's column is reserved whether or not there are comments,
           * so the first bubble to arrive cannot shift the page sideways.
           * Empty, it is not announced as a landmark.
           */}
          <aside
            className="comment-rail"
            aria-label="Comments"
            aria-hidden={commentRail ? undefined : true}
          >
            {commentRail}
          </aside>
        </div>
      </main>

      {/*
       * Pinned to the bottom of the shell, over the canvas — never a row in it.
       * The ribbon already overlays the top band; a second bar of chrome up
       * there would have to be reserved for, and would push the page down the
       * moment a revision landed. See ReviewBar.css.
       */}
      <ReviewBar tracking={tracking} />
    </div>
  );
}

/* ── Theme toggle ─────────────────────────────────────────────
   Small sun/moon button in the right end of the title bar. */

function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const isDark = theme === "dark";
  const next = isDark ? "light" : "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      className="theme-toggle"
      aria-label={label}
      title={label}
      onClick={() => setTheme(next)}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="2.8" />
      <line x1="8" y1="1.2" x2="8" y2="2.6" />
      <line x1="8" y1="13.4" x2="8" y2="14.8" />
      <line x1="1.2" y1="8" x2="2.6" y2="8" />
      <line x1="13.4" y1="8" x2="14.8" y2="8" />
      <line x1="3.1" y1="3.1" x2="4.1" y2="4.1" />
      <line x1="11.9" y1="11.9" x2="12.9" y2="12.9" />
      <line x1="12.9" y1="3.1" x2="11.9" y2="4.1" />
      <line x1="4.1" y1="11.9" x2="3.1" y2="12.9" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Crescent: a filled arc minus the moon's night-side circle */}
      <path d="M13.5 10.5A6 6 0 0 1 5.5 2.5 6 6 0 1 0 13.5 10.5z" />
    </svg>
  );
}

/* ── Quill nib icon ───────────────────────────────────────────
   Geometric fountain-pen nib oriented tip-down.
   Vent hole and slit are cut out in white to read as a real nib. */

function QuillNib() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 24"
      width="15"
      height="22"
      aria-hidden="true"
      fill="currentColor"
    >
      {/* Nib body: rectangular shoulders, rounded top corners, pointed tip */}
      <path d="M5 0 H11 Q15 0 15 4 V13 L8 24 L1 13 V4 Q1 0 5 0 Z" />
      {/* Vent hole */}
      <circle cx="8" cy="8.5" r="2.2" fill="white" />
      {/* Centre slit */}
      <line
        x1="8" y1="10.7"
        x2="8" y2="23"
        stroke="white"
        strokeWidth="1.3"
      />
    </svg>
  );
}

/* ── Status badge ─────────────────────────────────────────────
   Human copy modelled on Word's "Saved" indicator.
   aria-live="polite" wraps this in AppShell so changes are announced. */

function StatusBadge({ status, saveState }: { status: LoadStatus; saveState?: SaveState }) {
  if (status === "loading") {
    return <span className="status-badge status-badge--loading">Opening…</span>;
  }
  if (status === "error") {
    return <span className="status-badge status-badge--load-error">Failed to open</span>;
  }

  /* status === "ready" */
  switch (saveState) {
    case "dirty":
      return <span className="status-badge">Unsaved changes</span>;
    case "saving":
      return <span className="status-badge">Saving…</span>;
    case "saved":
      /* Fades out after ~1.5 s via CSS animation */
      return <span className="status-badge status-badge--saved">Saved</span>;
    case "stale":
      return (
        <span className="status-badge status-badge--stale" title="The file was modified on disk while you had unsaved edits. Your edits are intact but the document is out of step with the saved file.">
          File changed on disk — your edits kept
        </span>
      );
    case "conflict":
      return (
        <span className="status-badge status-badge--conflict" title="Your edits are still in the editor but were NOT written to disk. Save was rejected because the file was modified externally.">
          Not saved — file was modified externally
        </span>
      );
    case "error":
      return <span className="status-badge status-badge--save-error">Save failed</span>;
    default:
      return null;
  }
}

/* ── Loading skeleton ─────────────────────────────────────────
   Mimics the rough shape of a markdown document so there is
   no layout shift when the editor mounts. */

const SKELETON_LINES: ReadonlyArray<{
  width: string;
  height: number;
  marginBottom: number;
}> = [
  { width: "58%", height: 26, marginBottom: 28 },  // document title
  { width: "90%", height: 13, marginBottom:  6 },
  { width: "84%", height: 13, marginBottom:  6 },
  { width: "70%", height: 13, marginBottom: 24 },
  { width: "33%", height: 18, marginBottom: 12 },  // section heading
  { width: "92%", height: 13, marginBottom:  6 },
  { width: "87%", height: 13, marginBottom:  6 },
  { width: "61%", height: 13, marginBottom:  6 },
  { width: "80%", height: 13, marginBottom: 24 },
  { width: "27%", height: 18, marginBottom: 12 },  // section heading
  { width: "94%", height: 13, marginBottom:  6 },
  { width: "85%", height: 13, marginBottom:  6 },
  { width: "51%", height: 13, marginBottom:  0 },
];

function LoadingSkeleton() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading document">
      {SKELETON_LINES.map((line, i) => (
        <div
          key={i}
          className="skeleton-bone"
          style={{
            width: line.width,
            height: line.height,
            marginBottom: line.marginBottom,
          }}
        />
      ))}
    </div>
  );
}

/* ── Error view ───────────────────────────────────────────────
   Displayed on the page, not as a browser alert bar.
   role="alert" ensures screen readers announce the error. */

function ErrorView({ error }: { error: string }) {
  return (
    <div className="error-view" role="alert">
      <TriangleAlert />
      <h1 className="error-view-heading">Something went wrong</h1>
      <p className="error-view-message">{error}</p>
    </div>
  );
}

function TriangleAlert() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="error-view-icon"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9"  x2="12"   y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

