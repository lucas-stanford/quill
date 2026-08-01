import { describe, expect, it } from "vitest";
import { shapeOf, summaryForLostConnection, unreachableTicketPlan } from "./outcome";

describe("summaryForLostConnection", () => {
  it("reports the outcome the reviewer asked for", () => {
    expect(summaryForLostConnection("approved", 2).outcome).toBe("approved");
    expect(summaryForLostConnection("cancelled", 0).outcome).toBe("cancelled");
  });

  it("carries the count of what was left behind", () => {
    expect(summaryForLostConnection("approved", 3).openComments).toBe(3);
  });
});

describe("unreachableTicketPlan", () => {
  it("is unavailable rather than empty-but-available", () => {
    expect(unreachableTicketPlan(new Error("boom")).available).toBe(false);
  });

  it("keeps the underlying reason when there is one", () => {
    expect(unreachableTicketPlan(new Error("fer missing")).reason).toBe("fer missing");
  });

  it("still gives a reason for a non-Error rejection", () => {
    expect(unreachableTicketPlan("nope").reason).toBeTruthy();
  });
});

describe("shapeOf", () => {
  it("counts nothing before the preview arrives", () => {
    expect(shapeOf(null)).toEqual({ epics: 0, tasks: 0 });
  });

  it("separates parents from their children", () => {
    const plan = {
      available: true,
      tickets: [
        { title: "A", level: 2, deps: [] },
        { title: "a1", level: 3, parent: 0, deps: [] },
        { title: "a2", level: 3, parent: 0, deps: [1] },
        { title: "B", level: 2, deps: [] },
      ],
    };
    expect(shapeOf(plan)).toEqual({ epics: 2, tasks: 2 });
  });
});
