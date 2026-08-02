import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnnotationsApi } from "../annotations";
import type { TrackedChangesApi } from "../tracking";
import type { RevisionState, RevisionStatus } from "../types";
import { cancelRevision, fetchRevision, requestRevision } from "../api";
import { composeBrief, renderPrompt, withInstruction } from "./compose";
import { briefCommentIds } from "./buildBrief";
import { decideApply } from "./applyPlan";
import { runRevision, timerDelay } from "./runner";
import { NOTHING_TO_SEND, transportFailure } from "./status";

export interface UseRevisionOptions {
  enabled: boolean;
  markdown: string;
  annotations: AnnotationsApi;
  tracking: TrackedChangesApi;
}

export interface RevisionApi {
  status: RevisionStatus;
  error: string | null;
  /** Asks the agent for a revision, then applies it as tracked changes. */
  start: (instruction?: string) => void;
  cancel: () => void;
}

/**
 * revision/useRevision.ts
 *
 * FROZEN SIGNATURE — see CONTRACT.md. The round trip: review markup out as a
 * brief, a rewritten plan back, landed in the document as AI-authored tracked
 * changes.
 *
 * Three things this hook is responsible for.
 *
 * **It never writes the rewrite into the document as content.** The only way a
 * revision reaches the page is `tracking.applyRevision`, which diffs it against
 * the live document and applies the result as tracked changes. That is the
 * whole safety model: a bad rewrite is one Reject all away from gone
 * (CONTRACT.md invariant 4). Replacing the document — even with something the
 * agent is confident about — would throw that away.
 *
 * **It applies a revision exactly once.** `GET /api/revision` keeps reporting
 * the same terminal state, so the id of the revision that has been applied is
 * remembered and a repeat is dropped. Applying twice would double every
 * insertion.
 *
 * **It survives the attached-mode reload.** In attached mode the parent agent
 * rewrites PLAN.md on disk, so the M2 watcher fires and `App` reloads the
 * document — replacing the editor's content, and with it every pending tracked
 * change. `App.tsx` and `live/` are frozen, so the reload cannot be blocked
 * from here. Two things make it harmless:
 *
 *   - Winning the race where possible. Polling stays quick (see `runner.ts`),
 *     and the moment the revision is applied the document is dirty, at which
 *     point `App` refuses external reloads outright and reports "File changed
 *     on disk — your edits kept". After that the review is safe.
 *   - Repairing it where not. If the reload got in first, the rewrite is on
 *     screen as plain text with nothing to reject. That is detectable — the
 *     `markdown` App loads us with has changed — so the pre-revision document
 *     is put back and the rewrite is re-applied on top of it as tracked
 *     changes. `decideApply` picks between the two and is unit-tested.
 *
 * The brief goes out with the prompt rendered from it, because the CLI sends
 * that prompt verbatim in detached mode rather than re-deriving it across the
 * package boundary (CONTRACT.md). Building it scans the plan, so the brief is
 * memoized on exactly what it is made of — the markdown, the comments and the
 * changes — and the popover's instruction is attached to that memo rather than
 * costing another scan.
 */
