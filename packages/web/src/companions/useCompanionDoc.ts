import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchCompanion, saveCompanion, CompanionConflictError } from "../api";
import type { CompanionDocument, SaveState } from "../types";
import { splitSections } from "./sections";
import type { Section } from "./sections";

/**
 * companions/useCompanionDoc.ts
 *
 * The open companion, as an editable document.
 *
 * It is the plan's save lifecycle at a smaller scale, and deliberately a
 * separate one: the plan's autosave is load-bearing for the review and is not
 * worth generalising around a second document that has no comments, no
 * approval and no exit protocol. What it does share is the bargain — a write is
 * guarded by the revision it was based on, and a rejected write says so instead
 * of quietly losing a side.
 *
 * The other writer here is not a person. It is the agent that was asked to
 * re-run a section, which makes the conflict path routine rather than exotic:
 * whatever the agent just wrote is by definition newer than what is on screen,
 * so a conflict adopts the file rather than fighting it.
 */

const AUTOSAVE_DELAY_MS = 700;

export interface CompanionDocApi {
  doc: CompanionDocument | null;
  /**
   * What the editor should LOAD. It changes on open and when a result lands,
   * and never on a keystroke — feeding the editor its own output would reset
   * the document under the caret on every character.
   */
  content: string;
  /** Live markdown, which is ahead of `content` between keystroke and save. */
  markdown: string;
  sections: Section[];
  saveState: SaveState;
  error: string | null;
  /** Called by the editor on every user edit. */
  onChange: (markdown: string) => void;
  /** Replaces the whole document — how a re-run lands. */
  replaceAll: (markdown: string) => void;
  /** Re-read from disk, discarding nothing: only called when clean. */
  reload: () => void;
}

export function useCompanionDoc(name: string | null): CompanionDocApi {
  const [doc, setDoc] = useState<CompanionDocument | null>(null);
  const [content, setContent] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  const revisionRef = useRef("");
  const pendingRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const aliveRef = useRef(true);
  const nameRef = useRef<string | null>(name);
  nameRef.current = name;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (name === null) {
      setDoc(null);
      setContent("");
      setMarkdown("");
      setSaveState("idle");
      setError(null);
      return;
    }
    let cancelled = false;
    fetchCompanion(name)
      .then((loaded) => {
        if (cancelled || !aliveRef.current) return;
        setDoc(loaded);
        setContent(loaded.markdown);
        setMarkdown(loaded.markdown);
        revisionRef.current = loaded.revision;
        setSaveState("idle");
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  const flush = useCallback(async () => {
    const target = nameRef.current;
    const next = pendingRef.current;
    if (target === null || next === null) return;
    pendingRef.current = null;
    setSaveState("saving");
    try {
      const saved = await saveCompanion(target, next, revisionRef.current);
      revisionRef.current = saved.revision;
      if (pendingRef.current === null) setSaveState("saved");
    } catch (cause: unknown) {
      if (cause instanceof CompanionConflictError) {
        /*
         * The agent rewrote it underneath us. Its copy is newer than the one on
         * screen by definition — it is the answer to something we asked for —
         * so adopt it rather than offering a merge nobody can perform.
         */
        revisionRef.current = cause.current.revision;
        setDoc(cause.current);
        setContent(cause.current.markdown);
        setMarkdown(cause.current.markdown);
        setSaveState("stale");
        return;
      }
      setSaveState("error");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const queue = useCallback(
    (next: string) => {
      setMarkdown(next);
      pendingRef.current = next;
      setSaveState("dirty");
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
    },
    [flush],
  );

  const reload = useCallback(() => {
    const target = nameRef.current;
    if (target === null) return;
    fetchCompanion(target)
      .then((loaded) => {
        if (!aliveRef.current) return;
        setDoc(loaded);
        setContent(loaded.markdown);
        setMarkdown(loaded.markdown);
        revisionRef.current = loaded.revision;
        setSaveState("idle");
      })
      .catch(() => undefined);
  }, []);

  /** A result, or an undo of one, is a new document to load AND to save. */
  const replaceAll = useCallback(
    (next: string) => {
      setContent(next);
      queue(next);
    },
    [queue],
  );

  const sections = useMemo(() => splitSections(markdown), [markdown]);

  return {
    doc,
    content,
    markdown,
    sections,
    saveState,
    error,
    onChange: queue,
    replaceAll,
    reload,
  };
}
