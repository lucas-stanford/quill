import { describe, expect, it } from "vitest";
import { selectForBrief } from "../annotations/select";
import type { AnnotationsApi } from "../annotations";
import type { TrackedChange, TrackedChangesApi } from "../tracking";
import type { Comment, RevisionBrief } from "../types";
import {
  BRIEF_SOFT_LIMIT_CHARS,
  briefCommentIds,
  buildBrief,
  formatBriefPrompt,
  isBriefEmpty,
  measureBrief,
  pairBriefEdits,
} from "./buildBrief";

/* ── Fixtures ──────────────────────────────────────────────────────────── */

const PLAN = `# Migrate the ingest pipeline to Kafka

## Steps

1. Stand up the Kafka cluster in staging and mirror the existing topics.
2. Dual-write from the current pipeline so both paths carry the same events.
3. Cut consumers over one service at a time, starting with the billing reader.
4. Run the backfill for the 90 day window once consumers are stable.

We will pause writes during migration. The window is short enough that upstream
producers can buffer.

## Rollback

Point the consumers back at the old topics and stop the dual-write.
`;

let seq = 0;

function comment(overrides: Partial<Comment> & { quote?: string }): Comment {
  seq += 1;
  const { quote, ...rest } = overrides;
  return {
    id: `c${seq}`,
    anchor: { quote: quote ?? "", prefix: "", suffix: "" },
    author: "You",
    body: "note",
    createdAt: `2026-07-0${seq}T00:00:00.000Z`,
    resolved: false,
    replies: [],
    ...rest,
  };
}

/** Mirrors useAnnotations: resolved threads never reach the brief, orphans do. */
function annotationsOf(comments: Comment[], feedback = ""): AnnotationsApi {
  return {
    comments,
    orphans: comments.filter((c) => c.orphaned === true),
    addComment: () => {},
    addReply: () => {},
    resolve: () => {},
    resolveMany: () => {},
    remove: () => {},
    activeId: null,
    setActiveId: () => {},
    forBrief: () => selectForBrief(comments),
    feedback,
    setFeedback: () => {},
    sidecar: feedback
      ? { version: 1, comments, feedback }
      : { version: 1, comments },
  };
}

function trackingOf(changes: TrackedChange[]): TrackedChangesApi {
  return {
    changes,
    accept: () => {},
    reject: () => {},
    acceptAll: () => {},
    rejectAll: () => {},
    goToNext: () => {},
    goToPrevious: () => {},
    applyRevision: () => {},
  };
}

let changeSeq = 0;

function change(
  kind: "insertion" | "deletion",
  text: string,
  author: TrackedChange["author"] = "human",
): TrackedChange {
  changeSeq += 1;
  return { id: `tc${changeSeq}`, author, kind, text };
}

function brief(
  comments: Comment[] = [],
  changes: TrackedChange[] = [],
  instruction?: string,
  markdown = PLAN,
): RevisionBrief {
  return buildBrief(markdown, annotationsOf(comments), trackingOf(changes), instruction);
}

/** A brief built with standing feedback in the rail's panel. */
function briefWithFeedback(
  feedback: string,
  comments: Comment[] = [],
  changes: TrackedChange[] = [],
): RevisionBrief {
  return buildBrief(PLAN, annotationsOf(comments, feedback), trackingOf(changes));
}

/* ── Comments ──────────────────────────────────────────────────────────── */

