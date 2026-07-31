import { useEffect, useState } from "react";
import { AppShell } from "./shell";
import { PlanEditor } from "./editor";
import { fetchPlan } from "./api";
import type { LoadStatus, PlanResponse } from "./types";

/**
 * FROZEN WIRING — see CONTRACT.md. This file joins the two parallel workstreams;
 * do not edit it in a feature worktree.
 */
export default function App() {
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    fetchPlan()
      .then((p) => {
        if (cancelled) return;
        setPlan(p);
        setStatus("ready");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell docName={plan?.name ?? "Untitled"} status={status} error={error}>
      {plan ? <PlanEditor markdown={plan.markdown} /> : null}
    </AppShell>
  );
}
