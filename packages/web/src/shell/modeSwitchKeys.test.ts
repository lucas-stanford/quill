import { describe, expect, it } from "vitest";
import { MODE_ORDER, nextModeForKey } from "./modeSwitchKeys";

describe("nextModeForKey", () => {
  it("moves forward with ArrowRight and ArrowDown, wrapping at the end", () => {
    expect(nextModeForKey("edit", "ArrowRight")).toBe("review");
    expect(nextModeForKey("edit", "ArrowDown")).toBe("review");
    expect(nextModeForKey("review", "ArrowRight")).toBe("edit");
    expect(nextModeForKey("review", "ArrowDown")).toBe("edit");
  });

  it("moves backward with ArrowLeft and ArrowUp, wrapping at the start", () => {
    expect(nextModeForKey("review", "ArrowLeft")).toBe("edit");
    expect(nextModeForKey("review", "ArrowUp")).toBe("edit");
    expect(nextModeForKey("edit", "ArrowLeft")).toBe("review");
    expect(nextModeForKey("edit", "ArrowUp")).toBe("review");
  });

  it("jumps to the ends with Home and End", () => {
    expect(nextModeForKey("review", "Home")).toBe(MODE_ORDER[0]);
    expect(nextModeForKey("edit", "End")).toBe(MODE_ORDER[MODE_ORDER.length - 1]);
  });

  it("ignores keys the radiogroup does not own, so Tab still leaves it", () => {
    for (const key of ["Tab", "Enter", " ", "a", "Escape", "PageDown"]) {
      expect(nextModeForKey("edit", key)).toBeNull();
    }
  });
});
