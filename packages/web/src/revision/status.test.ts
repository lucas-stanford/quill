import { describe, expect, it } from "vitest";
import {
  NOTHING_TO_SEND,
  canSend,
  describePending,
  isRefusal,
  presentRevision,
  transportFailure,
  updateButtonHint,
} from "./status";

describe("presentRevision", () => {
  it("says what is happening for every status the server can report", () => {
    for (const status of ["idle", "queued", "working", "done", "failed", "cancelled"] as const) {
      const shown = presentRevision(status, null);
      expect(shown.label.length).toBeGreaterThan(0);
    }
  });

  it("marks only the in-flight states as busy, so Cancel is offered exactly then", () => {
    expect(presentRevision("queued", null).busy).toBe(true);
    expect(presentRevision("working", null).busy).toBe(true);
    for (const status of ["idle", "done", "failed", "cancelled"] as const) {
      expect(presentRevision(status, null).busy).toBe(false);
    }
  });

  it("shows the server's own error message rather than a generic one", () => {
    const shown = presentRevision("failed", "copilot: command not found");
    expect(shown.label).toBe("copilot: command not found");
    expect(shown.announcement).toContain("copilot: command not found");
    expect(shown.tone).toBe("error");
  });

  it("still has something to say when a failure arrives with no message", () => {
    const shown = presentRevision("failed", null);
    expect(shown.label).toBe("The revision failed.");
    expect(shown.announcement.length).toBeGreaterThan(0);
  });

  it("announces nothing at rest, so the live region does not chatter", () => {
    expect(presentRevision("idle", null).announcement).toBe("");
  });

  it("tells the user where the revision went", () => {
    expect(presentRevision("done", null).announcement).toMatch(/tracked changes/i);
  });

  it("speaks a refusal in its own words, without blaming the agent", () => {
    const shown = presentRevision("idle", NOTHING_TO_SEND);
    expect(shown.label).toBe(NOTHING_TO_SEND);
    expect(shown.announcement).toBe(NOTHING_TO_SEND);
    expect(shown.tone).toBe("error");
    expect(shown.busy).toBe(false);
    expect(shown.label).not.toMatch(/failed/i);
  });
});

describe("isRefusal", () => {
  it("is a message with no request behind it", () => {
    expect(isRefusal("idle", NOTHING_TO_SEND)).toBe(true);
    expect(isRefusal("idle", null)).toBe(false);
    expect(isRefusal("idle", "   ")).toBe(false);
  });

  it("is never a failure, which the agent did produce", () => {
    expect(isRefusal("failed", "copilot: command not found")).toBe(false);
    expect(isRefusal("working", null)).toBe(false);
  });
});

describe("NOTHING_TO_SEND", () => {
  it("says what to do next, not just what went wrong", () => {
    expect(NOTHING_TO_SEND).toMatch(/instruction/i);
    expect(NOTHING_TO_SEND).toMatch(/accept or reject/i);
  });
});

describe("describePending", () => {
  it("counts what will be sent, in English", () => {
    expect(describePending(0)).toBe("Nothing is pending");
    expect(describePending(1)).toBe("1 comment or edit to send");
    expect(describePending(7)).toBe("7 comments and edits to send");
    expect(describePending(-1)).toBe("Nothing is pending");
  });
});

describe("canSend", () => {
  it("blocks the request that could not change anything", () => {
    expect(canSend(0, "")).toBe(false);
    expect(canSend(0, "   \n ")).toBe(false);
  });

  it("allows an instruction on its own, and pending markup on its own", () => {
    expect(canSend(0, "tighten the rollout section")).toBe(true);
    expect(canSend(3, "")).toBe(true);
  });
});

describe("updateButtonHint", () => {
  it("explains the warning case instead of just refusing", () => {
    expect(updateButtonHint(0)).toMatch(/nothing is pending/i);
    expect(updateButtonHint(0)).toMatch(/instruction/i);
    expect(updateButtonHint(4)).toMatch(/tracked changes/i);
  });

  it("reads as a sentence for one and for many", () => {
    expect(updateButtonHint(1)).toBe(
      "Send 1 comment or edit to the agent and get the rewrite back as tracked changes",
    );
    expect(updateButtonHint(4)).toBe(
      "Send 4 comments and edits to the agent and get the rewrite back as tracked changes",
    );
  });
});

describe("transportFailure", () => {
  it("keeps the server's words and says what they mean", () => {
    // The M1 catch-all answers a missing endpoint with {"error":"Not found"}.
    expect(transportFailure("Not found")).toBe("Could not reach the agent — Not found");
    expect(transportFailure("Failed to read revision state (503)")).toContain(
      "Failed to read revision state (503)",
    );
  });

  it("still says something when the failure has no message", () => {
    expect(transportFailure("   ")).toBe("Could not reach the agent.");
  });
});
