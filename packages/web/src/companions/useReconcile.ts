/**
 * companions/useReconcile.ts
 *
 * Noticing when the plan is being argued from research that has moved.
 *
 * `research.md` ends in `## Implications for the plan` — the decisions the
 * research forces, which the milestones are supposed to honour. Change the
 * research and the plan does not change with it, and nothing anywhere says so:
 * the plan goes on looking settled while its justification has quietly been
 * replaced. That is the failure this hook exists to catch, and it is the reason
 * research belongs in Quill at all rather than in another window.
 *
 * Only the implications are watched, not the whole file. Fixing a citation is
 * not a reason to be told the plan is stale; changing what the research
 * CONCLUDES is.
 *
 * The mark of what was last reconciled lives in the plan's sidecar, so it
 * survives a reload and travels with the review rather than with the browser.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCompanion } from "../api";
import type { AnnotationsApi } from "../annotations";
import type { CompanionSummary } from "../types";
import { digest, implicationsOf } from "./sections";

export interface ReconcileApi {
  /** The document whose implications have moved, if any. */
  stale: string | null;
  /** Accept the current implications as what the plan is checked against. */
  accept: () => void;
  /** Re-read the companions and re-check. */
  recheck: () => void;
}

export interface UseReconcileOptions {
  enabled: boolean;
  companions: readonly CompanionSummary[];
  annotations: AnnotationsApi;
  /** Bumped whenever something might have changed a companion. */
  tick: number;
}

export function useReconcile({
  enabled,
  companions,
  annotations,
  tick,
}: UseReconcileOptions): ReconcileApi {
  const [stale, setStale] = useState<string | null>(null);
  const [current, setCurrent] = useState<{ document: string; digest: string } | null>(null);

  const aliveRef = useRef(true);
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /*
   * Only research is watched. `reference.md` is a spec you maintain rather than
   * evidence you gather, so it does not carry implications the plan rests on
   * and changing it is not a reason to re-examine the milestones.
   */
  const watched = companions.find((doc) => /^research\./i.test(doc.name));

  const check = useCallback(() => {
    if (!enabled || !watched) {
      setStale(null);
      setCurrent(null);
      return;
    }
    fetchCompanion(watched.name)
      .then((doc) => {
        if (!aliveRef.current) return;
        const now = digest(implicationsOf(doc.markdown));
        setCurrent({ document: doc.name, digest: now });

        const seen = annotationsRef.current.reconciled[doc.name];
        if (seen === undefined) {
          /*
           * First sight of this document. Adopt it silently rather than opening
           * on an accusation — nobody has failed to reconcile anything yet, and
           * a banner on arrival is a banner people learn to dismiss unread.
           */
          annotationsRef.current.setReconciled(doc.name, now);
          setStale(null);
          return;
        }
        setStale(seen === now ? null : doc.name);
      })
      .catch(() => {
        if (aliveRef.current) setStale(null);
      });
  }, [enabled, watched]);

  useEffect(() => {
    check();
  }, [check, tick]);

  const accept = useCallback(() => {
    if (!current) return;
    annotationsRef.current.setReconciled(current.document, current.digest);
    setStale(null);
  }, [current]);

  return { stale, accept, recheck: check };
}
