import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { RevisionManager, AGENT_COMMAND } from "../revision.js";
import { QUILL_DIR, REQUEST_FILENAME, RESPONSE_FILENAME } from "../revision-protocol.js";
import {
  FAKE_COPILOT,
  PROMPT,
  brief,
  isAlive,
  makeWorkspace,
  removeWorkspace,
  waitFor,
} from "./helpers.mjs";

const PLAN = "# Plan\n\nShip the thing on Friday.\n";
const quiet = { log: () => {}, error: () => {} };
const workspaces = [];

async function workspace(name, plan = PLAN) {
  const dir = makeWorkspace(name);
  workspaces.push(dir);
  const planPath = join(dir, "PLAN.md");
  await writeFile(planPath, plan, "utf-8");
  return { dir, planPath };
}

function attached(planPath, options = {}) {
  return new RevisionManager({
    planPath,
    mode: "attached",
    pollIntervalMs: 15,
    logger: quiet,
    ...options,
  });
}

/**
 * Detached manager wired to the fake copilot. `command` and `args` are recorded
 * exactly as the manager passed them, which is how the argv-not-shell claim is
 * checked.
 */
function detached(planPath, { env = {}, ...options } = {}) {
  const calls = [];
  const manager = new RevisionManager({
    planPath,
    mode: "detached",
    logger: quiet,
    spawnFn: (command, args, spawnOptions) => {
      calls.push({ command, args });
      return spawn(process.execPath, [FAKE_COPILOT, ...args], {
        ...spawnOptions,
        env: { ...process.env, ...env },
      });
    },
    ...options,
  });
  return { manager, calls };
}

const requestPath = (dir) => join(dir, QUILL_DIR, REQUEST_FILENAME);
const responsePath = (dir) => join(dir, QUILL_DIR, RESPONSE_FILENAME);

async function respond(dir, response) {
  // Rename into place, as the protocol doc tells a parent agent to.
  const tmp = join(dir, QUILL_DIR, "response.tmp");
  await mkdir(join(dir, QUILL_DIR), { recursive: true });
  await writeFile(tmp, `${JSON.stringify(response)}\n`, "utf-8");
  await rm(responsePath(dir), { force: true });
  await writeFile(responsePath(dir), readFileSync(tmp, "utf-8"), "utf-8");
  await rm(tmp, { force: true });
}

const settled = (manager, statuses = ["done", "failed", "cancelled"]) =>
  waitFor(
    () => (statuses.includes(manager.getState().status) ? manager.getState() : null),
    { what: `revision to reach ${statuses.join("/")}`, timeout: 10_000 },
  );

after(() => {
  for (const dir of workspaces) removeWorkspace(dir);
});

describe("RevisionManager — shared behaviour", () => {
  it("starts idle, reporting the mode it is in", async () => {
    const { planPath } = await workspace("idle");
    assert.deepEqual(attached(planPath).getState(), { id: "", status: "idle", mode: "attached" });
    assert.deepEqual(detached(planPath).manager.getState(), {
      id: "",
      status: "idle",
      mode: "detached",
    });
  });

  it("refuses a second revision while one is in flight rather than racing it", async () => {
    const { dir, planPath } = await workspace("single-flight");
    const manager = attached(planPath);

    const first = await manager.start(brief(), PROMPT);
    assert.equal(first.ok, true);

    const second = await manager.start(brief({ instruction: "and again" }), PROMPT);
    assert.equal(second.ok, false);
    assert.equal(second.status, 409);
    assert.match(second.error, /already queued/);
    assert.equal(second.current.id, first.state.id);

    // The first request is untouched — the refusal did not clobber the queue.
    const queued = JSON.parse(await readFile(requestPath(dir), "utf-8"));
    assert.equal(queued.id, first.state.id);
    assert.equal(queued.brief.instruction, undefined);

    await manager.cancel();
  });

  it("allows a new revision once the previous one has settled", async () => {
    const { dir, planPath } = await workspace("sequential");
    const manager = attached(planPath);

    const first = await manager.start(brief(), PROMPT);
    await respond(dir, { id: first.state.id, status: "done" });
    await settled(manager);

    const second = await manager.start(brief(), PROMPT);
    assert.equal(second.ok, true);
    assert.notEqual(second.state.id, first.state.id);
    await manager.cancel();
  });
});