describe("buildBrief — comments", () => {
  it("puts comments in document order, not the order they were made", () => {
    const late = comment({ quote: "Stand up the Kafka cluster", body: "which region?" });
    const early = comment({ quote: "Point the consumers back", body: "how long does this take?" });
    const middle = comment({ quote: "Run the backfill", body: "must be idempotent" });

    const result = brief([early, middle, late]);

    expect(result.comments.map((c) => c.body)).toEqual([
      "which region?",
      "must be idempotent",
      "how long does this take?",
    ]);
  });

  it("excludes resolved threads — settled business never reaches the agent", () => {
    const open = comment({ quote: "Run the backfill", body: "must be idempotent" });
    const settled = comment({
      quote: "Stand up the Kafka cluster",
      body: "already answered",
      resolved: true,
    });

    const result = brief([settled, open]);

    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]!.body).toBe("must be idempotent");
  });

  it("keeps orphans, marks them, and sorts them after the anchored notes", () => {
    const anchored = comment({ quote: "Run the backfill", body: "must be idempotent" });
    const lost = comment({
      quote: "the nightly export job",
      body: "that job was retired",
      orphaned: true,
    });

    const result = brief([lost, anchored]);

    expect(result.comments.map((c) => [c.body, c.orphaned])).toEqual([
      ["must be idempotent", false],
      ["that job was retired", true],
    ]);
  });

  it("never re-attaches an orphan even when its quote is still in the plan", () => {
    const lost = comment({ quote: "Run the backfill", body: "stale note", orphaned: true });
    const anchored = comment({ quote: "Rollback", body: "expand this" });

    const result = brief([lost, anchored]);

    expect(result.comments.map((c) => c.body)).toEqual(["expand this", "stale note"]);
    expect(result.comments[1]!.orphaned).toBe(true);
  });

  it("flattens replies to their bodies, dropping empty ones", () => {
    const thread = comment({
      quote: "Run the backfill",
      body: "must be idempotent",
      author: "lucas",
      replies: [
        { id: "r1", author: "lucas", body: "  and safe to run twice  ", createdAt: "2026-07-09T00:00:00.000Z" },
        { id: "r2", author: "lucas", body: "   ", createdAt: "2026-07-10T00:00:00.000Z" },
        { id: "r3", author: "sam", body: "chunk it by day", createdAt: "2026-07-11T00:00:00.000Z" },
      ],
    });

    const result = brief([thread]);

    expect(result.comments[0]!.replies).toEqual(["and safe to run twice", "chunk it by day"]);
    expect(result.comments[0]!.author).toBe("lucas");
  });

  it("drops a thread with nothing written in it", () => {
    const blank = comment({ quote: "Run the backfill", body: "   " });
    const real = comment({ quote: "Rollback", body: "expand this" });

    expect(brief([blank, real]).comments.map((c) => c.body)).toEqual(["expand this"]);
  });

  it("treats a note with no quote as orphaned — it points at nothing", () => {
    const quoteless = comment({ quote: "   ", body: "the whole plan is too long" });

    expect(brief([quoteless]).comments[0]).toMatchObject({
      quote: "",
      orphaned: true,
      body: "the whole plan is too long",
    });
  });

  it("keeps a long note whole — a truncated note is a lost instruction", () => {
    const long = "x".repeat(5000);
    const wordy = comment({ quote: "Run the backfill", body: long });

    expect(brief([wordy]).comments[0]!.body).toBe(long);
  });
});

/* ── Edits ─────────────────────────────────────────────────────────────── */

describe("buildBrief — edits", () => {
  it("maps tracked changes to edits in document order", () => {
    const result = brief(
      [],
      [
        change("deletion", "We will pause writes during migration."),
        change("insertion", "Producers keep writing throughout."),
      ],
    );

    expect(result.edits.map((e) => [e.kind, e.text])).toEqual([
      ["deletion", "We will pause writes during migration."],
      ["insertion", "Producers keep writing throughout."],
    ]);
  });

  it("leaves the AI's own pending changes out — they are not reviewer decisions", () => {
    const result = brief(
      [],
      [
        change("deletion", "We will pause writes during migration."),
        change("insertion", "A sentence the last revision proposed.", "ai"),
      ],
    );

    expect(result.edits.map((e) => e.text)).toEqual([
      "We will pause writes during migration.",
    ]);
  });

  it("drops a whitespace-only change — it instructs nobody", () => {
    expect(brief([], [change("deletion", "   ")]).edits).toEqual([]);
  });

  it("gives each edit the surrounding plan text as context", () => {
    const result = brief([], [change("deletion", "We will pause writes during migration.")]);

    const context = result.edits[0]!.context ?? "";
    expect(context).toContain("We will pause writes during migration.");
    expect(context).toContain("The window is short enough");
    expect(context).not.toContain("\n");
  });

  it("finds an edit whose text the serializer wrapped across lines", () => {
    const result = brief(
      [],
      [change("deletion", "The window is short enough that upstream producers can buffer.")],
    );

    expect(result.edits[0]!.context).toContain("We will pause writes");
  });

  it("matches the second occurrence of repeated text, not the first twice", () => {
    const markdown = "Alpha. Ship it. Beta. Ship it. Gamma.\n";
    const result = brief(
      [],
      [change("deletion", "Ship it."), change("deletion", "Ship it.")],
      undefined,
      markdown,
    );

    expect(result.edits[0]!.context).toContain("Alpha.");
    expect(result.edits[1]!.context).toContain("Gamma.");
  });

  it("gives both halves of a replacement one shared context", () => {
    const result = brief(
      [],
      [
        change("deletion", "We will pause writes during migration."),
        change("insertion", "We will dual-write during migration."),
      ],
      undefined,
      "Cutover plan.\nWe will pause writes during migration.We will dual-write during migration.\nThen we drain.\n",
    );

    expect(result.edits[0]!.context).toBe(result.edits[1]!.context);
    expect(result.edits[0]!.context).toContain("Cutover plan.");
  });
});

