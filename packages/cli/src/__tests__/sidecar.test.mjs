import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  EMPTY_SIDECAR_REVISION,
  EMPTY_SIDECAR_TEXT,
  SIDECAR_VERSION,
  corruptBackupPathFor,
  emptySidecar,
  parseSidecar,
  serializeSidecar,
  sidecarPathFor,
  validateSaveAnnotationsRequest,
  validateSidecar,
} from "../sidecar.js";

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

function comment(overrides = {}) {
  return {
    id: "c1",
    anchor: { quote: "ship the thing", prefix: "we will ", suffix: " on Friday" },
    author: "lucas",
    body: "Friday is optimistic.",
    createdAt: "2026-07-31T20:00:00.000Z",
    resolved: false,
    replies: [],
    ...overrides,
  };
}

describe("sidecarPathFor", () => {
  it("replaces a .md extension", () => {
    assert.equal(sidecarPathFor("/work/plans/PLAN.md"), "/work/plans/PLAN.quill.json");
  });

  it("replaces any other extension", () => {
    assert.equal(sidecarPathFor("/work/notes.markdown"), "/work/notes.quill.json");
    assert.equal(sidecarPathFor("/work/notes.MD"), "/work/notes.quill.json");
  });

  it("only replaces the final extension", () => {
    assert.equal(sidecarPathFor("/work/v1.2.plan.md"), "/work/v1.2.plan.quill.json");
  });

  it("appends when there is no extension", () => {
    assert.equal(sidecarPathFor("/work/PLAN"), "/work/PLAN.quill.json");
  });

  it("treats a leading dot as part of the name, not an extension", () => {
    assert.equal(sidecarPathFor("/work/.plan"), "/work/.plan.quill.json");
  });

  it("keeps the sidecar beside the plan", () => {
    assert.equal(sidecarPathFor("/a/b/c/PLAN.md"), "/a/b/c/PLAN.quill.json");
    assert.equal(sidecarPathFor("PLAN.md"), "PLAN.quill.json");
  });

  it("never derives the plan's own path", () => {
    for (const plan of ["/w/PLAN.md", "/w/PLAN.quill.json", "/w/.quill.json", "/w/x"]) {
      assert.notEqual(sidecarPathFor(plan), plan);
    }
  });
});

describe("serializeSidecar / revisions", () => {
  it("hashes exactly the bytes it writes (the GET-after-PUT trap)", () => {
    const sidecar = { version: 1, comments: [comment()] };
    const text = serializeSidecar(sidecar);

    // What a PUT writes and hashes is what a GET reads and hashes.
    assert.equal(sha256(text), sha256(serializeSidecar(sidecar)));
    assert.deepEqual(JSON.parse(text), sidecar);
  });

  it("is stable across calls and ends with a newline", () => {
    const sidecar = { version: 1, comments: [comment()] };
    assert.equal(serializeSidecar(sidecar), serializeSidecar(structuredClone(sidecar)));
    assert.ok(serializeSidecar(sidecar).endsWith("\n"));
  });

  it("agrees with the empty-state constants", () => {
    assert.equal(EMPTY_SIDECAR_TEXT, serializeSidecar(emptySidecar()));
    assert.equal(EMPTY_SIDECAR_REVISION, sha256(EMPTY_SIDECAR_TEXT));
    assert.deepEqual(emptySidecar(), { version: SIDECAR_VERSION, comments: [] });
  });

  it("returns a fresh empty sidecar each time", () => {
    const first = emptySidecar();
    first.comments.push(comment());
    assert.deepEqual(emptySidecar().comments, []);
  });

  it("round-trips through parseSidecar unchanged", () => {
    const sidecar = {
      version: 1,
      comments: [
        comment(),
        comment({
          id: "c2",
          resolved: true,
          orphaned: true,
          replies: [
            { id: "r1", author: "ai", body: "Moved to Monday.", createdAt: "2026-07-31T21:00:00.000Z" },
          ],
        }),
      ],
    };
    const parsed = parseSidecar(serializeSidecar(sidecar));
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.sidecar, sidecar);
    assert.equal(serializeSidecar(parsed.sidecar), serializeSidecar(sidecar));
  });
});

