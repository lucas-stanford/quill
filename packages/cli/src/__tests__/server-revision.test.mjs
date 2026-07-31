import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { get, request } from "node:http";
import { join } from "node:path";

import { startServer } from "../server.js";
import { hashContent } from "../hash.js";
import { QUILL_DIR, REQUEST_FILENAME, RESPONSE_FILENAME } from "../revision-protocol.js";
import { FAKE_COPILOT, PROMPT, brief, makeWorkspace, removeWorkspace, waitFor } from "./helpers.mjs";

const PLAN = "# Plan\n\nShip the thing on Friday.\n";
const quiet = { log: () => {}, error: () => {} };

const workspaces = [];
const servers = [];

/** A server on an ephemeral port, torn down after the suite. */
async function serve(name, { mode = "attached", plan = PLAN, ...options } = {}) {
  const dir = makeWorkspace(name);
  workspaces.push(dir);

  const planPath = join(dir, "PLAN.md");
  await writeFile(planPath, plan, "utf-8");

  const webRoot = join(dir, "web");
  await mkdir(webRoot, { recursive: true });
  await writeFile(join(webRoot, "index.html"), "<!doctype html><title>quill</title>", "utf-8");

  const handle = await startServer(planPath, webRoot, 0, {
    mode,
    revisionOptions: { pollIntervalMs: 15, logger: quiet },
    ...options,
  });
  servers.push(handle);

  const base = `http://127.0.0.1:${handle.port}`;
  const api = async (path, init) => {
    const res = await fetch(`${base}${path}`, init);
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null; // not every route answers JSON (405, SPA fallback, static)
    }
    return { status: res.status, headers: res.headers, text, json };
  };

  return { dir, planPath, handle, base, api };
}

/** Collects the raw SSE stream so a plan-changed event can be asserted on. */
function openLiveStream(base) {
  const frames = [];
  return new Promise((fulfill, reject) => {
    const req = get(`${base}/api/live`, (res) => {
      res.setEncoding("utf-8");
      res.on("data", (chunk) => frames.push(chunk));
      fulfill({ frames, close: () => req.destroy(), status: res.statusCode });
    });
    req.on("error", reject);
  });
}