/* ── Replacement pairing ───────────────────────────────────────────────── */

describe("pairBriefEdits", () => {
  const md = "Alpha beta gamma. Delta epsilon zeta. Eta theta iota.\n";

  it("reads a deletion and an insertion that touch as one replacement", () => {
    const edits = brief(
      [],
      [change("deletion", "beta"), change("insertion", "gamma")],
      undefined,
      md,
    ).edits;

    const items = pairBriefEdits(md, edits);

    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("replacement");
  });

  it("leaves an insertion and a deletion at opposite ends of the plan alone", () => {
    const edits = brief(
      [],
      [change("deletion", "Alpha"), change("insertion", "iota")],
      undefined,
      md,
    ).edits;

    const items = pairBriefEdits(md, edits);

    expect(items.map((i) => i.kind)).toEqual(["deletion", "insertion"]);
  });

  it("never pairs two edits of the same kind", () => {
    const edits = brief(
      [],
      [change("deletion", "beta"), change("deletion", "gamma")],
      undefined,
      md,
    ).edits;

    expect(pairBriefEdits(md, edits).map((i) => i.kind)).toEqual(["deletion", "deletion"]);
  });

  it("pairs greedily, so a strike after a retype stays its own decision", () => {
    const edits = brief(
      [],
      [
        change("deletion", "beta"),
        change("insertion", "gamma"),
        change("deletion", "Delta"),
      ],
      undefined,
      md,
    ).edits;

    expect(pairBriefEdits(md, edits).map((i) => i.kind)).toEqual(["replacement", "deletion"]);
  });

  it("keeps an unlocatable edit as itself rather than guessing a partner", () => {
    const edits: RevisionBrief["edits"] = [
      { kind: "deletion", text: "text that is not in the plan at all, nowhere near it" },
      { kind: "insertion", text: "nor is this one, not even approximately, at all" },
    ];

    expect(pairBriefEdits(md, edits).map((i) => i.kind)).toEqual(["deletion", "insertion"]);
  });
});

/* ── Instruction and emptiness ─────────────────────────────────────────── */

describe("buildBrief — instruction", () => {
  it("carries a trimmed freeform note", () => {
    expect(brief([], [], "  tighten the rollback section  ").instruction).toBe(
      "tighten the rollback section",
    );
  });

  it("omits the key entirely when the note is blank or absent", () => {
    expect("instruction" in brief([], [], "   ")).toBe(false);
    expect("instruction" in brief([], [])).toBe(false);
  });

  it("an instruction on its own is a valid brief", () => {
    const only = brief([], [], "make the whole thing half as long");

    expect(only.comments).toEqual([]);
    expect(only.edits).toEqual([]);
    expect(isBriefEmpty(only)).toBe(false);
    expect(formatBriefPrompt(only)).toContain("make the whole thing half as long");
  });
});

describe("buildBrief — general feedback", () => {
  it("carries the rail's standing feedback, trimmed", () => {
    expect(briefWithFeedback("  merge M3 into M1  ").feedback).toBe("merge M3 into M1");
  });

  it("omits the key entirely when the panel is empty or blank", () => {
    expect("feedback" in briefWithFeedback("")).toBe(false);
    expect("feedback" in briefWithFeedback("   \n ")).toBe(false);
  });

  it("feedback on its own is a valid brief — not every objection has a quote", () => {
    const only = briefWithFeedback("This is three milestones pretending to be one.");

    expect(only.comments).toEqual([]);
    expect(only.edits).toEqual([]);
    expect(isBriefEmpty(only)).toBe(false);
    expect(formatBriefPrompt(only)).toContain("three milestones pretending to be one");
  });

  it("is its own section of the prompt, distinct from the update-dialog note", () => {
    const both = buildBrief(
      PLAN,
      annotationsOf([], "the plan never says how it deploys"),
      trackingOf([]),
      "and shorten the rollback",
    );

    expect(both.feedback).toBe("the plan never says how it deploys");
    expect(both.instruction).toBe("and shorten the rollback");

    const prompt = formatBriefPrompt(both);
    expect(prompt).toContain("=== FEEDBACK ON THE PLAN AS A WHOLE ===");
    expect(prompt).toContain("=== NOTE FROM THE REVIEWER ===");
    // One does not overwrite the other: both reach the agent.
    expect(prompt).toContain("the plan never says how it deploys");
    expect(prompt).toContain("and shorten the rollback");
  });

  it("counts toward the brief's measured size", () => {
    const note = "x".repeat(500);

    expect(measureBrief(briefWithFeedback(note)).chars).toBe(
      measureBrief(brief()).chars + 500,
    );
  });
});

