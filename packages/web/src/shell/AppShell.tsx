import type { ReactNode } from "react";
import type { LoadStatus, SaveState } from "../types";
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
  /** The formatting ribbon. Render it between the title bar and the canvas. */
  toolbar?: ReactNode;
  /** The editor. Render it inside the white page. */
  children: ReactNode;
}

export function AppShell({ docName, status, error, saveState, toolbar, children }: AppShellProps) {
  return (
    <div className="shell">
      <header className="titlebar">
        <div className="titlebar-brand" aria-label="Quill">
          <QuillNib />
          <span className="titlebar-wordmark">Quill</span>
        </div>
        <span className="titlebar-docname">{docName}</span>
        <div className="titlebar-status" aria-live="polite" aria-atomic="true">
          <StatusBadge status={status} saveState={saveState} />
        </div>
      </header>

      {toolbar}

      <main className="page-canvas">
        <div className="page-canvas-inner">
          <div className="page-sheet">
            {status === "loading" && <LoadingSkeleton />}
            {status === "error" && (
              <ErrorView error={error ?? "An unexpected error occurred."} />
            )}
            {status === "ready" && children}
          </div>
        </div>
      </main>
    </div>
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
   Shown right-aligned in the title bar. Ready state is silent. */

function StatusBadge({ status, saveState }: { status: LoadStatus; saveState?: SaveState }) {
  if (status === "loading") {
    return <span className="status-badge status-badge--loading">Opening…</span>;
  }
  if (status === "error") {
    return <span className="status-badge status-badge--error">Error</span>;
  }
  if (saveState && saveState !== "idle") {
    return <span className="status-badge">{saveState}</span>;
  }
  return null;
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