export function useRevision({
  enabled,
  markdown,
  annotations,
  tracking,
}: UseRevisionOptions): RevisionApi {
  const [status, setStatus] = useState<RevisionStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  /** Live values for the async loop, which outlives any one render. */
  const enabledRef = useRef(enabled);
  const markdownRef = useRef(markdown);
  const trackingRef = useRef(tracking);
  enabledRef.current = enabled;
  markdownRef.current = markdown;
  trackingRef.current = tracking;

  const abortRef = useRef<AbortController | null>(null);
  /** The document App had loaded when the request went out. */
  const baselineRef = useRef("");
  /** Id of the revision already in the document; guards against a double apply. */
  const appliedIdRef = useRef<string | null>(null);
  const aliveRef = useRef(true);
  /** Live handle for the async loop, which outlives the render that started it. */
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  /**
   * The threads that went out with the request in flight. They are answered by
   * the revision that comes back, so they are resolved when it lands — see
   * `land`.
   */
  const sentCommentIdsRef = useRef<string[]>([]);

  /**
   * The brief as it stands. Rebuilt when — and only when — the plan, the
   * comments or the tracked changes change: `buildBrief` scans the plan to
   * place the markup in it, and the control above re-renders for reasons
   * (status pills, popover, notice timers) that cannot change what is in the
   * brief.
   */
  const brief = useMemo(
    () => composeBrief(markdown, annotations, tracking),
    [markdown, annotations, tracking],
  );
  const briefRef = useRef(brief);
  briefRef.current = brief;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      // Stop polling. The request itself is left alone: in attached mode it is
      // already queued for the parent agent, and a page reload should not
      // cancel work the user asked for.
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const settle = useCallback((next: RevisionStatus, message: string | null) => {
    if (!aliveRef.current) return;
    setStatus(next);
    setError(message);
  }, []);

  /**
   * Land a finished revision. Everything that reaches the document goes
   * through `tracking`, so a revision is always something the reviewer can
   * walk, accept and reject.
   */
  const land = useCallback(
    (state: RevisionState) => {
      const decision = decideApply({
        id: state.id,
        markdown: state.markdown,
        appliedId: appliedIdRef.current,
        baseline: baselineRef.current,
        current: markdownRef.current,
      });

      if (decision.kind === "empty") {
        settle("failed", "The agent returned an empty revision, so nothing was changed.");
        return;
      }
      if (decision.kind === "skip") {
        settle("done", null);
        return;
      }

      const changes = trackingRef.current;
      if (decision.kind === "rebuild") {
        /*
         * The watcher beat us: the document on screen IS the rewrite, as plain
         * text, and diffing it against itself would produce nothing to review.
         * Turn it back into the pre-revision document first — applying the
         * baseline as tracked changes and accepting them is the only door this
         * lane has to the editor's content, and it keeps the whole repair in
         * the editor's undo history — then land the rewrite on top of it.
         */
        changes.applyRevision(decision.baseline);
        changes.acceptAll();
      }
      changes.applyRevision(decision.markdown);
      appliedIdRef.current = state.id;
      /*
       * The notes that went out have now been answered: the reply is the
       * rewrite sitting on screen as tracked changes. Leaving them open would
       * mean the reviewer has to close by hand every comment the agent already
       * acted on, and `openComments` in the exit summary would report work
       * outstanding that is not.
       *
       * Resolved is not the same as accepted. The tracked changes are still
       * there to walk, and a thread the reviewer disagrees with reopens with
       * one click — which is the point of resolving them here rather than
       * deleting them.
       */
      annotationsRef.current.resolveMany(sentCommentIdsRef.current, true);
      sentCommentIdsRef.current = [];
      settle("done", null);
    },
    [settle],
  );

  const start = useCallback(
    (instruction?: string) => {
      if (!enabledRef.current) return;
      // A second press while the agent is working is a mis-click, not a queue.
      if (abortRef.current) return;

      const brief = withInstruction(briefRef.current, instruction);
      const prompt = renderPrompt(brief);
      if (prompt === null) {
        // Nothing was asked for. No request goes out, so the machine stays
        // idle and the words explain why (see `presentRevision`).
        settle("idle", NOTHING_TO_SEND);
        return;
      }

      baselineRef.current = markdownRef.current;
      sentCommentIdsRef.current = briefCommentIds(annotationsRef.current);
      const controller = new AbortController();
      abortRef.current = controller;
      settle("queued", null);

      runRevision({
        transport: { request: requestRevision, poll: fetchRevision },
        brief,
        prompt,
        signal: controller.signal,
        delay: timerDelay,
        onState: (state) => {
          if (controller.signal.aborted || !aliveRef.current) return;
          // Report progress; terminal states are handled below, once applied.
          if (state.status === "queued" || state.status === "working") {
            setStatus(state.status);
          }
        },
      })
        .then((final) => {
          if (controller.signal.aborted) return;
          abortRef.current = null;
          if (!final) return;
          if (final.status === "done") {
            land(final);
          } else if (final.status === "failed") {
            settle(
              "failed",
              final.error?.trim() || "The agent could not produce a revision.",
            );
          } else {
            settle("cancelled", null);
          }
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          abortRef.current = null;
          // Nothing reached the agent: no endpoint, no server, no network.
          settle(
            "failed",
            transportFailure(cause instanceof Error ? cause.message : String(cause)),
          );
        });
    },
    [land, settle],
  );

  const cancel = useCallback(() => {
    const controller = abortRef.current;
    abortRef.current = null;
    controller?.abort();
    // Best effort: tell the server to drop it. A server without the endpoint is
    // not worth shouting about — locally the run is cancelled either way.
    void cancelRevision().catch(() => undefined);
    settle("cancelled", null);
  }, [settle]);

  return { status, error, start, cancel };
}
