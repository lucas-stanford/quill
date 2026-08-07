import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  emptyOptions,
  parseOptions,
  readOptions,
  serializeOptions,
  writeOptions,
} from "../options.js";
import { makeWorkspace, removeWorkspace } from "./helpers.mjs";

const option = (over = {}) => ({ id: "o1", value: "Ironmouth", note: "why", dropped: false, ...over });
const poll = (over = {}) => ({
  id: "p1",
  subject: "name",
  steering: "one word",
  createdAt: "2026-08-06T00:00:00.000Z",
  options: [option()],
  ...over,
});

describe("parseOptions", () => {
  it("reads a well-formed round", () => {
    const manifest = parseOptions({ version: 1, polls: [poll()] });

    assert.equal(manifest.polls.length, 1);
    assert.equal(manifest.polls[0].steering, "one word");
    assert.equal(manifest.polls[0].options[0].value, "Ironmouth");
  });

  it("keeps a dropped candidate — it is what stops the next round repeating it", () => {
    const manifest = parseOptions({
      version: 1,
      polls: [poll({ options: [option({ dropped: true })] })],
    });

    assert.equal(manifest.polls[0].options[0].dropped, true);
  });

  it("drops a candidate with no text, and a round left with none", () => {
    const manifest = parseOptions({
      version: 1,
      polls: [
        poll({ id: "p1", options: [option({ value: "   " })] }),
        poll({ id: "p2", options: [option({ id: "o2", value: "Tallow" })] }),
      ],
    });

    assert.deepEqual(manifest.polls.map((p) => p.id), ["p2"]);
  });

  it("refuses a `chosen` that names nothing", () => {
    // A pick nobody made is worse than no pick: it would render as a decision.
    const manifest = parseOptions({ version: 1, polls: [poll({ chosen: "does-not-exist" })] });

    assert.equal("chosen" in manifest.polls[0], false);
  });

  it("keeps a `chosen` that names a real candidate", () => {
    const manifest = parseOptions({ version: 1, polls: [poll({ chosen: "o1" })] });

    assert.equal(manifest.polls[0].chosen, "o1");
  });

  it("defaults the subject, because most rounds are about a name", () => {
    const manifest = parseOptions({ version: 1, polls: [poll({ subject: undefined })] });

    assert.equal(manifest.polls[0].subject, "name");
  });

  it("survives rubbish entirely", () => {
    for (const value of [null, undefined, 7, "{}", [], { polls: "no" }]) {
      assert.deepEqual(parseOptions(value).polls, []);
    }
  });
});

describe("readOptions / writeOptions", () => {
  it("a missing file is no rounds, not an error", async () => {
    const ws = makeWorkspace("options-missing");
    writeFileSync(join(ws, "PLAN.md"), "# Plan\n");

    const state = await readOptions(join(ws, "PLAN.md"));
    assert.deepEqual(state.manifest, emptyOptions());

    removeWorkspace(ws);
  });

  it("writes on a matching revision and refuses a stale one", async () => {
    const ws = makeWorkspace("options-write");
    const plan = join(ws, "PLAN.md");
    writeFileSync(plan, "# Plan\n");
    mkdirSync(join(ws, "research"), { recursive: true });
    writeFileSync(join(ws, "research", "options.json"), serializeOptions({ version: 1, polls: [poll()] }));

    const before = await readOptions(plan);
    const picked = { version: 1, polls: [poll({ chosen: "o1" })] };

    const written = await writeOptions(plan, picked, before.revision);
    assert.equal(written.ok, true);
    assert.equal(written.state.manifest.polls[0].chosen, "o1");

    const stale = await writeOptions(plan, picked, before.revision);
    assert.equal(stale.ok, false);
    assert.equal(stale.status, 409);

    removeWorkspace(ws);
  });
});

describe("what a poll is about", () => {
  it("keeps a text target, so a pick renames what was asked about", () => {
    const manifest = parseOptions({
      version: 1,
      polls: [
        {
          id: "p1",
          subject: "the courier",
          target: { kind: "text", value: "Vera" },
          options: [{ id: "o1", value: "Juno" }],
        },
      ],
    });

    assert.deepEqual(manifest.polls[0].target, { kind: "text", value: "Vera" });
  });

  it("keeps an explicit title target", () => {
    const manifest = parseOptions({
      version: 1,
      polls: [
        { id: "p1", target: { kind: "title" }, options: [{ id: "o1", value: "Palaver" }] },
      ],
    });

    assert.deepEqual(manifest.polls[0].target, { kind: "title" });
  });

  it("treats a round with no target as a round about the title", () => {
    // Every poll meant the document before targets existed, and a round
    // written by an older quill must keep meaning it.
    const manifest = parseOptions({
      version: 1,
      polls: [{ id: "p1", options: [{ id: "o1", value: "Palaver" }] }],
    });

    assert.equal(manifest.polls[0].target, undefined);
  });

  it("drops a malformed target without losing the candidates beside it", () => {
    for (const target of [{ kind: "text" }, { kind: "text", value: "  " }, { kind: "nope" }, "title"]) {
      const manifest = parseOptions({
        version: 1,
        polls: [{ id: "p1", target, options: [{ id: "o1", value: "Palaver" }] }],
      });

      assert.equal(manifest.polls.length, 1, `round survives ${JSON.stringify(target)}`);
      assert.equal(manifest.polls[0].target, undefined);
    }
  });

  it("survives a write and a read", () => {
    const manifest = parseOptions({
      version: 1,
      polls: [
        {
          id: "p1",
          target: { kind: "text", value: "Vera" },
          options: [{ id: "o1", value: "Juno" }],
        },
      ],
    });

    assert.deepEqual(parseOptions(JSON.parse(serializeOptions(manifest))), manifest);
  });
});