/** A request whose path is sent verbatim — `fetch` would rewrite it. */
function rawGet(port, path) {
  return new Promise((fulfill, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      let body = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => fulfill({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

const postRevision = (api, body = { brief: brief(), prompt: PROMPT }) =>
  api("/api/revision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

after(async () => {
  for (const handle of servers) await handle.close();
  for (const dir of workspaces) removeWorkspace(dir);
});

describe("GET /api/revision", () => {
  it("reports idle and the mode before anything has happened", async () => {
    const { api } = await serve("http-idle", { mode: "attached" });
    const res = await api("/api/revision");
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { id: "", status: "idle", mode: "attached" });
  });

  it("reports detached mode when quill services revisions itself", async () => {
    const { api } = await serve("http-idle-detached", { mode: "detached" });
    assert.equal((await api("/api/revision")).json.mode, "detached");
  });
});

describe("POST /api/revision — attached", () => {
  it("queues the brief for the parent agent and says so", async () => {
    const { dir, api } = await serve("http-post");

    const res = await postRevision(api, {
      brief: brief({ instruction: "Tighten section 3." }),
      prompt: "Tighten section 3 of the plan below.\n",
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.status, "queued");
    assert.equal(res.json.mode, "attached");
    assert.ok(res.json.id.length > 0);

    const queued = JSON.parse(await readFile(join(dir, QUILL_DIR, REQUEST_FILENAME), "utf-8"));
    assert.equal(queued.id, res.json.id);
    assert.equal(queued.brief.instruction, "Tighten section 3.");
    assert.equal(queued.prompt, "Tighten section 3 of the plan below.\n");

    // GET agrees with what POST returned.
    assert.deepEqual((await api("/api/revision")).json, res.json);
  });

  it("refuses a second request with 409 and the state to show", async () => {
    const { api } = await serve("http-conflict");
    const first = await postRevision(api);

    const second = await postRevision(api);
    assert.equal(second.status, 409);
    assert.match(second.json.error, /already queued/);
    assert.equal(second.json.current.id, first.json.id);
    assert.equal(second.json.current.status, "queued");
  });

  it("rejects a malformed brief with the offending field named", async () => {
    const { api } = await serve("http-bad-body");

    const noBrief = await postRevision(api, { markdown: "# Plan\n" });
    assert.equal(noBrief.status, 400);
    assert.match(noBrief.json.error, /Body must be \{ brief: RevisionBrief, prompt: string \}/);

    const noPrompt = await postRevision(api, { brief: brief() });
    assert.equal(noPrompt.status, 400);
    assert.match(noPrompt.json.error, /body\.prompt is missing/);

    const badPrompt = await postRevision(api, { brief: brief(), prompt: 42 });
    assert.equal(badPrompt.status, 400);
    assert.match(badPrompt.json.error, /body\.prompt must be a string/);

    const blankPrompt = await postRevision(api, { brief: brief(), prompt: "   \n" });
    assert.equal(blankPrompt.status, 400);
    assert.match(blankPrompt.json.error, /body\.prompt must not be empty/);

    const badField = await postRevision(api, { brief: { markdown: 3 } });
    assert.equal(badField.status, 400);
    assert.match(badField.json.error, /body\.brief\.markdown must be a string/);

    const badJson = await api("/api/revision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(badJson.status, 400);
    assert.match(badJson.json.error, /Invalid JSON body/);

    // None of that started anything.
    assert.equal((await api("/api/revision")).json.status, "idle");
  });
});

describe("the attached round trip, end to end", () => {
  it("queues, the parent rewrites the plan, the M2 watcher fires, PUT completes it", async () => {
    const { dir, planPath, api, base } = await serve("http-round-trip");
    const live = await openLiveStream(base);
    assert.equal(live.status, 200);

    const started = await postRevision(api);
    assert.equal(started.json.status, "queued");

    // The parent agent picks the request up...
    const queued = JSON.parse(await readFile(join(dir, QUILL_DIR, REQUEST_FILENAME), "utf-8"));
    assert.equal(queued.id, started.json.id);

    // ...rewrites the plan on disk...
    const revised = "# Plan\n\nShip the thing next sprint.\n";
    await writeFile(planPath, revised, "utf-8");

    // ...and the existing M2 watcher pushes it to the browser. No second transport.
    await waitFor(() => live.frames.join("").includes("event: plan-changed"), {
      what: "a plan-changed event on /api/live",
    });
    assert.match(live.frames.join(""), new RegExp(hashContent(revised)));

    // ...then signals completion over HTTP.
    const done = await api("/api/revision", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: started.json.id, status: "done" }),
    });

    assert.equal(done.status, 200);
    assert.equal(done.json.status, "done");
    assert.equal(done.json.markdown, revised);
    assert.equal(existsSync(join(dir, QUILL_DIR, REQUEST_FILENAME)), false);

    live.close();
  });

  it("completes from the response file alone, with no HTTP call at all", async () => {
    const { dir, planPath, api } = await serve("http-file-only");
    const started = await postRevision(api);

    await writeFile(planPath, "# Plan\n\nRewritten by the parent.\n", "utf-8");
    await writeFile(
      join(dir, QUILL_DIR, RESPONSE_FILENAME),
      `{"id":"${started.json.id}","status":"done"}\n`,
      "utf-8",
    );

    const state = await waitFor(
      async () => {
        const res = await api("/api/revision");
        return res.json.status === "done" ? res.json : null;
      },
      { what: "the revision to complete from the response file" },
    );

    assert.equal(state.markdown, "# Plan\n\nRewritten by the parent.\n");
  });

  it("reports the agent's failure to the browser", async () => {
    const { dir, api } = await serve("http-file-failed");
    const started = await postRevision(api);

    await writeFile(
      join(dir, QUILL_DIR, RESPONSE_FILENAME),
      JSON.stringify({ id: started.json.id, status: "failed", error: "the model refused" }),
      "utf-8",
    );

    const state = await waitFor(
      async () => {
        const res = await api("/api/revision");
        return res.json.status === "failed" ? res.json : null;
      },
      { what: "the failure to surface" },
    );
    assert.equal(state.error, "the model refused");
  });
});

describe("PUT /api/revision", () => {
  it("rejects a malformed completion signal", async () => {
    const { api } = await serve("http-put-bad");
    await postRevision(api);

    const res = await api("/api/revision", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "x", status: "finished" }),
    });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /body\.status must be one of/);
  });

  it("is refused in detached mode — quill is the agent there", async () => {
    const { api } = await serve("http-put-detached", {
      mode: "detached",
      revisionOptions: {
        logger: quiet,
        spawnFn: (_command, args, options) =>
          spawn(process.execPath, [FAKE_COPILOT, ...args], {
            ...options,
            env: { ...process.env, FAKE_COPILOT_MODE: "hang" },
          }),
      },
    });

    const started = await postRevision(api);
    const res = await api("/api/revision", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: started.json.id, status: "done", markdown: "# Owned\n" }),
    });

    assert.equal(res.status, 409);
    assert.match(res.json.error, /detached mode/);
    await api("/api/revision", { method: "DELETE" });
  });
});

