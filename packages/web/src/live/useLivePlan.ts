import { useEffect, useRef } from "react";
import type { PlanChangedEvent } from "../types";

export interface UseLivePlanOptions {
  /** Only connect once the plan has loaded. */
  enabled: boolean;
  /** Fired when the file on disk changes. Never fired for our own writes. */
  onChanged: (event: PlanChangedEvent) => void;
}

/**
 * Subscribes to GET /api/live (SSE) and reports external file changes.
 *
 * A ref holds the `onChanged` callback so a new function identity on every
 * App render does not tear down and rebuild the EventSource — the classic
 * React hook bug with EventSource subscriptions.
 */
export function useLivePlan({ enabled, onChanged }: UseLivePlanOptions): void {
  const onChangedRef = useRef(onChanged);

  // Keep the ref in sync with the latest callback without triggering effects.
  useEffect(() => {
    onChangedRef.current = onChanged;
  });

  useEffect(() => {
    if (!enabled) return;

    const es = new EventSource("/api/live");

    es.addEventListener("plan-changed", (e: MessageEvent) => {
      try {
        const data = JSON.parse(String(e.data)) as unknown;
        if (
          !data ||
          typeof data !== "object" ||
          typeof (data as Record<string, unknown>).revision !== "string"
        )
          return;
        onChangedRef.current(data as PlanChangedEvent);
      } catch {
        // Ignore malformed events — never throw inside an EventSource handler.
      }
    });

    return () => {
      es.close();
    };
  }, [enabled]);
}
