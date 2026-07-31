import { describe, expect, it } from "vitest";
import {
  CONTEXT_CHARS,
  FUZZY_MIN_SIMILARITY,
  createAnchor,
  normalizeText,
  prepareDocument,
  resolveAnchor,
} from "./anchor";
import type { TextAnchor } from "../types";

/**
 * The anchor resolver is the load-bearing logic of the annotations lane: a
 * comment that lands on the wrong text is worse than one that is lost, so the
 * cases below are as much about what must NOT match as what must.
 */

const PLAN = [
  "# Migration plan",
  "",
  "We will pause writes during migration. Step 4: run the backfill in batches of",
  "10k rows, then verify counts against the source of truth.",
  "",
  "## Rollback",
  "",
  "If the backfill fails we restore the snapshot taken before the cutover and",
  "reopen writes.",
].join("\n");

function anchorFor(text: string, quote: string): TextAnchor {
  const at = text.indexOf(quote);
  if (at < 0) throw new Error(`test fixture does not contain ${quote}`);
  return createAnchor(text, at, at + quote.length);
}

describe("createAnchor", () => {
  it("stores the quote with a bounded context window and nothing positional", () => {
    const anchor = anchorFor(PLAN, "run the backfill");

    expect(anchor.quote).toBe("run the backfill");
    expect(anchor.prefix.length).toBeLessThanOrEqual(CONTEXT_CHARS);
    expect(anchor.suffix.length).toBeLessThanOrEqual(CONTEXT_CHARS);
    expect(anchor.prefix.endsWith("Step 4: ")).toBe(true);
    expect(Object.keys(anchor).sort()).toEqual(["prefix", "quote", "suffix"]);
  });

  it("captures context at the very start and end of a document", () => {
    const text = "alpha beta";
    expect(createAnchor(text, 0, 5)).toEqual({ quote: "alpha", prefix: "", suffix: " beta" });
    expect(createAnchor(text, 6, 10)).toEqual({ quote: "beta", prefix: "alpha ", suffix: "" });
  });
});

describe("normalizeText", () => {
  it("collapses whitespace, lower-cases, and maps every character back", () => {
    const normalized = normalizeText("  Run   the\nbackfill  ");
    expect(normalized.text).toBe("run the backfill");
    expect(normalized.toRaw).toHaveLength(normalized.text.length);
    // The 'b' of backfill in the raw string.
    expect(normalized.toRaw[normalized.text.indexOf("backfill")]).toBe(12);
  });
});

describe("resolveAnchor — exact", () => {
  it("matches a quote that is still present, byte for byte", () => {
    const anchor = anchorFor(PLAN, "run the backfill");
    const match = resolveAnchor(PLAN, anchor);

    expect(match).not.toBeNull();
    expect(match!.strategy).toBe("context");
    expect(PLAN.slice(match!.start, match!.end)).toBe("run the backfill");
  });

  it("matches across a source line break, since soft wraps carry no meaning", () => {
    const anchor: TextAnchor = {
      quote: "in batches of 10k rows",
      prefix: "run the backfill ",
      suffix: ", then verify counts",
    };
    const match = resolveAnchor(PLAN, anchor);

    expect(match).not.toBeNull();
    expect(PLAN.slice(match!.start, match!.end)).toBe("in batches of\n10k rows");
  });

  it("is not fooled by casing or re-wrapping", () => {
    const anchor = anchorFor(PLAN, "reopen writes");
    const rewrapped = PLAN.replace("reopen writes", "Reopen\n   writes");
    const match = resolveAnchor(rewrapped, anchor);

    expect(match).not.toBeNull();
    expect(rewrapped.slice(match!.start, match!.end)).toBe("Reopen\n   writes");
  });
});

describe("resolveAnchor — duplicate quotes", () => {
  const doc = [
    "Step 1: run the backfill and check the counts.",
    "Step 7: run the backfill again after the cutover.",
  ].join("\n");

  it("picks the occurrence whose context matches", () => {
    const first = createAnchor(doc, doc.indexOf("run the backfill"), doc.indexOf("run the backfill") + 16);
    const secondAt = doc.lastIndexOf("run the backfill");
    const second = createAnchor(doc, secondAt, secondAt + 16);

    const firstMatch = resolveAnchor(doc, first);
    const secondMatch = resolveAnchor(doc, second);

    expect(firstMatch!.start).toBe(doc.indexOf("run the backfill"));
    expect(secondMatch!.start).toBe(secondAt);
  });

  it("still picks the right one after the surrounding sentence is reworded", () => {
    const secondAt = doc.lastIndexOf("run the backfill");
    const anchor = createAnchor(doc, secondAt, secondAt + 16);

    const reworded = [
      "Step 1: run the backfill and check the counts.",
      "Step 7: run the backfill once more, after we have cut over.",
    ].join("\n");

    const match = resolveAnchor(reworded, anchor);
    expect(match).not.toBeNull();
    expect(match!.start).toBe(reworded.lastIndexOf("run the backfill"));
  });

  it("orphans rather than guessing when context cannot separate the candidates", () => {
    const ambiguous = "run the backfill\nrun the backfill";
    const anchor: TextAnchor = { quote: "run the backfill", prefix: "", suffix: "" };
    expect(resolveAnchor(ambiguous, anchor)).toBeNull();
  });
});

