import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  COMPANION_NAMES,
  companionLabel,
  companionPathFor,
  listCompanions,
  readCompanion,
  resolveCompanionName,
} from "../companions.js";
import { makeWorkspace, removeWorkspace } from "./helpers.mjs";

let dir;
let planPath;

before(() => {
  dir = makeWorkspace("companions");
  planPath = join(dir, "PLAN.md");
  writeFileSync(planPath, "# Plan\n");
});

after(() => removeWorkspace(dir));

describe("resolveCompanionName", () => {
  it("accepts the conventional names", () => {
    for (const name of COMPANION_NAMES) {
      assert.equal(resolveCompanionName(name), name);
    }
  });

  it("is case-insensitive but canonicalises to the name on disk", () => {
    // The canonical name is what gets joined onto a path, so a caller can
    // never influence the path even by changing case.
    assert.equal(resolveCompanionName("RESEARCH.MD"), "research.md");
    assert.equal(resolveCompanionName("  Reference.md  "), "reference.md");
  });

  it("refuses anything not on the list — this is the traversal guard", () => {
    const attacks = [
      "../secret.txt",
      "../../etc/passwd",
      "/etc/passwd",
      "....//secret.txt",
      "research.md\u0000",
      "research.md.bak",
      "PLAN.md",
      "",
      "research",
    ];
    for (const attack of attacks) {
      assert.equal(resolveCompanionName(attack), null, attack);
    }
  });

  it("only ever produces a path inside the plan's own directory", () => {
    // The property that matters, stated directly: for every input that is
    // accepted, the path is the plan's directory plus a known filename.
    for (const probe of [...COMPANION_NAMES, "RESEARCH.MD", "../secret.txt", "/etc/passwd"]) {
      const name = resolveCompanionName(probe);
      if (name === null) continue;
      assert.equal(companionPathFor(planPath, name), join(dir, name));
    }
  });
});

describe("companionLabel", () => {
  it("reads as a tab, not a filename", () => {
    assert.equal(companionLabel("research.md"), "Research");
    assert.equal(companionLabel("reference.md"), "Reference");
  });
});

describe("listCompanions", () => {
  it("reports none when the plan stands alone", async () => {
    const bare = makeWorkspace("companions-bare");
    writeFileSync(join(bare, "PLAN.md"), "# Plan\n");

    const list = await listCompanions(join(bare, "PLAN.md"));
    assert.deepEqual(list.documents, []);

    removeWorkspace(bare);
  });

  it("finds companions written after the server started", async () => {
    // Discovery is per request precisely so an agent can still be writing
    // research.md while the reviewer already has the plan open.
    assert.deepEqual((await listCompanions(planPath)).documents, []);

    writeFileSync(join(dir, "research.md"), "# Research\n");
    const after = await listCompanions(planPath);

    assert.equal(after.documents.length, 1);
    assert.equal(after.documents[0].name, "research.md");
    assert.equal(after.documents[0].label, "Research");
    assert.equal(after.documents[0].path, join(dir, "research.md"));
  });

  it("offers them in reading order — research before reference", async () => {
    writeFileSync(join(dir, "reference.md"), "# Reference\n");

    const names = (await listCompanions(planPath)).documents.map((d) => d.name);
    assert.deepEqual(names, ["research.md", "reference.md"]);
  });

  it("never lists a directory that happens to have the name", async () => {
    const trap = makeWorkspace("companions-dir");
    writeFileSync(join(trap, "PLAN.md"), "# Plan\n");
    mkdirSync(join(trap, "research.md"));

    assert.deepEqual((await listCompanions(join(trap, "PLAN.md"))).documents, []);

    removeWorkspace(trap);
  });

  it("never offers the plan itself as its own companion", async () => {
    const self = makeWorkspace("companions-self");
    const asResearch = join(self, "research.md");
    writeFileSync(asResearch, "# I am the plan\n");

    // Reviewing research.md itself: it must not appear as a read-only tab
    // beside its own editor, which would be two views of one file where only
    // one of them updates.
    assert.deepEqual((await listCompanions(asResearch)).documents, []);

    removeWorkspace(self);
  });
});

describe("readCompanion", () => {
  it("returns the file as it is now", async () => {
    writeFileSync(join(dir, "research.md"), "# Research\n\nFirst pass.\n");
    const first = await readCompanion(planPath, "research.md");
    assert.equal(first.ok, true);
    assert.match(first.document.markdown, /First pass/);

    writeFileSync(join(dir, "research.md"), "# Research\n\nSecond pass.\n");
    const second = await readCompanion(planPath, "research.md");
    assert.equal(second.ok, true);
    assert.match(second.document.markdown, /Second pass/);
  });

  it("404s a name that is not a companion, without touching the disk", async () => {
    const result = await readCompanion(planPath, "../secret.txt");
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.match(result.error, /Not a companion document/);
  });

  it("404s a companion that does not exist", async () => {
    const bare = makeWorkspace("companions-missing");
    writeFileSync(join(bare, "PLAN.md"), "# Plan\n");

    const result = await readCompanion(join(bare, "PLAN.md"), "research.md");
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);

    removeWorkspace(bare);
  });
});
