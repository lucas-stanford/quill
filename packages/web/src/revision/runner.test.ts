import { describe, expect, it, vi } from "vitest";
import type { RevisionBrief, RevisionState } from "../types";
import {
  FIRST_POLL_DELAY_MS,
  MAX_POLL_DELAY_MS,
  MAX_POLL_ERRORS,
  isTerminal,
  pollDelay,
  runRevision,
  timerDelay,
} from "./runner";

const BRIEF: RevisionBrief = { markdown: "# Plan\n", comments: [], edits: [] };

function state(status: RevisionState["status"], extra: Partial<RevisionState> = {}): RevisionState {
  return { id: "r1", status, mode: "attached", ...extra };
}

/** A transport that hands out a scripted sequence of poll results. */
function scripted(first: RevisionState, polls: (RevisionState | Error)[]) {
  const seen: string[] = [];
  let index = 0;
  return {
    seen,
    calls: () => index,
    transport: {
      request: async (brief: RevisionBrief) => {
        seen.push(`request:${brief.markdown.length}`);
        return first;
      },
      poll: async () => {
        const next = polls[Math.min(index, polls.length - 1)];
        index += 1;
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

const noDelay = () => Promise.resolve();

describe("pollDelay", () => {
  it("starts quick and backs off to a cap", () => {
    expect(pollDelay(0)).toBe(FIRST_POLL_DELAY_MS);
    expect(pollDelay(1)).toBeGreaterThan(pollDelay(0));
    expect(pollDelay(4)).toBeGreaterThan(pollDelay(3));
    expect(pollDelay(50)).toBe(MAX_POLL_DELAY_MS);
  });

  it("never returns a negative or runaway delay", () => {
    expect(pollDelay(-3)).toBe(FIRST_POLL_DELAY_MS);
    for (let i = 0; i < 100; i++) {
      expect(pollDelay(i)).toBeGreaterThan(0);
      expect(pollDelay(i)).toBeLessThanOrEqual(MAX_POLL_DELAY_MS);
    }
  });
});

describe("isTerminal", () => {
  it("treats done, failed and cancelled as the end of the run", () => {
    expect(isTerminal("done")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    expect(isTerminal("queued")).toBe(false);
    expect(isTerminal("working")).toBe(false);
    expect(isTerminal("idle")).toBe(false);
  });
});

describe("runRevision", () => {
  it("polls until the revision is done and reports every state on the way", async () => {
    const script = scripted(state("queued"), [
      state("working"),
      state("working"),
      state("done", { markdown: "# Revised\n" }),
    ]);
    const seen: string[] = [];

    const final = await runRevision({
      transport: script.transport,
      brief: BRIEF,
      signal: new AbortController().signal,
      delay: noDelay,
      onState: (s) => seen.push(s.status),
    });

    expect(final?.status).toBe("done");
    expect(final?.markdown).toBe("# Revised\n");
    expect(seen).toEqual(["queued", "working", "working", "done"]);
  });

  it("returns the first response without polling when it is already terminal", async () => {
    const script = scripted(state("done", { markdown: "# Revised\n" }), [state("done")]);

    const final = await runRevision({
      transport: script.transport,
      brief: BRIEF,
      signal: new AbortController().signal,
      delay: noDelay,
    });

    expect(final?.status).toBe("done");
    expect(script.calls()).toBe(0);
  });

  it("stops polling the moment it is aborted, and reports no outcome", async () => {
    const controller = new AbortController();
    const script = scripted(state("queued"), [state("working")]);

    const final = await runRevision({
      transport: script.transport,
      brief: BRIEF,
      signal: controller.signal,
      // Cancel lands while we are waiting between polls, as it does in the UI.
      delay: () => {
        controller.abort();
        return Promise.resolve();
      },
    });

    expect(final).toBeNull();
    expect(script.calls()).toBe(0);
  });

  it("rides out a transient poll failure", async () => {
    const script = scripted(state("working"), [
      new Error("socket hang up"),
      state("done", { markdown: "# Revised\n" }),
    ]);

    const final = await runRevision({
      transport: script.transport,
      brief: BRIEF,
      signal: new AbortController().signal,
      delay: noDelay,
    });

    expect(final?.status).toBe("done");
  });

  it("gives up with the transport's own message when polling keeps failing", async () => {
    const script = scripted(state("working"), [new Error("Failed to read revision state (404)")]);

    await expect(
      runRevision({
        transport: script.transport,
        brief: BRIEF,
        signal: new AbortController().signal,
        delay: noDelay,
      }),
    ).rejects.toThrow("Failed to read revision state (404)");
    expect(script.calls()).toBe(MAX_POLL_ERRORS + 1);
  });

  it("propagates a failed request so the UI can show why", async () => {
    await expect(
      runRevision({
        transport: {
          request: () => Promise.reject(new Error("Failed to request a revision (404)")),
          poll: () => Promise.reject(new Error("unused")),
        },
        brief: BRIEF,
        signal: new AbortController().signal,
        delay: noDelay,
      }),
    ).rejects.toThrow("Failed to request a revision (404)");
  });

  it("carries the server's failure message through", async () => {
    const script = scripted(state("working"), [
      state("failed", { error: "copilot: command not found" }),
    ]);

    const final = await runRevision({
      transport: script.transport,
      brief: BRIEF,
      signal: new AbortController().signal,
      delay: noDelay,
    });

    expect(final?.status).toBe("failed");
    expect(final?.error).toBe("copilot: command not found");
  });

  it("treats a run of idle replies as the request having gone away", async () => {
    const script = scripted(state("queued"), [state("idle"), state("idle"), state("idle")]);

    const final = await runRevision({
      transport: script.transport,
      brief: BRIEF,
      signal: new AbortController().signal,
      delay: noDelay,
    });

    expect(final?.status).toBe("cancelled");
    // Bounded: it does not poll into the void.
    expect(script.calls()).toBeLessThanOrEqual(3);
  });

  it("tolerates a single idle reply racing the server's own bookkeeping", async () => {
    const script = scripted(state("queued"), [
      state("idle"),
      state("working"),
      state("done", { markdown: "# Revised\n" }),
    ]);

    const final = await runRevision({
      transport: script.transport,
      brief: BRIEF,
      signal: new AbortController().signal,
      delay: noDelay,
    });

    expect(final?.status).toBe("done");
  });

  it("gives up on an agent that never answers", async () => {
    const script = scripted(state("working"), [state("working")]);
    let clock = 0;

    await expect(
      runRevision({
        transport: script.transport,
        brief: BRIEF,
        signal: new AbortController().signal,
        delay: noDelay,
        now: () => (clock += 60_000),
        timeoutMs: 120_000,
      }),
    ).rejects.toThrow(/did not answer/);
  });
});

describe("timerDelay", () => {
  it("resolves after the delay", async () => {
    vi.useFakeTimers();
    try {
      const done = vi.fn();
      void timerDelay(500, new AbortController().signal).then(done);
      await vi.advanceTimersByTimeAsync(499);
      expect(done).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      expect(done).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves immediately when the run is abandoned mid-wait", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const done = vi.fn();
      void timerDelay(60_000, controller.signal).then(done);
      controller.abort();
      await Promise.resolve();
      expect(done).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not wait at all when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(timerDelay(60_000, controller.signal)).resolves.toBeUndefined();
  });
});