describe("DELETE /api/revision", () => {
  it("cancels, withdraws the queue file, and answers 204 with no body", async () => {
    const { dir, api } = await serve("http-delete");
    await postRevision(api);
    assert.equal(existsSync(join(dir, QUILL_DIR, REQUEST_FILENAME)), true);

    const res = await api("/api/revision", { method: "DELETE" });
    assert.equal(res.status, 204);
    assert.equal(res.text, "");
    assert.equal(existsSync(join(dir, QUILL_DIR, REQUEST_FILENAME)), false);
    assert.equal((await api("/api/revision")).json.status, "cancelled");

    // And a fresh revision can start straight afterwards.
    assert.equal((await postRevision(api)).status, 200);
    await api("/api/revision", { method: "DELETE" });
  });
});

describe("/api/revision — method handling", () => {
  it("refuses an unsupported method with Allow", async () => {
    const { api } = await serve("http-405");
    const res = await api("/api/revision", { method: "PATCH" });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "GET, POST, PUT, DELETE");
  });
});

describe("POST /api/revision — detached", () => {
  it("runs the agent and returns the revision without writing the plan", async () => {
    const { planPath, dir, api } = await serve("http-detached", {
      mode: "detached",
      revisionOptions: {
        logger: quiet,
        spawnFn: (_command, args, options) =>
          spawn(process.execPath, [FAKE_COPILOT, ...args], { ...options, env: process.env }),
      },
    });

    const started = await postRevision(api);
    assert.equal(started.json.status, "queued");
    assert.equal(started.json.mode, "detached");

    const state = await waitFor(
      async () => {
        const res = await api("/api/revision");
        return res.json.status === "done" ? res.json : null;
      },
      { what: "the detached revision to finish" },
    );

    assert.equal(state.markdown, "# Plan\n\nShip the thing next sprint.\n");
    // PLAN.md is untouched: the browser applies the revision as tracked changes.
    assert.equal(await readFile(planPath, "utf-8"), PLAN);
    assert.equal(existsSync(join(dir, QUILL_DIR)), false);
  });

  it("fails with an actionable message when copilot is not installed", async () => {
    const { api, dir } = await serve("http-detached-enoent", {
      mode: "detached",
      revisionOptions: {
        logger: quiet,
        spawnFn: (_command, args, options) => spawn(join(dir, "no-such-copilot"), args, options),
      },
    });

    await postRevision(api);
    const state = await waitFor(
      async () => {
        const res = await api("/api/revision");
        return res.json.status === "failed" ? res.json : null;
      },
      { what: "the missing CLI to be reported" },
    );

    assert.match(state.error, /"copilot" CLI was not found on PATH/);
  });
});

describe("M1–M3 still work alongside the bridge", () => {
  it("serves the plan, saves it conflict-safely, and keeps the sidecar API", async () => {
    const { planPath, api, handle } = await serve("http-regression");
    const port = handle.port;

    const plan = await api("/api/plan");
    assert.equal(plan.status, 200);
    assert.equal(plan.json.markdown, PLAN);
    assert.equal(plan.json.revision, hashContent(PLAN));

    const stale = await api("/api/plan", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: "# nope\n", revision: "0".repeat(64) }),
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.current.markdown, PLAN);

    const saved = await api("/api/plan", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: "# Plan\n\nEdited by hand.\n", revision: plan.json.revision }),
    });
    assert.equal(saved.status, 200);
    assert.equal(await readFile(planPath, "utf-8"), "# Plan\n\nEdited by hand.\n");

    const annotations = await api("/api/annotations");
    assert.equal(annotations.status, 200);
    assert.deepEqual(annotations.json.sidecar, { version: 1, comments: [] });

    assert.equal((await api("/api/nope")).status, 404);
    assert.equal((await api("/anything")).status, 200); // SPA fallback

    // Traversal, sent raw so no client rewrites it. The URL parser folds the
    // dot segments (encoded or not) before the path ever reaches the file
    // layer, and the guard in resolveStaticPath backstops it — either way the
    // answer is the SPA page, never /etc/passwd.
    for (const attempt of ["/../../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd", "/..%2f..%2fetc/passwd"]) {
      const res = await rawGet(port, attempt);
      assert.ok(!res.body.includes("root:"), `must never serve /etc/passwd via ${attempt}`);
      assert.ok(res.status === 200 || res.status === 403, `${attempt} -> ${res.status}`);
    }
    assert.equal((await rawGet(port, "/%zz")).status, 400);
  });
});