describe("RevisionManager — attached mode", () => {
  it("writes exactly a QueuedRevision to .quill/revision-request.json", async () => {
    const { dir, planPath } = await workspace("queue-file");
    const manager = attached(planPath);

    const started = await manager.start(
      brief({
        comments: [
          { quote: "Friday", body: "too soon", author: "lucas", replies: [], orphaned: false },
        ],
        edits: [{ kind: "deletion", text: "stretch goal" }],
        instruction: "Tighten it.",
      }),
      PROMPT,
    );

    assert.equal(started.ok, true);
    assert.equal(started.state.status, "queued");
    assert.equal(started.state.mode, "attached");
    assert.equal(started.state.markdown, undefined);

    const raw = await readFile(requestPath(dir), "utf-8");
    assert.ok(raw.endsWith("\n"), "queue file ends with a newline");

    const queued = JSON.parse(raw);
    assert.deepEqual(
      Object.keys(queued).sort(),
      ["brief", "createdAt", "id", "planPath", "prompt"],
      "the frozen QueuedRevision shape plus the additive rendered prompt",
    );
    assert.equal(queued.id, started.state.id);
    assert.equal(queued.planPath, planPath);
    assert.equal(queued.brief.markdown, PLAN);
    assert.equal(queued.brief.comments.length, 1);
    assert.equal(queued.brief.edits[0].kind, "deletion");
    assert.equal(queued.brief.instruction, "Tighten it.");
    assert.ok(!Number.isNaN(Date.parse(queued.createdAt)));
    assert.equal(queued.prompt, PROMPT);

    await manager.cancel();
  });

  it("carries the browser's rendered prompt into the queue file", async () => {
    const { dir, planPath } = await workspace("queue-prompt");
    const manager = attached(planPath);
    const prompt = 'Do the thing.\n\n"quoted" `tick` $(id)\n';

    await manager.start(brief(), prompt);

    const queued = JSON.parse(await readFile(requestPath(dir), "utf-8"));
    assert.equal(queued.prompt, prompt, "verbatim — quill does not re-render it");

    await manager.cancel();
  });

  it("does not call an agent — the parent is the agent", async () => {
    const { planPath } = await workspace("no-spawn");
    let spawned = 0;
    const manager = attached(planPath, {
      spawnFn: () => {
        spawned += 1;
        throw new Error("attached mode must never spawn");
      },
    });

    await manager.start(brief(), PROMPT);
    assert.equal(spawned, 0);
    assert.equal(manager.getState().status, "queued");
    await manager.cancel();
  });

  it("completes when the parent writes a done response, handing back the plan on disk", async () => {
    const { dir, planPath } = await workspace("attached-done");
    const manager = attached(planPath);
    const started = await manager.start(brief(), PROMPT);

    // The parent rewrites the plan — this is what the M2 watcher broadcasts.
    const revised = "# Plan\n\nShip the thing next sprint.\n";
    await writeFile(planPath, revised, "utf-8");
    await respond(dir, { id: started.state.id, status: "done" });

    const state = await settled(manager);
    assert.equal(state.status, "done");
    assert.equal(state.id, started.state.id);
    assert.equal(state.markdown, revised);
    assert.equal(state.error, undefined);

    // Both files are consumed, so a polling parent sees no stale work.
    await waitFor(() => !existsSync(requestPath(dir)), { what: "the request file to be cleared" });
    assert.equal(existsSync(responsePath(dir)), false);
  });

  it("prefers markdown the parent supplied over re-reading the file", async () => {
    const { dir, planPath } = await workspace("attached-markdown");
    const manager = attached(planPath);
    const started = await manager.start(brief(), PROMPT);

    await respond(dir, { id: started.state.id, status: "done", markdown: "# From the agent\n" });

    const state = await settled(manager);
    assert.equal(state.status, "done");
    assert.equal(state.markdown, "# From the agent\n");
    // And quill still did not touch the plan.
    assert.equal(await readFile(planPath, "utf-8"), PLAN);
  });

  it("surfaces the parent's failure message to the reviewer", async () => {
    const { dir, planPath } = await workspace("attached-failed");
    const manager = attached(planPath);
    const started = await manager.start(brief(), PROMPT);

    await respond(dir, { id: started.state.id, status: "failed", error: "the model refused" });

    const state = await settled(manager);
    assert.equal(state.status, "failed");
    assert.equal(state.error, "the model refused");
    assert.equal(existsSync(requestPath(dir)), false);
  });

  it("still says something useful when the parent fails with no reason", async () => {
    const { dir, planPath } = await workspace("attached-failed-bare");
    const manager = attached(planPath);
    const started = await manager.start(brief(), PROMPT);

    await respond(dir, { id: started.state.id, status: "failed" });

    const state = await settled(manager);
    assert.equal(state.status, "failed");
    assert.match(state.error, /reported a failure but gave no reason/);
  });

  it("treats a working response as a heartbeat, not a completion", async () => {
    const { dir, planPath } = await workspace("attached-heartbeat");
    const manager = attached(planPath, { timeoutMs: 250 });
    const started = await manager.start(brief(), PROMPT);

    await respond(dir, { id: started.state.id, status: "working" });
    await waitFor(() => manager.getState().status === "working", { what: "the working heartbeat" });

    // The heartbeat restarted the clock: still working well past the original
    // 250ms deadline measured from the request.
    await respond(dir, { id: started.state.id, status: "working" });
    await new Promise((fulfill) => setTimeout(fulfill, 150));
    await respond(dir, { id: started.state.id, status: "working" });
    assert.equal(manager.getState().status, "working");

    await respond(dir, { id: started.state.id, status: "done" });
    assert.equal((await settled(manager)).status, "done");
  });

  it("ignores a response for a revision that is not in flight", async () => {
    const { dir, planPath } = await workspace("attached-stale-id");
    const manager = attached(planPath);
    const started = await manager.start(brief(), PROMPT);

    await respond(dir, { id: "some-other-revision", status: "done" });
    await waitFor(() => !existsSync(responsePath(dir)), { what: "the stale reply to be consumed" });

    assert.equal(manager.getState().status, "queued");

    await respond(dir, { id: started.state.id, status: "done" });
    assert.equal((await settled(manager)).status, "done");
  });

  it("waits out a half-written response instead of failing on it", async () => {
    const { dir, planPath } = await workspace("attached-partial");
    const manager = attached(planPath);
    const started = await manager.start(brief(), PROMPT);

    // A parent that redirects into the file gets caught mid-write.
    await mkdir(join(dir, QUILL_DIR), { recursive: true });
    await writeFile(responsePath(dir), '{"id":"', "utf-8");
    await new Promise((fulfill) => setTimeout(fulfill, 30));
    assert.equal(manager.getState().status, "queued");

    await writeFile(responsePath(dir), `{"id":"${started.state.id}","status":"done"}`, "utf-8");
    assert.equal((await settled(manager)).status, "done");
  });

  it("fails clearly when the same unreadable response persists", async () => {
    const { dir, planPath } = await workspace("attached-garbage");
    const manager = attached(planPath);
    await manager.start(brief(), PROMPT);

    await mkdir(join(dir, QUILL_DIR), { recursive: true });
    await writeFile(responsePath(dir), "not json at all", "utf-8");

    const state = await settled(manager);
    assert.equal(state.status, "failed");
    assert.match(state.error, new RegExp(`unreadable ${QUILL_DIR}/${RESPONSE_FILENAME}`));
    assert.match(state.error, /not valid JSON/);
  });

  it("fails with instructions when no agent ever picks the request up", async () => {
    const { dir, planPath } = await workspace("attached-timeout");
    const manager = attached(planPath, { timeoutMs: 80 });
    await manager.start(brief(), PROMPT);

    const state = await settled(manager);
    assert.equal(state.status, "failed");
    assert.match(state.error, /No agent picked up the revision within 0s|within \d+s/);
    assert.match(state.error, new RegExp(`${QUILL_DIR}/${REQUEST_FILENAME}`));
    assert.match(state.error, /--detached/);
    // The abandoned request is withdrawn, not left for a parent to find later.
    assert.equal(existsSync(requestPath(dir)), false);
  });

  it("withdraws the request on cancel — the file vanishing is the cancel signal", async () => {
    const { dir, planPath } = await workspace("attached-cancel");
    const manager = attached(planPath);
    await manager.start(brief(), PROMPT);
    assert.equal(existsSync(requestPath(dir)), true);

    await manager.cancel();

    assert.equal(existsSync(requestPath(dir)), false);
    assert.equal(manager.getState().status, "cancelled");
  });

  it("clears back to idle when cancelling with nothing in flight", async () => {
    const { dir, planPath } = await workspace("attached-cancel-idle");
    const manager = attached(planPath);
    const started = await manager.start(brief(), PROMPT);
    await respond(dir, { id: started.state.id, status: "done" });
    await settled(manager);

    await manager.cancel();
    assert.deepEqual(manager.getState(), { id: "", status: "idle", mode: "attached" });
  });

  it("accepts the same payload over PUT, for an agent that would rather curl", async () => {
    const { dir, planPath } = await workspace("attached-put");
    const manager = attached(planPath);
    const started = await manager.start(brief(), PROMPT);

    await writeFile(planPath, "# Plan\n\nCurled.\n", "utf-8");
    const submitted = await manager.submitAgentResponse({ id: started.state.id, status: "done" });

    assert.equal(submitted.ok, true);
    assert.equal(submitted.state.status, "done");
    assert.equal(submitted.state.markdown, "# Plan\n\nCurled.\n");
    assert.equal(existsSync(requestPath(dir)), false);
  });

  it("rejects a PUT for the wrong revision, or for none", async () => {
    const { planPath } = await workspace("attached-put-wrong");
    const manager = attached(planPath);

    const none = await manager.submitAgentResponse({ id: "x", status: "done" });
    assert.equal(none.ok, false);
    assert.equal(none.status, 404);

    const started = await manager.start(brief(), PROMPT);
    const wrong = await manager.submitAgentResponse({ id: "not-the-one", status: "done" });
    assert.equal(wrong.ok, false);
    assert.equal(wrong.status, 409);
    assert.match(wrong.error, new RegExp(started.state.id));

    await manager.cancel();
  });

  it("clears a request left behind by a dead session, but not another plan's", async () => {
    const { dir, planPath } = await workspace("sweep");
    const other = join(dir, "OTHER.md");

    await mkdir(join(dir, QUILL_DIR), { recursive: true });
    const stale = {
      id: "old",
      planPath,
      brief: { markdown: "# Plan\n", comments: [], edits: [] },
      createdAt: "2026-07-31T20:00:00.000Z",
    };
    await writeFile(requestPath(dir), JSON.stringify(stale), "utf-8");

    await attached(planPath).sweepStaleRequest();
    assert.equal(existsSync(requestPath(dir)), false);

    // A request belonging to a different plan in the same directory is left alone.
    await writeFile(requestPath(dir), JSON.stringify({ ...stale, planPath: other }), "utf-8");
    await attached(planPath).sweepStaleRequest();
    assert.equal(existsSync(requestPath(dir)), true);
    await rm(requestPath(dir), { force: true });
  });

  it("clears an unreadable leftover queue file too", async () => {
    const { dir, planPath } = await workspace("sweep-garbage");
    await mkdir(join(dir, QUILL_DIR), { recursive: true });
    await writeFile(requestPath(dir), "{ truncated", "utf-8");

    await attached(planPath).sweepStaleRequest();
    assert.equal(existsSync(requestPath(dir)), false);
  });

  it("removes the queue file on a synchronous shutdown", async () => {
    const { dir, planPath } = await workspace("attached-shutdown");
    const manager = attached(planPath);
    await manager.start(brief(), PROMPT);

    manager.shutdownSync();
    assert.equal(existsSync(requestPath(dir)), false);
  });
});

