import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  QUILL_DIR,
  REQUEST_FILENAME,
  RESPONSE_FILENAME,
  parseAgentResponse,
  parseQueuedRevision,
  quillDirFor,
  resolveRevisionMode,
  revisionRequestPathFor,
  revisionResponsePathFor,
  serializeQueuedRevision,
  validateAgentResponse,
  validateRevisionBrief,
  validateRevisionRequest,
} from "../revision-protocol.js";

describe("bridge paths", () => {
  it("puts the queue beside the plan, in .quill/", () => {
    assert.equal(quillDirFor("/work/plans/PLAN.md"), `/work/plans/${QUILL_DIR}`);
    assert.equal(
      revisionRequestPathFor("/work/plans/PLAN.md"),
      `/work/plans/${QUILL_DIR}/${REQUEST_FILENAME}`,
    );
    assert.equal(
      revisionResponsePathFor("/work/plans/PLAN.md"),
      `/work/plans/${QUILL_DIR}/${RESPONSE_FILENAME}`,
    );
  });

  it("is documented under the names the protocol doc uses", () => {
    assert.equal(QUILL_DIR, ".quill");
    assert.equal(REQUEST_FILENAME, "revision-request.json");
    assert.equal(RESPONSE_FILENAME, "revision-response.json");
  });

  it("works for a relative plan path", () => {
    assert.equal(revisionRequestPathFor("PLAN.md"), `${QUILL_DIR}/${REQUEST_FILENAME}`);
  });
});

describe("serializeQueuedRevision", () => {
  it("is pretty-printed with a trailing newline — a human and jq both read it", () => {
    const queued = {
      id: "abc",
      planPath: "/work/PLAN.md",
      brief: { markdown: "# Plan\n", comments: [], edits: [] },
      createdAt: "2026-07-31T22:00:00.000Z",
    };
    const text = serializeQueuedRevision(queued);
    assert.ok(text.endsWith("\n"));
    assert.ok(text.includes('\n  "planPath": "/work/PLAN.md",'));
    assert.deepEqual(JSON.parse(text), queued);
  });
});

describe("resolveRevisionMode", () => {
  it("defaults to detached — attached is claimed, never inferred", () => {
    const decision = resolveRevisionMode({});
    assert.equal(decision.mode, "detached");
    assert.equal(decision.source, "default");
  });

  it("goes attached when a spawning agent says so", () => {
    for (const env of ["1", "true", "yes", "on", "TRUE"]) {
      const decision = resolveRevisionMode({ env });
      assert.equal(decision.mode, "attached", `QUILL_ATTACHED=${env}`);
      assert.equal(decision.source, "env");
      assert.match(decision.detail, /QUILL_ATTACHED/);
    }
  });

  it("treats an explicitly falsy env var as detached", () => {
    for (const env of ["0", "false", "no", "off", ""]) {
      assert.equal(resolveRevisionMode({ env }).mode, "detached", `QUILL_ATTACHED=${env}`);
    }
  });

  it("lets a flag override the environment in both directions", () => {
    assert.equal(resolveRevisionMode({ env: "0", attachedFlag: true }).mode, "attached");
    assert.equal(resolveRevisionMode({ env: "1", detachedFlag: true }).mode, "detached");
    assert.equal(resolveRevisionMode({ attachedFlag: true }).source, "flag");
  });

  it("refuses to guess when both flags are given", () => {
    assert.throws(
      () => resolveRevisionMode({ attachedFlag: true, detachedFlag: true }),
      /mutually exclusive/,
    );
  });
});

