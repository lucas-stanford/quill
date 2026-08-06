/**
 * companions/useCompanions.ts
 *
 * The reading material beside the plan.
 *
 * Two rules shape this hook.
 *
 * **Nothing here may touch the plan.** The plan's editor, its comments and its
 * pending tracked changes are the state a review is made of, and a reader that
 * could disturb them would be a worse bargain than not having it. So a
 * companion is fetched, held here, and rendered in an overlay: the editor
 * underneath is never unmounted, re-keyed or re-measured.
 *
 * **It is always the file as it is now.** Companions are re-read every time one
 * is opened rather than cached, because in the planfer flow an agent may still
 * be writing `research.md` while the reviewer is reading the plan. A stale
 * research document is worse than a slow one — the reviewer would be judging
 * the plan against evidence that has since changed.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCompanion, fetchCompanions } from "../api";
import type { CompanionDocument, CompanionSummary } from "../types";
export interface CompanionsApi {
  /** The companions that exist, for the title-bar control. Empty is normal. */
  available: CompanionSummary[];
  /** The one on screen, or null when the drawer is closed. */
  open: CompanionDocument | null;
  /** Name of the companion being fetched, for the pending state. */
  loading: string | null;
  error: string | null;
  /** Bumped each time the drawer closes — a cheap "something may have changed". */
  closedCount: number;
  show: (name: string) => void;
  close: () => void;
}

export function useCompanions(enabled: boolean): CompanionsApi {
  const [available, setAvailable] = useState<CompanionSummary[]>([]);
  const [open, setOpen] = useState<CompanionDocument | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closedCount, setClosedCount] = useState(0);

  /** Guards against an older fetch resolving after a newer one. */
  const requestRef = useRef(0);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // A server without the endpoint, or a plan with no companions, both mean
    // "no tabs" — neither is worth a message on screen.
    fetchCompanions()
      .then((list) => {
        if (!cancelled) setAvailable(list.documents);
      })
      .catch(() => {
        if (!cancelled) setAvailable([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const show = useCallback((name: string) => {
    const ticket = ++requestRef.current;
    setLoading(name);
    setError(null);
    fetchCompanion(name)
      .then((doc) => {
        if (!aliveRef.current || ticket !== requestRef.current) return;
        setOpen(doc);
        setLoading(null);
      })
      .catch((cause: unknown) => {
        if (!aliveRef.current || ticket !== requestRef.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoading(null);
      });
  }, []);

  const close = useCallback(() => {
    // Bump the ticket so an in-flight open cannot re-open what was just closed.
    requestRef.current++;
    setOpen(null);
    setLoading(null);
    setError(null);
    setClosedCount((n) => n + 1);
  }, []);

  return { available, open, loading, error, closedCount, show, close };
}
