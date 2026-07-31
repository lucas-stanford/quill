import type { ReactNode } from "react";
import type { LoadStatus } from "../types";

/** FROZEN PROP CONTRACT — the shape may not change; the implementation is yours. */
export interface AppShellProps {
  /** Document name for the title bar, e.g. "PLAN.md". */
  docName: string;
  status: LoadStatus;
  /** Present only when status === "error". */
  error?: string | null;
  /** The editor. Render it inside the white page. */
  children: ReactNode;
}

// STUB — replaced by the chrome workstream.
export function AppShell({ docName, status, error, children }: AppShellProps) {
  return (
    <div>
      <header>{docName}</header>
      {status === "error" ? <p role="alert">{error}</p> : null}
      <main>{children}</main>
    </div>
  );
}
