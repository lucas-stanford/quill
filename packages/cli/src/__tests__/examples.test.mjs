import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  emptyManifest,
  mediaTypeFor,
  parseManifest,
  readManifest,
  resolveMediaPath,
  serializeManifest,
  writeManifest,
} from "../examples.js";
import { makeWorkspace, removeWorkspace } from "./helpers.mjs";

let dir;
let planPath;

before(() => {
  dir = makeWorkspace("examples");
  planPath = join(dir, "PLAN.md");
  writeFileSync(planPath, "# Plan\n");
});

after(() => removeWorkspace(dir));

const entry = (over = {}) => ({
  id: "a",
  title: "Slay the Spire — main menu",
  source: "https://example.com/sts",
  note: "Three buttons, no submenu.",
  image: "menu.png",
  tags: ["main menu"],
  addedAt: "2026-08-05T00:00:00.000Z",
  ...over,
});

describe("parseManifest", () => {
  it("reads a well-formed manifest", () => {
    const manifest = parseManifest({ version: 1, examples: [entry()] });

    assert.equal(manifest.examples.length, 1);
    assert.equal(manifest.examples[0].title, "Slay the Spire — main menu");
    assert.deepEqual(manifest.examples[0].tags, ["main menu"]);
  });

  it("skips a malformed entry instead of taking the gallery down", () => {
    // An agent writes this file. One bad entry losing the whole page would be a
    // worse trade than losing the entry.
    const manifest = parseManifest({
      version: 1,
      examples: [entry(), null, 7, {}, entry({ id: "", image: "x.png" }), entry({ id: "b", image: "" })],
    });

    assert.deepEqual(manifest.examples.map((e) => e.id), ["a"]);
  });

  it("an entry with no picture is not an example", () => {
    // A citation with no screenshot belongs in the research document itself.
    assert.deepEqual(parseManifest({ examples: [entry({ image: "" })] }).examples, []);
  });

  it("falls back to the file name when a title is missing", () => {
    const manifest = parseManifest({ examples: [entry({ title: undefined })] });

    assert.equal(manifest.examples[0].title, "menu.png");
  });

  it("survives rubbish entirely", () => {
    for (const value of [null, undefined, 42, "{}", [], { examples: "no" }]) {
      assert.deepEqual(parseManifest(value).examples, []);
    }
  });
});

describe("readManifest / writeManifest", () => {
  it("a missing manifest is an empty gallery, not an error", async () => {
    const ws = makeWorkspace("examples-missing");
    writeFileSync(join(ws, "PLAN.md"), "# Plan\n");

    const state = await readManifest(join(ws, "PLAN.md"));
    assert.deepEqual(state.manifest, emptyManifest());
    assert.equal(typeof state.revision, "string");

    removeWorkspace(ws);
  });

  it("writes when the revision matches, and refuses when it does not", async () => {
    const ws = makeWorkspace("examples-write");
    const plan = join(ws, "PLAN.md");
    writeFileSync(plan, "# Plan\n");
    mkdirSync(join(ws, "research"), { recursive: true });
    writeFileSync(
      join(ws, "research", "examples.json"),
      serializeManifest({ version: 1, examples: [entry()] }),
    );

    const before = await readManifest(plan);
    const written = await writeManifest(plan, { version: 1, examples: [] }, before.revision);
    assert.equal(written.ok, true);
    assert.deepEqual(written.state.manifest.examples, []);

    // The agent adding examples while a cut is in flight is the routine case.
    const stale = await writeManifest(plan, { version: 1, examples: [] }, before.revision);
    assert.equal(stale.ok, false);
    assert.equal(stale.status, 409);
    assert.ok(stale.current);

    removeWorkspace(ws);
  });
});

describe("resolveMediaPath", () => {
  it("resolves a plain file name inside the media directory", () => {
    assert.equal(
      resolveMediaPath(planPath, "menu.png"),
      join(dir, "research", "examples", "menu.png"),
    );
  });

  it("refuses anything that could leave the directory", () => {
    // Unlike the companions these names come from an agent, not an allowlist,
    // so containment has to be proved rather than assumed.
    const attacks = [
      "../secret.txt",
      "../../secret.txt",
      "/etc/passwd",
      "sub/menu.png",
      "sub\\menu.png",
      "..",
      ".",
      "",
      "menu.png\u0000.txt",
    ];
    for (const attack of attacks) {
      assert.equal(resolveMediaPath(planPath, attack), null, attack);
    }
  });

  it("never returns a path outside the media root, for any of these", () => {
    const root = join(dir, "research", "examples");
    for (const probe of ["menu.png", "a b.png", "shot.webp", "../x.png", "/x.png"]) {
      const resolved = resolveMediaPath(planPath, probe);
      if (resolved === null) continue;
      assert.ok(resolved.startsWith(root), probe);
    }
  });
});

describe("mediaTypeFor", () => {
  it("serves images and nothing else", () => {
    assert.equal(mediaTypeFor("a.png"), "image/png");
    assert.equal(mediaTypeFor("a.JPG"), "image/jpeg");
    assert.equal(mediaTypeFor("a.webp"), "image/webp");
    // The manifest lives in the same tree; this endpoint is not a way to read it.
    assert.equal(mediaTypeFor("examples.json"), null);
    assert.equal(mediaTypeFor("notes.md"), null);
    assert.equal(mediaTypeFor("noextension"), null);
  });
});