describe("RevisionManager — detached mode", () => {
  it("runs the agent and returns the revision without touching the plan", async () => {
    const { dir, planPath } = await workspace("detached-done");
    const { manager, calls } = detached(planPath);

    await manager.start(brief(), PROMPT);
    const state = await settled(manager);

    assert.equal(state.status, "done");
    assert.equal(state.mode, "detached");
    assert.equal(state.markdown, "# Plan\n\nShip the thing next sprint.\n");

    // The whole point: the model's output is never written to disk.
    assert.equal(await readFile(planPath, "utf-8"), PLAN);
    assert.equal(existsSync(join(dir, QUILL_DIR)), false);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, AGENT_COMMAND);
    assert.equal(calls[0].args[0], "-p");
  });

  it("passes the prompt as one argv element, never through a shell", async () => {
    const { dir, planPath } = await workspace("detached-injection");
    const argvFile = join(dir, "argv.json");
    // What a browser would render from hostile reviewer text: the prompt is the
    // string that actually reaches argv, so it is the injection surface.
    const hostile = `Revise this.\n\n"; touch ${join(dir, "pwned")}; echo "$(whoami)" \`id\` \n\nsecond line\n`;

    const { manager, calls } = detached(planPath, {
      env: { FAKE_COPILOT_ARGV_FILE: argvFile },
    });

    await manager.start(brief({ markdown: `# Plan\n\n${hostile}` }), hostile);
    assert.equal((await settled(manager)).status, "done");

    const argv = JSON.parse(await readFile(argvFile, "utf-8"));
    assert.equal(argv.length, 2, "exactly two arguments: -p and the prompt");
    assert.equal(argv[0], "-p");
    // Byte-for-byte, which is only possible if no shell ever parsed it.
    assert.equal(argv[1], hostile);
    assert.ok(argv[1].includes("\n"));
    assert.equal(argv[1], calls[0].args[1]);
    // And nothing the injection asked for happened.
    assert.equal(existsSync(join(dir, "pwned")), false);
  });

  it("sends the browser's prompt verbatim and renders nothing of its own", async () => {
    const { dir, planPath } = await workspace("detached-prompt");
    const argvFile = join(dir, "argv.json");
    const prompt = "Rewrite the plan.\n\nNothing else.\n";

    const { manager } = detached(planPath, { env: { FAKE_COPILOT_ARGV_FILE: argvFile } });

    // The brief says one thing and the prompt says another: what reaches the
    // model is the prompt, untouched. There is no formatter on this side.
    await manager.start(brief({ instruction: "Tighten section 3." }), prompt);
    assert.equal((await settled(manager)).status, "done");
    assert.deepEqual(JSON.parse(await readFile(argvFile, "utf-8")), ["-p", prompt]);
  });

  it("names the missing CLI instead of hanging or throwing a stack trace", async () => {
    const { dir, planPath } = await workspace("detached-enoent");
    const manager = new RevisionManager({
      planPath,
      mode: "detached",
      logger: quiet,
      spawnFn: (_command, args, options) => spawn(join(dir, "no-such-copilot"), args, options),
    });

    await manager.start(brief(), PROMPT);
    const state = await settled(manager);

    assert.equal(state.status, "failed");
    assert.match(state.error, /"copilot" CLI was not found on PATH/);
    assert.match(state.error, /QUILL_ATTACHED=1, or --attached/);
    assert.equal(state.markdown, undefined);
  });

  it("reports a non-zero exit with what the agent said", async () => {
    const { planPath } = await workspace("detached-exit");
    const { manager } = detached(planPath, { env: { FAKE_COPILOT_MODE: "fail" } });

    await manager.start(brief(), PROMPT);
    const state = await settled(manager);

    assert.equal(state.status, "failed");
    assert.match(state.error, /copilot exited with code 3/);
    assert.match(state.error, /not authenticated/);
  });

  it("reports an agent that exits cleanly but prints nothing", async () => {
    const { planPath } = await workspace("detached-empty");
    const { manager } = detached(planPath, { env: { FAKE_COPILOT_MODE: "empty" } });

    await manager.start(brief(), PROMPT);
    const state = await settled(manager);

    assert.equal(state.status, "failed");
    assert.match(state.error, /printed nothing/);
  });

  it("rejects whitespace-only output as empty", async () => {
    const { planPath } = await workspace("detached-blank");
    const { manager } = detached(planPath, { env: { FAKE_COPILOT_OUTPUT: "   \n\n  \n" } });

    await manager.start(brief(), PROMPT);
    assert.match((await settled(manager)).error, /printed nothing/);
  });

  it("normalizes a BOM and trailing whitespace off the agent's output", async () => {
    const { planPath } = await workspace("detached-bom");
    const { manager } = detached(planPath, {
      env: { FAKE_COPILOT_OUTPUT: "\uFEFF# Plan\n\nRevised.\n\n\n   " },
    });

    await manager.start(brief(), PROMPT);
    assert.equal((await settled(manager)).markdown, "# Plan\n\nRevised.\n");
  });

  it("reports working once the agent is actually running", async () => {
    const { dir, planPath } = await workspace("detached-working");
    const pidFile = join(dir, "pid");
    const { manager } = detached(planPath, {
      env: { FAKE_COPILOT_MODE: "hang", FAKE_COPILOT_PID_FILE: pidFile },
    });

    await manager.start(brief(), PROMPT);
    await waitFor(() => manager.getState().status === "working", { what: "the child to start" });

    await manager.cancel();
  });

  it("kills the child on cancel — a cancelled revision is not still running", async () => {
    const { dir, planPath } = await workspace("detached-cancel");
    const pidFile = join(dir, "pid");
    const { manager } = detached(planPath, {
      env: { FAKE_COPILOT_MODE: "hang", FAKE_COPILOT_PID_FILE: pidFile },
    });

    await manager.start(brief(), PROMPT);
    const pid = Number(
      await waitFor(() => (existsSync(pidFile) ? readFileSync(pidFile, "utf-8") : null), {
        what: "the agent to report its pid",
      }),
    );
    assert.equal(isAlive(pid), true);

    await manager.cancel();

    assert.equal(manager.getState().status, "cancelled");
    await waitFor(() => !isAlive(pid), { what: "the agent process to die" });
  });

  it("kills the child on timeout and says the timeout is configurable", async () => {
    const { dir, planPath } = await workspace("detached-timeout");
    const pidFile = join(dir, "pid");
    const { manager } = detached(planPath, {
      timeoutMs: 120,
      env: { FAKE_COPILOT_MODE: "hang", FAKE_COPILOT_PID_FILE: pidFile },
    });

    await manager.start(brief(), PROMPT);
    const pid = Number(
      await waitFor(() => (existsSync(pidFile) ? readFileSync(pidFile, "utf-8") : null), {
        what: "the agent to report its pid",
      }),
    );

    const state = await settled(manager);
    assert.equal(state.status, "failed");
    assert.match(state.error, /did not finish within/);
    assert.match(state.error, /--revision-timeout/);
    await waitFor(() => !isAlive(pid), { what: "the timed-out agent to die" });
  });

  it("kills the child on a synchronous shutdown", async () => {
    const { dir, planPath } = await workspace("detached-shutdown");
    const pidFile = join(dir, "pid");
    const { manager } = detached(planPath, {
      env: { FAKE_COPILOT_MODE: "hang", FAKE_COPILOT_PID_FILE: pidFile },
    });

    await manager.start(brief(), PROMPT);
    const pid = Number(
      await waitFor(() => (existsSync(pidFile) ? readFileSync(pidFile, "utf-8") : null), {
        what: "the agent to report its pid",
      }),
    );

    manager.shutdownSync();
    await waitFor(() => !isAlive(pid), { what: "the agent to die on shutdown" });
  });

  it("refuses an outside completion — in detached mode quill is the agent", async () => {
    const { planPath } = await workspace("detached-put");
    const { manager } = detached(planPath, { env: { FAKE_COPILOT_MODE: "hang" } });

    await manager.start(brief(), PROMPT);
    const submitted = await manager.submitAgentResponse({
      id: manager.getState().id,
      status: "done",
      markdown: "# Owned\n",
    });

    assert.equal(submitted.ok, false);
    assert.equal(submitted.status, 409);
    assert.match(submitted.error, /detached mode/);
    await manager.cancel();
  });

  it("never creates the queue directory — there is nobody to read it", async () => {
    const { dir, planPath } = await workspace("detached-no-queue");
    const { manager } = detached(planPath);

    await manager.start(brief(), PROMPT);
    await settled(manager);

    assert.equal(existsSync(join(dir, QUILL_DIR)), false);
  });
});