describe("resolveAnchor — reworded paragraph", () => {
  it("keeps the anchor when the AI rewrites the text around the quote", () => {
    const anchor = anchorFor(PLAN, "run the backfill");

    // Same quote, an entirely different paragraph around it.
    const revised = [
      "# Migration plan",
      "",
      "Writes stay online throughout the cutover. Once the dual-write is live we",
      "run the backfill from the read replica, one shard at a time, and reconcile",
      "row counts as each shard completes.",
    ].join("\n");

    const match = resolveAnchor(revised, anchor);
    expect(match).not.toBeNull();
    expect(match!.strategy).toBe("quote");
    expect(revised.slice(match!.start, match!.end)).toBe("run the backfill");
  });

  it("recovers a quote that was itself lightly edited", () => {
    const anchor = anchorFor(PLAN, "we restore the snapshot taken before the cutover");
    const revised = PLAN.replace(
      "we restore the snapshot taken before the cutover",
      "we restore the snapshot that was taken before the cutover",
    );

    const match = resolveAnchor(revised, anchor);
    expect(match).not.toBeNull();
    expect(match!.strategy).toBe("fuzzy");
    expect(match!.similarity).toBeGreaterThanOrEqual(FUZZY_MIN_SIMILARITY);
    expect(revised.slice(match!.start, match!.end)).toContain("restore the snapshot");
  });
});

describe("resolveAnchor — orphaning", () => {
  it("orphans when the quoted text is deleted outright", () => {
    const anchor = anchorFor(PLAN, "run the backfill in batches of\n10k rows");
    const gutted = PLAN.replace(
      "Step 4: run the backfill in batches of\n10k rows, then verify counts against the source of truth.",
      "Step 4: swap the DNS record and drain the old cluster.",
    );

    expect(resolveAnchor(gutted, anchor)).toBeNull();
  });

  it("orphans rather than attaching to merely similar text", () => {
    const anchor: TextAnchor = {
      quote: "We will pause writes during migration.",
      prefix: "",
      suffix: "",
    };
    // Same subject, different sentence: below the similarity floor.
    const revised = "We will keep writes online for the whole of the cutover window.";

    expect(resolveAnchor(revised, anchor)).toBeNull();
  });

  it("orphans against an empty document", () => {
    const anchor = anchorFor(PLAN, "run the backfill");
    expect(resolveAnchor("", anchor)).toBeNull();
    expect(resolveAnchor("   \n\n  ", anchor)).toBeNull();
  });

  it("never fuzzy-matches a quote too short to be distinctive", () => {
    const anchor: TextAnchor = { quote: "the", prefix: "run ", suffix: " backfill" };
    expect(resolveAnchor("thy backfill", anchor)).toBeNull();
  });

  it("orphans an empty quote instead of matching everything", () => {
    expect(resolveAnchor(PLAN, { quote: "", prefix: "", suffix: "" })).toBeNull();
    expect(resolveAnchor(PLAN, { quote: "   ", prefix: "", suffix: "" })).toBeNull();
  });
});

describe("resolveAnchor — cost", () => {
  it("resolves a full plan's worth of anchors well inside a frame", () => {
    const document = Array.from(
      { length: 60 },
      (_, i) =>
        `Section ${i}: we will migrate shard ${i} with a dual write, verify the ` +
        `counts, then cut reads over to the new cluster and retire shard ${i}.`,
    ).join("\n\n");

    const prepared = prepareDocument(document);
    const anchors: TextAnchor[] = [];
    for (let i = 0; i < 30; i++) {
      const at = document.indexOf(`retire shard ${i}`);
      anchors.push(createAnchor(document, at, at + 15));
      // An anchor that cannot match, to force the fuzzy path as well.
      anchors.push({
        quote: `decommission the legacy shard ${i} once it is quiet`,
        prefix: "",
        suffix: "",
      });
    }

    const started = performance.now();
    const results = anchors.map((anchor) =>
      resolveAnchor(document, anchor) === null ? "orphan" : "matched",
    );
    const elapsed = performance.now() - started;

    expect(results.filter((r) => r === "matched")).toHaveLength(30);
    expect(results.filter((r) => r === "orphan")).toHaveLength(30);
    expect(elapsed).toBeLessThan(120);
    expect(prepared.text.length).toBeGreaterThan(5000);
  });
});