describe("validateSidecar", () => {
  it("accepts a well-formed sidecar", () => {
    const result = validateSidecar({ version: 1, comments: [comment()] });
    assert.equal(result.ok, true);
    assert.equal(result.sidecar.comments.length, 1);
  });

  it("accepts an empty comment list", () => {
    assert.equal(validateSidecar({ version: 1, comments: [] }).ok, true);
  });

  it("rejects a non-object", () => {
    for (const value of [null, 42, "{}", [], undefined]) {
      const result = validateSidecar(value);
      assert.equal(result.ok, false);
      assert.equal(result.problem, "shape");
    }
  });

  it("rejects a missing or non-integer version", () => {
    for (const version of [undefined, "1", 1.5, null]) {
      const result = validateSidecar({ version, comments: [] });
      assert.equal(result.ok, false);
      assert.equal(result.problem, "shape");
      assert.match(result.reason, /version/);
    }
  });

  it("rejects an unknown schema version deliberately", () => {
    const result = validateSidecar({ version: 2, comments: [] });
    assert.equal(result.ok, false);
    assert.equal(result.problem, "version");
    assert.match(result.reason, /unsupported sidecar version 2/);
  });

  it("rejects comments that are not an array", () => {
    const result = validateSidecar({ version: 1, comments: { a: 1 } });
    assert.equal(result.ok, false);
    assert.match(result.reason, /comments must be an array/);
  });

  it("rejects a comment missing a required field, naming it", () => {
    const broken = comment();
    delete broken.createdAt;
    const result = validateSidecar({ version: 1, comments: [broken] });
    assert.equal(result.ok, false);
    assert.match(result.reason, /sidecar\.comments\[0\]\.createdAt must be a string/);
  });

  it("rejects a malformed anchor", () => {
    const result = validateSidecar({
      version: 1,
      comments: [comment({ anchor: { quote: "x", prefix: "y" } })],
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /anchor\.suffix must be a string/);
  });

  it("rejects an offset-style anchor (anchors are text-quote based)", () => {
    const result = validateSidecar({
      version: 1,
      comments: [comment({ anchor: { from: 12, to: 40 } })],
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /anchor\.quote must be a string/);
  });

  it("rejects an empty comment id", () => {
    const result = validateSidecar({ version: 1, comments: [comment({ id: "" })] });
    assert.equal(result.ok, false);
    assert.match(result.reason, /id must not be empty/);
  });

  it("rejects a non-boolean resolved flag", () => {
    const result = validateSidecar({ version: 1, comments: [comment({ resolved: "no" })] });
    assert.equal(result.ok, false);
    assert.match(result.reason, /resolved must be a boolean/);
  });

  it("validates replies", () => {
    const result = validateSidecar({
      version: 1,
      comments: [comment({ replies: [{ id: "r1", author: "a", body: "b" }] })],
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /replies\[0\]\.createdAt must be a string/);
  });

  it("keeps the optional orphaned flag when present and typed", () => {
    const kept = validateSidecar({ version: 1, comments: [comment({ orphaned: true })] });
    assert.equal(kept.ok, true);
    assert.equal(kept.sidecar.comments[0].orphaned, true);

    const absent = validateSidecar({ version: 1, comments: [comment()] });
    assert.equal(absent.ok, true);
    assert.equal("orphaned" in absent.sidecar.comments[0], false);

    const bad = validateSidecar({ version: 1, comments: [comment({ orphaned: "yes" })] });
    assert.equal(bad.ok, false);
    assert.match(bad.reason, /orphaned must be a boolean/);
  });

  it("normalizes away unknown keys so the file matches the version it claims", () => {
    const result = validateSidecar({
      version: 1,
      comments: [comment({ colour: "red" })],
      extra: { nope: true },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(Object.keys(result.sidecar), ["version", "comments"]);
    assert.equal("colour" in result.sidecar.comments[0], false);
  });
});

describe("validateSidecar — general feedback", () => {
  it("keeps feedback about the plan as a whole", () => {
    const result = validateSidecar({
      version: 1,
      comments: [],
      feedback: "Five milestones is too many.",
    });

    assert.equal(result.ok, true);
    assert.equal(result.sidecar.feedback, "Five milestones is too many.");
  });

  it("survives the round trip through the canonical serialization", () => {
    const written = serializeSidecar(
      validateSidecar({ version: 1, comments: [], feedback: "merge M3 into M1" }).sidecar,
    );
    const read = parseSidecar(written);

    assert.equal(read.ok, true);
    assert.equal(read.sidecar.feedback, "merge M3 into M1");
  });

  it("drops empty or whitespace-only feedback rather than writing it", () => {
    // Absent and empty are the same state; writing "" would rewrite every
    // sidecar authored before this field existed, for no change the reviewer
    // made. The key must not appear at all.
    for (const feedback of ["", "   \n\t "]) {
      const result = validateSidecar({ version: 1, comments: [], feedback });
      assert.equal(result.ok, true);
      assert.equal("feedback" in result.sidecar, false);
    }
  });

  it("a sidecar with no feedback key round-trips byte-identically", () => {
    const before = serializeSidecar({ version: 1, comments: [comment()] });
    const after = serializeSidecar(parseSidecar(before).sidecar);

    assert.equal(after, before);
  });

  it("rejects feedback that is not a string, naming the field", () => {
    for (const feedback of [42, true, [], {}]) {
      const result = validateSidecar({ version: 1, comments: [], feedback });
      assert.equal(result.ok, false);
      assert.match(result.reason, /feedback/);
    }
  });
});

describe("parseSidecar", () => {
  it("reports invalid JSON as a syntax problem", () => {
    const result = parseSidecar("{ this is not json");
    assert.equal(result.ok, false);
    assert.equal(result.problem, "syntax");
    assert.match(result.reason, /not valid JSON/);
  });

  it("reports a truncated file as a syntax problem", () => {
    const truncated = serializeSidecar({ version: 1, comments: [comment()] }).slice(0, 60);
    const result = parseSidecar(truncated);
    assert.equal(result.ok, false);
    assert.equal(result.problem, "syntax");
  });

  it("reports valid JSON of the wrong shape as a shape problem", () => {
    const result = parseSidecar('{"version":1,"comments":"none"}');
    assert.equal(result.ok, false);
    assert.equal(result.problem, "shape");
  });

  it("parses the canonical empty sidecar", () => {
    const result = parseSidecar(EMPTY_SIDECAR_TEXT);
    assert.equal(result.ok, true);
    assert.deepEqual(result.sidecar, emptySidecar());
  });
});

describe("validateSaveAnnotationsRequest", () => {
  it("accepts a well-formed body", () => {
    const result = validateSaveAnnotationsRequest({
      sidecar: { version: 1, comments: [comment()] },
      revision: "a".repeat(64),
    });
    assert.equal(result.ok, true);
    assert.equal(result.request.revision, "a".repeat(64));
    assert.equal(result.request.sidecar.comments[0].id, "c1");
  });

  it("rejects a non-object body", () => {
    for (const value of [null, [], "x", 7]) {
      assert.equal(validateSaveAnnotationsRequest(value).ok, false);
    }
  });

  it("rejects a missing or non-string revision", () => {
    const result = validateSaveAnnotationsRequest({ sidecar: emptySidecar() });
    assert.equal(result.ok, false);
    assert.match(result.reason, /revision must be a string/);
  });

  it("rejects a missing or invalid sidecar, naming the field", () => {
    const missing = validateSaveAnnotationsRequest({ revision: "abc" });
    assert.equal(missing.ok, false);
    assert.match(missing.reason, /body\.sidecar must be an object/);

    const invalid = validateSaveAnnotationsRequest({
      revision: "abc",
      sidecar: { version: 1, comments: [{ id: "c1" }] },
    });
    assert.equal(invalid.ok, false);
    assert.match(invalid.reason, /body\.sidecar\.comments\[0\]\.anchor must be an object/);
  });

  it("rejects a body that smuggles a future schema version", () => {
    const result = validateSaveAnnotationsRequest({
      revision: "abc",
      sidecar: { version: 99, comments: [] },
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /unsupported sidecar version 99/);
  });
});

describe("corruptBackupPathFor", () => {
  it("keeps the original name and adds a filesystem-safe timestamp", () => {
    const backup = corruptBackupPathFor(
      "/work/PLAN.quill.json",
      new Date("2026-07-31T21:05:00.123Z"),
    );
    assert.equal(backup, "/work/PLAN.quill.json.corrupt-2026-07-31T21-05-00-123Z");
    assert.equal(backup.includes(":"), false);
  });

  it("never overwrites the sidecar it is rescuing", () => {
    const sidecar = "/work/PLAN.quill.json";
    assert.notEqual(corruptBackupPathFor(sidecar), sidecar);
  });

  it("is not itself a sidecar path for the plan", () => {
    const backup = corruptBackupPathFor("/work/PLAN.quill.json");
    assert.notEqual(backup, sidecarPathFor("/work/PLAN.md"));
  });
});
