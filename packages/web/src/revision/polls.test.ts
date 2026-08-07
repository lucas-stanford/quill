import { describe, expect, it } from "vitest";
import type { BriefPoll, RevisionBrief } from "../types";
import { formatBriefPrompt, isBriefEmpty } from "./briefFormat";
import { withPolls } from "./compose";

const PLAN = "# Plan\n\nVera rides west.\n";

function brief(extra: Partial<RevisionBrief> = {}): RevisionBrief {
  return { markdown: PLAN, comments: [], edits: [], ...extra };
}

const TITLE_POLL: BriefPoll = {
  id: "pk1",
  subject: "project name",
  target: { kind: "title" },
};

describe("a naming request in the brief", () => {
  it("is a request worth sending on its own", () => {
    // Asking only for names is the whole point of putting the ask in the
    // brief; refusing it would send the reviewer back to a separate screen.
    expect(isBriefEmpty(brief())).toBe(true);
    expect(isBriefEmpty(brief({ polls: [TITLE_POLL] }))).toBe(false);
  });

  it("sends the candidates to a file, never into the reply or the plan", () => {
    const prompt = formatBriefPrompt(brief({ polls: [TITLE_POLL] }));

    expect(prompt).toContain("research/options.json");
    expect(prompt).toContain("NOT into the plan, and NOT into your reply");
    // The answer contract is the load-bearing rule and must survive the
    // addition: the reply is the document and nothing else.
    expect(prompt).toContain("Return the complete revised plan as Markdown, and nothing else.");
  });

  it("leaves picking to the reviewer", () => {
    const prompt = formatBriefPrompt(brief({ polls: [TITLE_POLL] }));

    expect(prompt).toContain("Do not set `chosen`");
    // Offering is the request. An agent that renames things itself has
    // answered a question nobody asked.
    expect(prompt).toContain("Do not rename anything in the plan yourself");
  });

  it("says what a chosen name will replace", () => {
    const title = formatBriefPrompt(brief({ polls: [TITLE_POLL] }));
    expect(title).toContain("the document's own title");

    const named = formatBriefPrompt(
      brief({
        polls: [{ id: "pk2", subject: "the courier", target: { kind: "text", value: "Vera" } }],
      }),
    );
    expect(named).toContain("every mention of");
    expect(named).toContain("Vera");
    expect(named).toContain('"target": {"kind":"text","value":"Vera"}');
  });

  it("carries the id through, so the answer can be matched to the question", () => {
    expect(formatBriefPrompt(brief({ polls: [TITLE_POLL] }))).toContain("pk1");
  });

  it("carries the steering, and says nothing when there is none", () => {
    expect(
      formatBriefPrompt(brief({ polls: [{ ...TITLE_POLL, steering: "one word, weird west" }] })),
    ).toContain("one word, weird west");
    expect(formatBriefPrompt(brief({ polls: [TITLE_POLL] }))).not.toContain(
      "The reviewer asked for:",
    );
  });

  it("lists what has already been offered so a round cannot repeat itself", () => {
    const prompt = formatBriefPrompt(
      brief({ polls: [{ ...TITLE_POLL, exclude: ["Steel Sunrise", "Ironmouth"] }] }),
    );

    expect(prompt).toContain("do not repeat any of them");
    expect(prompt).toContain("Steel Sunrise");
    expect(prompt).toContain("Ironmouth");
  });

  it("says nothing at all when no names were asked for", () => {
    const prompt = formatBriefPrompt(brief({ instruction: "Tighten the rollout." }));

    expect(prompt).not.toContain("CANDIDATE NAMES");
    expect(prompt).not.toContain("research/options.json");
  });

  it("asks for every request in the round, not just the first", () => {
    const prompt = formatBriefPrompt(
      brief({
        polls: [
          TITLE_POLL,
          { id: "pk2", subject: "the courier", target: { kind: "text", value: "Vera" } },
        ],
      }),
    );

    expect(prompt).toContain("CANDIDATE NAMES (2)");
    expect(prompt).toContain("--- pk1 ---");
    expect(prompt).toContain("--- pk2 ---");
  });
});

describe("withPolls", () => {
  it("attaches the request without rebuilding the brief", () => {
    const base = brief();
    const next = withPolls(base, [TITLE_POLL]);

    expect(next.polls).toEqual([TITLE_POLL]);
    // Everything the plan scan produced is carried across untouched, which is
    // what lets the brief stay memoized while the dialog changes.
    expect(next.markdown).toBe(base.markdown);
    expect(next.comments).toBe(base.comments);
    expect(next.edits).toBe(base.edits);
  });

  it("returns the same object when there is nothing to attach", () => {
    const base = brief();
    expect(withPolls(base, [])).toBe(base);
    expect(withPolls(base, undefined)).toBe(base);
  });

  it("drops a request that is no longer being made", () => {
    const asked = withPolls(brief(), [TITLE_POLL]);

    expect(withPolls(asked, []).polls).toBeUndefined();
  });

  it("copies the list, so a later edit cannot change a brief in flight", () => {
    const asks = [TITLE_POLL];
    const next = withPolls(brief(), asks);
    asks.push({ id: "pk9", subject: "late", target: { kind: "title" } });

    expect(next.polls).toHaveLength(1);
  });
});
