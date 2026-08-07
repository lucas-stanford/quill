/**
 * revision/runner.ts
 *
 * The request/poll loop, with every side effect injected so the whole state
 * machine is testable without a browser, a server or a clock.
 *
 * `useRevision` is a thin React wrapper around `runRevision`: it supplies the
 * real transport (api.ts), a real timer, and decides what to do with the
 * terminal state. Everything about *when* to poll and *when* to stop lives
 * here.
 */

import type { RevisionBrief, RevisionState, RevisionStatus } from "../types";

/** Statuses the server will not move away from. */
export function isTerminal(status: RevisionStatus): boolean {
  return status === "done" || status === "failed" || status === "cancelled";
}

/**
 * Poll schedule. The first poll is quick because a detached run against a fast
 * model can finish in under a second and the user is watching; it then backs
 * off geometrically so a ten-minute agent run does not cost thousands of
 * requests. The cap stays low (2.5 s) on purpose: in attached mode the parent
 * agent rewrites PLAN.md on disk, and the SSE watcher races us to the browser —
 * the sooner we see `done`, the more often the revision lands as tracked
 * changes before anything else can touch the document.
 */
export const FIRST_POLL_DELAY_MS = 350;
export const POLL_BACKOFF = 1.6;
export const MAX_POLL_DELAY_MS = 2500;

/**
 * How long to wait with NOTHING happening before giving up and saying so.
 *
 * Idle, not total. A revision that is being worked on is not a revision that
 * has hung, and a wall-clock budget cannot tell the difference — it fails a
 * careful twelve-minute rewrite for taking twelve minutes. What actually
 * distinguishes the two is silence, so the clock restarts on every sign of
 * life: a status change, a line of commentary, another note dealt with, a new
 * snapshot of the document.
 */
export const REVISION_IDLE_TIMEOUT_MS = 10 * 60_000;

/** Consecutive transport failures tolerated before the run is failed. */
export const MAX_POLL_ERRORS = 4;

/**
 * Consecutive `idle` replies tolerated before concluding the request is gone.
 * One is plausible as a startup race between POST and the first GET; a run of
 * them means the server has forgotten the revision, and polling forever would
 * leave the user staring at a spinner.
 */
export const MAX_IDLE_REPLIES = 2;

export function pollDelay(attempt: number): number {
  const raw = FIRST_POLL_DELAY_MS * POLL_BACKOFF ** Math.max(0, attempt);
  return Math.round(Math.min(raw, MAX_POLL_DELAY_MS));
}

export interface RevisionTransport {
  /**
   * The brief and the prompt rendered from it travel together: the CLI sends
   * the prompt verbatim in detached mode rather than re-deriving it across the
   * package boundary (CONTRACT.md, "The prompt crosses the wire").
   */
  request: (brief: RevisionBrief, prompt: string) => Promise<RevisionState>;
  poll: () => Promise<RevisionState>;
}

/**
 * Whether `next` shows the agent doing something `previous` did not already
 * show. This is what restarts the idle clock, so it has to be true of real work
 * and false of the same state polled again — otherwise a run either never times
 * out or times out while it is working, and both are worse than no timeout.
 */
export function madeProgress(
  previous: RevisionState | null,
  next: RevisionState,
): boolean {
  if (previous === null) return true;
  if (previous.status !== next.status) return true;
  const before = previous.progress;
  const after = next.progress;
  if (after === undefined) return false;
  return before === undefined || after.seq !== before.seq;
}

export interface RunRevisionOptions {
  transport: RevisionTransport;
  brief: RevisionBrief;
  /** `formatBriefPrompt(brief)`; never empty — the caller guards. */
  prompt: string;
  /** Aborted on cancel and on unmount; the loop then resolves with null. */
  signal: AbortSignal;
  /** Injected so tests do not wait. */
  delay: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Every state the server reported, in order. */
  onState?: (state: RevisionState) => void;
  now?: () => number;
  /** Silence tolerated before the run is failed. See REVISION_IDLE_TIMEOUT_MS. */
  timeoutMs?: number;
}

/**
 * Runs one revision to a terminal state.
 *
 * Resolves with the terminal state, or with `null` if it was aborted — an
 * abort is not a failure and must not be reported as one. Throws only when the
 * transport is broken (the endpoint is missing, the server is down): the caller
 * turns that into a legible `failed`.
 */
export async function runRevision({
  transport,
  brief,
  prompt,
  signal,
  delay,
  onState,
  now = () => Date.now(),
  timeoutMs = REVISION_IDLE_TIMEOUT_MS,
}: RunRevisionOptions): Promise<RevisionState | null> {
  /** Reset by every sign of life; the timeout is measured from here. */
  let lastProgressAt = now();

  const first = await transport.request(brief, prompt);
  if (signal.aborted) return null;
  onState?.(first);
  if (isTerminal(first.status)) return first;

  let state = first;
  let attempt = 0;
  let errors = 0;
  let idles = 0;

  for (;;) {
    await delay(pollDelay(attempt), signal);
    if (signal.aborted) return null;

    let next: RevisionState;
    try {
      next = await transport.poll();
      errors = 0;
    } catch (cause) {
      if (signal.aborted) return null;
      errors += 1;
      // A blip while an agent is working is not worth throwing the run away;
      // a persistent one is.
      if (errors > MAX_POLL_ERRORS) throw cause;
      attempt += 1;
      continue;
    }
    if (signal.aborted) return null;

    /*
     * `idle` means the server has no revision for us. Treat a run of them as a
     * cancellation rather than polling into the void.
     */
    if (next.status === "idle") {
      idles += 1;
      if (idles >= MAX_IDLE_REPLIES) {
        const gone: RevisionState = { ...next, id: state.id, status: "cancelled" };
        onState?.(gone);
        return gone;
      }
      attempt += 1;
      continue;
    }
    idles = 0;

    if (madeProgress(state, next)) lastProgressAt = now();
    state = next;
    onState?.(state);
    if (isTerminal(state.status)) return state;

    if (now() - lastProgressAt > timeoutMs) {
      throw new Error(
        `The agent went quiet for ${Math.round(timeoutMs / 60_000)} minutes.`,
      );
    }

    attempt += 1;
  }
}

/** setTimeout as a promise that settles early when the run is abandoned. */
export function timerDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const id = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
    function finish() {
      clearTimeout(id);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}
