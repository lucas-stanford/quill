import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell, Ribbon } from "./shell";
import { PlanEditor, usePlanEditor } from "./editor";
import { useLivePlan } from "./live";
import { useAnnotations, CommentRail } from "./annotations";
import { useTrackedChanges } from "./tracking";
import { useRevision, UpdateWithAI } from "./revision";
import { useApprove, ApproveButton } from "./approve";
import {
  useCompanions,
  useReconcile,
  CompanionDrawer,
  CompanionTabs,
  ReconcileBanner,
} from "./companions";
import { FeedbackRail } from "./feedback";
import { ConflictError, fetchPlan, savePlan } from "./api";
import type { LoadStatus, PlanResponse, SaveState } from "./types";

/**
 * FROZEN WIRING — see CONTRACT.md. This file joins the parallel workstreams;
 * do not edit it in a feature worktree.
 *
 * Owns the save lifecycle. Two rules keep local edits safe:
 *   1. `doc` only changes on load or on an accepted external reload, so the
 *      editor is never reset by our own saves.
 *   2. An external change is never applied while the document is dirty.
 */

const AUTOSAVE_DELAY_MS = 700;

export default function App() {
  const [doc, setDoc] = useState<PlanResponse | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const revisionRef = useRef("");
  const pendingRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPlan()
      .then((p) => {
        if (cancelled) return;
        setDoc(p);
        revisionRef.current = p.revision;
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

  const flush = useCallback(async (rebase = false) => {
    const markdown = pendingRef.current;
    if (markdown === null) return;
    pendingRef.current = null;
    setSaveState("saving");
    try {
      const saved = await savePlan(markdown, revisionRef.current);
      revisionRef.current = saved.revision;
      if (pendingRef.current === null) {
        dirtyRef.current = false;
        setSaveState("saved");
      }
    } catch (e: unknown) {
      if (e instanceof ConflictError) {
        /*
         * The file moved under us. In attached mode this is routine and
         * expected: the agent rewrote the plan on disk while its revision was
         * being reviewed here as tracked changes, so the document in front of
         * the reviewer already subsumes that write. Rebase onto the server's
         * revision and retry once — the reviewer's document wins, because it
         * is the only copy holding their accept/reject decisions.
         *
         * A second conflict means something genuinely contended, so stop and
         * say so rather than looping.
         */
        revisionRef.current = e.current.revision;
        if (!rebase) {
          pendingRef.current = markdown;
          await flushRef.current(true);
          return;
        }
        setSaveState("conflict");
      } else {
        setSaveState("error");
      }
    }
  }, []);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  const handleChange = useCallback(
    (markdown: string) => {
      pendingRef.current = markdown;
      dirtyRef.current = true;
      setSaveState("dirty");
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
    },
    [flush],
  );

  const editor = usePlanEditor({ markdown: doc?.markdown ?? "", onChange: handleChange });

  const annotations = useAnnotations({ editor, enabled: status === "ready" });
  const tracking = useTrackedChanges({ editor, enabled: status === "ready" });

  const revision = useRevision({
    enabled: status === "ready",
    markdown: doc?.markdown ?? "",
    annotations,
    tracking,
  });

  const approve = useApprove({ enabled: status === "ready", annotations, tracking });

  const companions = useCompanions(status === "ready");

  /*
   * Re-checked when the drawer closes, which is when an agent's answer has
   * landed and the reviewer has finished with it — cheap, and exactly when the
   * research is most likely to have moved.
   */
  const reconcile = useReconcile({
    enabled: status === "ready",
    companions: companions.available,
    annotations,
    tick: companions.open === null ? companions.closedCount : -1,
  });

  useLivePlan({
    enabled: status === "ready",
    onChanged: ({ revision }) => {
      if (revision === revisionRef.current) return;
      if (dirtyRef.current) {
        setSaveState("stale");
        return;
      }
      void fetchPlan().then((p) => {
        setDoc(p);
        revisionRef.current = p.revision;
        setSaveState("idle");
      });
    },
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        void flush();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flush]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  return (
    <AppShell
      docName={doc?.name ?? "Untitled"}
      status={status}
      error={error}
      saveState={saveState}
      toolbar={status === "ready" ? <Ribbon editor={editor} /> : null}
      commentRail={
        status === "ready" ? <CommentRail annotations={annotations} /> : null
      }
      feedbackRail={
        status === "ready" ? <FeedbackRail annotations={annotations} /> : null
      }
      tracking={status === "ready" ? tracking : undefined}
      approveButton={status === "ready" ? <ApproveButton approve={approve} /> : null}
      companionTabs={
        status === "ready" ? <CompanionTabs companions={companions} /> : null
      }
      companionDrawer={<CompanionDrawer companions={companions} />}
      banner={
        <ReconcileBanner
          stale={reconcile.stale}
          onAccept={reconcile.accept}
          onRecheck={() => {
            // The ordinary round trip, with the reason attached — not a second
            // revision path that behaves almost the same.
            annotations.addFeedback(
              `The research changed: re-check this plan against the implications in ${reconcile.stale}, and say which milestones are affected.`,
            );
            reconcile.accept();
          }}
        />
      }
      updateWithAI={
        status === "ready" ? (
          <UpdateWithAI
            revision={revision}
            /*
             * Everything the brief would carry. Feedback notes count: they are
             * a first-class part of the brief, and leaving them out disabled
             * the button for a reviewer whose only objection was about the
             * plan as a whole — which is exactly the case the panel exists for.
             */
            pendingCount={
              annotations.forBrief().length +
              annotations.feedbackForBrief().length +
              tracking.changes.length
            }
          />
        ) : null
      }
    >
      {doc ? <PlanEditor editor={editor} /> : null}
    </AppShell>
  );
}
