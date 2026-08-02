import { describe, expect, it } from "vitest";
import {
  EDITING_FOCUS_IDLE,
  RIBBON_HIDE_DELAY_MS,
  nextEditingFocus,
  ribbonVisible,
} from "./editingFocus";
import type { EditingFocus, EditingSignal } from "./editingFocus";

function run(...signals: EditingSignal[]): EditingFocus {
  return signals.reduce(nextEditingFocus, EDITING_FOCUS_IDLE);
}

describe("nextEditingFocus", () => {
  it("starts idle — a freshly opened plan has no toolbar", () => {
    expect(EDITING_FOCUS_IDLE).toEqual({ active: false, leaving: false });
  });

  it("shows the moment the caret arrives, with no delay", () => {
    expect(run({ type: "enter" })).toEqual({ active: true, leaving: false });
  });

  it("does not hide the instant focus leaves — it arms the delay", () => {
    const focus = run({ type: "enter" }, { type: "leave" });
    expect(focus.active).toBe(true);
    expect(focus.leaving).toBe(true);
  });

  it("hides once the delay expires", () => {
    expect(run({ type: "enter" }, { type: "leave" }, { type: "settle" })).toEqual(
      EDITING_FOCUS_IDLE,
    );
  });

  /* The anti-flicker property, stated directly. */
  it("never hides when focus comes back inside the delay", () => {
    const focus = run({ type: "enter" }, { type: "leave" }, { type: "enter" });
    expect(focus).toEqual({ active: true, leaving: false });
  });

  it("ignores a settle that arrives after focus came back", () => {
    const focus = run(
      { type: "enter" },
      { type: "leave" },
      { type: "enter" },
      { type: "settle" },
    );
    expect(focus.active).toBe(true);
  });

  it("survives a burst of focus churn without ever leaving the shown state", () => {
    /* editable -> style dropdown -> editable -> button -> editable */
    const states = [
      { type: "enter" },
      { type: "leave" },
      { type: "enter" },
      { type: "leave" },
      { type: "enter" },
      { type: "leave" },
      { type: "enter" },
    ].reduce<EditingFocus[]>(
      (acc, signal) => [...acc, nextEditingFocus(acc[acc.length - 1], signal as EditingSignal)],
      [EDITING_FOCUS_IDLE],
    );
    expect(states.slice(1).every((s) => s.active)).toBe(true);
    expect(states[states.length - 1].leaving).toBe(false);
  });

  it("treats repeated leaves as one departure, so the delay is not extended", () => {
    const once = run({ type: "enter" }, { type: "leave" });
    const twice = nextEditingFocus(once, { type: "leave" });
    /* Identical object: the armed timer keeps running rather than restarting. */
    expect(twice).toBe(once);
  });

  it("does nothing when focus leaves something that was never active", () => {
    expect(run({ type: "leave" })).toBe(EDITING_FOCUS_IDLE);
    expect(run({ type: "settle" })).toBe(EDITING_FOCUS_IDLE);
  });

  it("drops the ribbon immediately on reset, with no grace period to race", () => {
    expect(run({ type: "enter" }, { type: "reset" })).toEqual(EDITING_FOCUS_IDLE);
    expect(run({ type: "enter" }, { type: "leave" }, { type: "reset" })).toEqual(
      EDITING_FOCUS_IDLE,
    );
  });

  it("returns the same object when nothing changed, so the shell does not re-render", () => {
    const active = run({ type: "enter" });
    expect(nextEditingFocus(active, { type: "enter" })).toBe(active);
    expect(nextEditingFocus(active, { type: "settle" })).toBe(active);
    expect(nextEditingFocus(EDITING_FOCUS_IDLE, { type: "reset" })).toBe(EDITING_FOCUS_IDLE);
  });

  it("re-shows after a full hide when the caret comes back", () => {
    const focus = run(
      { type: "enter" },
      { type: "leave" },
      { type: "settle" },
      { type: "enter" },
    );
    expect(focus).toEqual({ active: true, leaving: false });
  });
});

describe("ribbonVisible", () => {
  it("is false until the user is actually editing", () => {
    expect(ribbonVisible(EDITING_FOCUS_IDLE)).toBe(false);
  });

  it("is true with the caret in the surface, with no mode to select first", () => {
    expect(ribbonVisible({ active: true, leaving: false })).toBe(true);
  });

  it("stays visible while a departure is pending — that is what stops the strobe", () => {
    expect(ribbonVisible({ active: true, leaving: true })).toBe(true);
  });

  it("tracks `active` alone, so focus is the only input", () => {
    expect(ribbonVisible({ active: false, leaving: true })).toBe(false);
  });
});

describe("RIBBON_HIDE_DELAY_MS", () => {
  it("is long enough to swallow focus churn and short enough to feel deliberate", () => {
    expect(RIBBON_HIDE_DELAY_MS).toBeGreaterThanOrEqual(150);
    expect(RIBBON_HIDE_DELAY_MS).toBeLessThanOrEqual(400);
  });
});
