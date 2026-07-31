import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell, ModeSwitch, Ribbon } from "./shell";
import { PlanEditor, usePlanEditor } from "./editor";
import { useLivePlan } from "./live";
import { useAnnotations, CommentRail } from "./annotations";
import { useTrackedChanges } from "./tracking";
import { ConflictError, fetchPlan, savePlan } from "./api";
import type { EditorMode, LoadStatus, PlanResponse, SaveState } from "./types";

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
  const [mode, setMode] = useState<EditorMode>("edit");

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

  const flush = useCallback(async () => {
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
        setSaveState("conflict");
      } else {
        setSaveState("error");
      }
    }
  }, []);

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
  useTrackedChanges({ editor, enabled: status === "ready" });

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
      mode={mode}
      modeSwitch={status === "ready" ? <ModeSwitch mode={mode} onChange={setMode} /> : null}
      toolbar={status === "ready" ? <Ribbon editor={editor} /> : null}
      commentRail={
        status === "ready" ? <CommentRail annotations={annotations} /> : null
      }
    >
      {doc ? <PlanEditor editor={editor} /> : null}
    </AppShell>
  );
}