describe("briefCommentIds", () => {
  it("is exactly the threads the brief carries, so they can be resolved together", () => {
    const said = comment({ quote: "Rollback", body: "expand this" });
    const silent = comment({ quote: "Steps", body: "   " });
    const settled = comment({ quote: "Kafka", body: "done", resolved: true });

    const ids = briefCommentIds(annotationsOf([said, silent, settled]));

    // The empty thread asked nothing, so nothing answers it; the resolved one
    // never reaches the agent at all.
    expect(ids).toEqual([said.id]);
  });

  it("counts a thread whose instruction is only in a reply", () => {
    const viaReply = comment({
      quote: "Rollback",
      body: "",
      replies: [
        { id: "r1", author: "You", body: "actually, drop this section", createdAt: "2026-07-01T00:00:00.000Z" },
      ],
    });

    expect(briefCommentIds(annotationsOf([viaReply]))).toEqual([viaReply.id]);
  });
});

describe("isBriefEmpty", () => {
  it("is true when the reviewer marked nothing up", () => {
    expect(isBriefEmpty(brief())).toBe(true);
  });

  it("is false for a comment, an edit, a note, or standing feedback alone", () => {
    expect(isBriefEmpty(brief([comment({ quote: "Rollback", body: "expand" })]))).toBe(false);
    expect(isBriefEmpty(brief([], [change("deletion", "Rollback")]))).toBe(false);
    expect(isBriefEmpty(brief([], [], "shorten it"))).toBe(false);
    expect(isBriefEmpty(briefWithFeedback("this is the wrong shape"))).toBe(false);
  });

  it("is true when every thread was resolved before the brief was built", () => {
    const settled = comment({ quote: "Rollback", body: "done", resolved: true });

    expect(isBriefEmpty(brief([settled]))).toBe(true);
  });
});

describe("measureBrief", () => {
  it("counts the reviewer's content without touching it", () => {
    const measure = measureBrief(
      brief([comment({ quote: "Rollback", body: "expand" })], [change("deletion", "Rollback")]),
    );

    expect(measure).toMatchObject({ comments: 1, edits: 1, overSoftLimit: false });
    expect(measure.chars).toBeGreaterThan(PLAN.length);
  });

  it("flags a brief past the soft limit instead of trimming it", () => {
    const huge = `${PLAN}\n${"padding padding padding ".repeat(6000)}`;
    const big = brief([], [], "shorten it", huge);

    expect(measureBrief(big).overSoftLimit).toBe(true);
    expect(big.markdown.length).toBeGreaterThan(BRIEF_SOFT_LIMIT_CHARS);
    expect(big.markdown).toBe(huge);
    expect(formatBriefPrompt(big)).toContain(huge.trimEnd());
  });
});

/* ── The prompt ────────────────────────────────────────────────────────── */