describe("validateRevisionBrief", () => {
  it("accepts a full brief and normalizes it", () => {
    const result = validateRevisionBrief({
      markdown: "# Plan\n",
      comments: [
        {
          quote: "Friday",
          body: "too soon",
          author: "lucas",
          replies: ["agreed"],
          orphaned: true,
          extra: "dropped",
        },
      ],
      edits: [{ kind: "deletion", text: "stretch goal", context: "the migration and a stretch goal" }],
      instruction: "Tighten section 3.",
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.brief, {
      markdown: "# Plan\n",
      comments: [
        { quote: "Friday", body: "too soon", author: "lucas", replies: ["agreed"], orphaned: true },
      ],
      edits: [
        { kind: "deletion", text: "stretch goal", context: "the migration and a stretch goal" },
      ],
      instruction: "Tighten section 3.",
    });
  });

  it("requires the plan text — a brief with no markdown is not a revision", () => {
    const result = validateRevisionBrief({ comments: [], edits: [] });
    assert.equal(result.ok, false);
    assert.match(result.reason, /brief\.markdown must be a string/);
  });

  it("accepts an empty plan and defaults the optional halves", () => {
    const result = validateRevisionBrief({ markdown: "" });
    assert.equal(result.ok, true);
    assert.deepEqual(result.brief, { markdown: "", comments: [], edits: [] });
  });

  it("drops a whitespace-only instruction rather than sending noise to the agent", () => {
    const result = validateRevisionBrief({ markdown: "x", instruction: "   \n" });
    assert.equal(result.ok, true);
    assert.equal("instruction" in result.brief, false);
  });

  it("carries general feedback through to the queue file, note by note", () => {
    // The validated brief is what a parent agent reads out of
    // .quill/revision-request.json, so a field dropped here is a field the
    // reviewer typed and the agent never sees. Notes stay separate: two
    // objections flattened into one string get answered as one.
    const result = validateRevisionBrief({
      markdown: "x",
      feedback: ["This is three milestones pretending to be one.", "No deploy story."],
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.brief.feedback, [
      "This is three milestones pretending to be one.",
      "No deploy story.",
    ]);
  });

  it("keeps feedback and instruction as separate fields", () => {
    const result = validateRevisionBrief({
      markdown: "x",
      feedback: ["standing"],
      instruction: "one-off",
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.brief.feedback, ["standing"]);
    assert.equal(result.brief.instruction, "one-off");
  });

  it("drops whitespace-only notes, and the key when none survive", () => {
    const some = validateRevisionBrief({ markdown: "x", feedback: ["  \n ", "real"] });
    assert.equal(some.ok, true);
    assert.deepEqual(some.brief.feedback, ["real"]);

    const none = validateRevisionBrief({ markdown: "x", feedback: ["  ", ""] });
    assert.equal(none.ok, true);
    assert.equal("feedback" in none.brief, false);
  });

  it("names the offending field, because a human debugs against this", () => {
    const cases = [
      [{ markdown: "x", comments: {} }, /brief\.comments must be an array/],
      [{ markdown: "x", comments: [{ quote: 5 }] }, /brief\.comments\[0\]\.quote must be a string/],
      [
        { markdown: "x", comments: [{ replies: [1] }] },
        /brief\.comments\[0\]\.replies\[0\] must be a string/,
      ],
      [{ markdown: "x", edits: [{ kind: "moved", text: "x" }] }, /must be "insertion" or "deletion"/],
      [{ markdown: "x", edits: [{ kind: "insertion", context: 7 }] }, /edits\[0\]\.context must be a string/],
      [{ markdown: "x", instruction: 3 }, /brief\.instruction must be a string/],
      [{ markdown: "x", feedback: 3 }, /brief\.feedback must be an array/],
      [{ markdown: "x", feedback: [7] }, /brief\.feedback\[0\] must be a string/],
    ];
    for (const [value, pattern] of cases) {
      const result = validateRevisionBrief(value);
      assert.equal(result.ok, false, JSON.stringify(value));
      assert.match(result.reason, pattern);
    }
  });

  it("tolerates a comment that omits its defaults — a missing flag is not a 400", () => {
    const result = validateRevisionBrief({ markdown: "x", comments: [{ quote: "q", body: "b" }] });
    assert.equal(result.ok, true);
    assert.deepEqual(result.brief.comments[0], {
      quote: "q",
      body: "b",
      author: "",
      replies: [],
      orphaned: false,
    });
  });
});

describe("validateRevisionRequest", () => {
  it("accepts { brief, prompt } and keeps the prompt verbatim", () => {
    const prompt = 'Revise this.\n\n"quoted" `backtick` $(whoami)\n';
    const result = validateRevisionRequest({ brief: { markdown: "# Plan\n" }, prompt });
    assert.equal(result.ok, true);
    assert.equal(result.brief.markdown, "# Plan\n");
    assert.equal(result.prompt, prompt);
  });

  it("requires the prompt — the CLI has no formatter to fall back on", () => {
    const result = validateRevisionRequest({ brief: { markdown: "# Plan\n" } });
    assert.equal(result.ok, false);
    assert.match(result.reason, /body\.prompt is missing/);
  });

  it("rejects a blank or non-string prompt", () => {
    for (const prompt of ["", "   \n", 42, [], {}, null]) {
      const result = validateRevisionRequest({ brief: { markdown: "# Plan\n" }, prompt });
      assert.equal(result.ok, false, JSON.stringify(prompt));
      assert.match(result.reason, /body\.prompt/);
    }
  });

  it("rejects anything else", () => {
    for (const value of [null, [], "brief", 42, {}, { brief: null }]) {
      const result = validateRevisionRequest(value);
      assert.equal(result.ok, false, JSON.stringify(value));
    }
  });

  it("blames body.brief when the brief is malformed", () => {
    const result = validateRevisionRequest({ brief: { markdown: 1 } });
    assert.equal(result.ok, false);
    assert.match(result.reason, /body\.brief\.markdown/);
  });
});

describe("the parent agent's response", () => {
  it("accepts the minimal done signal a shell script can write", () => {
    const result = parseAgentResponse('{"id":"abc","status":"done"}\n');
    assert.equal(result.ok, true);
    assert.deepEqual(result.response, { id: "abc", status: "done" });
  });

  it("accepts every documented status", () => {
    for (const status of ["working", "done", "failed", "cancelled"]) {
      assert.equal(validateAgentResponse({ id: "a", status }).ok, true, status);
    }
  });

  it("carries markdown and error when they are given", () => {
    const result = validateAgentResponse({
      id: "a",
      status: "failed",
      error: "model refused",
      markdown: "# Plan\n",
    });
    assert.equal(result.ok, true);
    assert.equal(result.response.error, "model refused");
    assert.equal(result.response.markdown, "# Plan\n");
  });

  it("rejects an unknown status instead of guessing at it", () => {
    const result = validateAgentResponse({ id: "a", status: "finished" });
    assert.equal(result.ok, false);
    assert.match(result.reason, /must be one of "working", "done", "failed", "cancelled"/);
  });

  it("requires a non-empty id — a reply that names no revision is unattributable", () => {
    assert.equal(validateAgentResponse({ status: "done" }).ok, false);
    assert.match(validateAgentResponse({ id: "", status: "done" }).reason, /must not be empty/);
  });

  it("reports a half-written file as bad JSON rather than throwing", () => {
    const result = parseAgentResponse('{"id":"abc","stat');
    assert.equal(result.ok, false);
    assert.match(result.reason, /not valid JSON/);
  });
});

describe("parseQueuedRevision", () => {
  it("round-trips what quill writes", () => {
    const queued = {
      id: "abc",
      planPath: "/work/PLAN.md",
      brief: { markdown: "# Plan\n", comments: [], edits: [] },
      createdAt: "2026-07-31T22:00:00.000Z",
    };
    const parsed = parseQueuedRevision(serializeQueuedRevision(queued));
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.queued, queued);
  });

  it("reports a truncated or foreign queue file", () => {
    assert.equal(parseQueuedRevision("{").ok, false);
    assert.equal(parseQueuedRevision('{"id":"a"}').ok, false);
  });
});