describe("formatBriefPrompt", () => {
  const full = () =>
    brief(
      [
        comment({
          quote: "Run the backfill for the 90 day window",
          body: "this has to be idempotent",
          author: "lucas",
          replies: [
            { id: "r1", author: "lucas", body: "re-running it must be safe", createdAt: "2026-07-20T00:00:00.000Z" },
          ],
        }),
        comment({ quote: "the nightly export job", body: "that job was retired", orphaned: true }),
      ],
      [
        change("deletion", "We will pause writes during migration."),
        change("insertion", "Cut over the billing reader last, not first."),
      ],
      "keep it under two pages",
    );

  it("refuses to render a brief that asks for nothing", () => {
    expect(() => formatBriefPrompt(brief())).toThrow(/empty revision brief/i);
    expect(() => formatBriefPrompt(brief())).toThrow(/isBriefEmpty/);
  });

  it("frames edits as decisions and comments as instructions", () => {
    const prompt = formatBriefPrompt(full());

    expect(prompt).toContain("REVIEWER EDITS — decisions already made");
    expect(prompt).toContain("REVIEWER COMMENTS — instructions to apply");
    expect(prompt).toContain("REVIEWER EDITS ARE DECISIONS ALREADY MADE");
    expect(prompt).toContain("do not argue for it, restore it, or reword it back in");
  });

  it("says the agent is editing a document, not doing the work", () => {
    const prompt = formatBriefPrompt(full());

    expect(prompt).toContain("You are editing a DOCUMENT");
    expect(prompt).toContain("do not run commands");
    expect(prompt).toContain('A note saying "make this idempotent"');
  });

  it("demands the full revised markdown and nothing else, last", () => {
    const prompt = formatBriefPrompt(full());

    expect(prompt).toContain("Return the complete revised plan as Markdown, and nothing else.");
    expect(prompt).toContain("no summary of what");
    expect(prompt).toContain("Do not wrap the reply in a code fence");
    expect(prompt.indexOf("=== YOUR ANSWER ===")).toBeGreaterThan(prompt.indexOf("=== THE PLAN ==="));
    expect(prompt.trimEnd().endsWith("Never reply with a question.")).toBe(true);
  });

  it("carries the plan verbatim between markers", () => {
    const prompt = formatBriefPrompt(full());
    const body = prompt.slice(
      prompt.indexOf("=== BEGIN PLAN ===") + "=== BEGIN PLAN ===\n".length,
      prompt.indexOf("=== END PLAN ==="),
    );

    expect(body.trimEnd()).toBe(PLAN.trimEnd());
  });

  it("tells the agent an orphaned note lost its anchor and needs judgement", () => {
    const prompt = formatBriefPrompt(full());

    expect(prompt).toContain("ORPHANED NOTE");
    expect(prompt).toContain("Use your judgement");
    expect(prompt).toContain("rather than inventing a place for it");
    expect(prompt).toContain('it was attached to: "the nightly export job"');
  });

  it("renders each anchored comment against its quote, with replies", () => {
    const prompt = formatBriefPrompt(full());

    expect(prompt).toContain('On this text: "Run the backfill for the 90 day window"');
    expect(prompt).toContain("lucas says: this has to be idempotent");
    expect(prompt).toContain("then adds: re-running it must be safe");
  });

  it("names the sidecar's placeholder author 'The reviewer', not 'You'", () => {
    const prompt = formatBriefPrompt(brief([comment({ quote: "Rollback", body: "expand this" })]));

    expect(prompt).toContain("The reviewer says: expand this");
    expect(prompt).not.toContain("You says");
  });

  it("renders a replacement as one decision, not two unrelated events", () => {
    const md = "Alpha beta gamma. Delta epsilon.\n";
    const prompt = formatBriefPrompt(
      brief([], [change("deletion", "beta"), change("insertion", "gamma")], undefined, md),
    );

    expect(prompt).toContain("REPLACE — the reviewer typed over the old text");
    expect(prompt).toContain('remove: "beta"');
    expect(prompt).toContain('put in its place: "gamma"');
    expect(prompt).toContain("decisions already made (1)");
    expect(prompt).not.toContain("DELETE — the reviewer struck");
    expect(prompt).not.toContain("INSERT — the reviewer typed");
  });

  it("shows where each standalone edit sits in the plan", () => {
    const prompt = formatBriefPrompt(full());

    expect(prompt).toContain("DELETE — the reviewer struck this text");
    expect(prompt).toContain("INSERT — the reviewer typed this text into the plan");
    expect(prompt).toContain("it sits here:");
  });

  it("says the markup is still showing in the plan rather than applied", () => {
    const prompt = formatBriefPrompt(full());

    expect(prompt).toContain("text they struck is still in the plan and");
    expect(prompt).toContain("text they typed is already in place and you keep it");
  });

  it("gives the reviewer's freeform note the last word over the comments", () => {
    const prompt = formatBriefPrompt(full());

    expect(prompt).toContain("=== NOTE FROM THE REVIEWER ===");
    expect(prompt).toContain("keep it under two pages");
    expect(prompt).toContain("this note is the reviewer's latest");
    expect(prompt).toContain("edits above still stand exactly as written");
  });

  it("omits sections the reviewer left empty", () => {
    const commentsOnly = formatBriefPrompt(
      brief([comment({ quote: "Rollback", body: "expand this" })]),
    );

    expect(commentsOnly).not.toContain("=== REVIEWER EDITS");
    expect(commentsOnly).not.toContain("=== NOTE FROM THE REVIEWER ===");
    expect(commentsOnly).toContain("REVIEWER COMMENTS — instructions to apply (1)");
  });

  it("is deterministic — the same markup renders the same prompt", () => {
    expect(formatBriefPrompt(full())).toBe(formatBriefPrompt(full()));
  });
});
