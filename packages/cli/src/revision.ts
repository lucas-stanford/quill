/**
 * The agent bridge: one revision in flight, two ways of servicing it.
 *
 * **Attached** — quill was spawned by a coding agent that is blocked waiting for
 * the review. `POST /api/revision` writes a `QueuedRevision` to
 * `.quill/revision-request.json` beside the plan and stops there. The parent
 * rewrites `PLAN.md` on disk and the M2 file watcher pushes it to the browser;
 * there is deliberately no second transport for the plan text. The parent then
 * writes `.quill/revision-response.json` to say it is finished. See
 * AGENT-BRIDGE.md for the protocol a parent implements against.
 *
 * **Detached** — nobody is listening, so quill runs `copilot -p <prompt>` itself
 * and treats stdout as the revised markdown.
 *
 * The prompt is rendered by the browser (`formatBriefPrompt` in the web package)
 * and arrives with the request. Quill passes it through untouched in both modes
 * — to `copilot` in detached mode, into the queue file in attached mode. There
 * is deliberately no prompt formatter on this side of the wire: a second one
 * would drift from the first.
 *
 * Two rules hold in both modes:
 *
 *  1. **The revised text is never written to the plan by quill.** It comes back
 *     in `RevisionState.markdown` and the browser applies it as tracked changes,
 *     so rejecting everything restores the document exactly. Writing it to disk
 *     would bypass the entire safety model. (In attached mode the *parent* wrote
 *     the plan; that is its prerogative, and the watcher already handles it.)
 *  2. **A revision never hangs.** Every path — a parent that never answers, a
 *     `copilot` that is not installed, one that runs forever, one that prints
 *     nothing — ends in a terminal state with an actionable message.
 */
import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import { watch, rmSync } from "node:fs";
import type { FSWatcher } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { basename } from "node:path";
import type { RevisionBrief, RevisionState } from "./types.js";
import { writeFileAtomic } from "./atomic.js";
import {
  QUILL_DIR,
  REQUEST_FILENAME,
  RESPONSE_FILENAME,
  parseAgentResponse,
  parseQueuedRevision,
  quillDirFor,
  revisionRequestPathFor,
  revisionResponsePathFor,
  serializeQueuedRevision,
} from "./revision-protocol.js";
import type { AgentResponse, QueuedRevisionFile, RevisionMode } from "./revision-protocol.js";

/** The agent quill shells out to in detached mode. Spawned, never shelled. */
export const AGENT_COMMAND = "copilot";

/** How long a revision may stay un-finished before it is failed. 0 disables. */
export const DEFAULT_REVISION_TIMEOUT_MS = 300_000;

/** How often the response file is checked, as a backstop to the fs watcher. */
const RESPONSE_POLL_MS = 500;

/** stdout larger than this is a runaway agent, not a plan. */
const MAX_AGENT_OUTPUT_BYTES = 10 * 1024 * 1024;

/** Grace between SIGTERM and SIGKILL when cancelling a child. */
const KILL_GRACE_MS = 2_000;

/** Stderr shown to the reviewer when the agent fails, so the box stays readable. */
const MAX_STDERR_CHARS = 500;

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export interface RevisionLogger {
  log(message: string): void;
  error(message: string): void;
}

export interface RevisionManagerOptions {
  /** Absolute path of the plan being reviewed. */
  planPath: string;
  mode: RevisionMode;
  /** Milliseconds before an unfinished revision fails. 0 disables the timeout. */
  timeoutMs?: number;
  /** Test seam: injected in unit tests so no real `copilot` is required. */
  spawnFn?: SpawnFn;
  /** Test seam: the response-file poll interval. */
  pollIntervalMs?: number;
  logger?: RevisionLogger;
}

export type StartResult =
  | { ok: true; state: RevisionState }
  | { ok: false; status: 409 | 500; error: string; current: RevisionState };

export type SubmitResult =
  | { ok: true; state: RevisionState }
  | { ok: false; status: 404 | 409; error: string; current: RevisionState };

interface InFlight {
  id: string;
  /** Cancel or completion has been decided; late events are ignored. */
  settled: boolean;
  child: ChildProcess | null;
  timeout: NodeJS.Timeout | null;
  poll: NodeJS.Timeout | null;
  watcher: FSWatcher | null;
  killTimer: NodeJS.Timeout | null;
  /** Text of a response file that would not parse, and when it first failed. */
  unreadableResponse: { text: string; since: number } | null;
}

/*
 * Everything here is progress commentary for a human, so it goes to stderr.
 * stdout is reserved for the single-line ReviewSummary a parent agent parses.
 */
const consoleLogger: RevisionLogger = {
  log: (message) => process.stderr.write(`${message}\n`),
  error: (message) => console.error(message),
};

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

/** Strips a BOM and normalizes the trailing newline; nothing else is touched. */
function normalizeAgentMarkdown(raw: string): string {
  const withoutBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const trimmed = withoutBom.replace(/\s+$/, "");
  return trimmed.length === 0 ? "" : `${trimmed}\n`;
}

export class RevisionManager {
  readonly planPath: string;
  readonly mode: RevisionMode;
  readonly requestPath: string;
  readonly responsePath: string;

  readonly #timeoutMs: number;
  readonly #pollIntervalMs: number;
  readonly #unreadableGraceMs: number;
  readonly #spawn: SpawnFn;
  readonly #logger: RevisionLogger;

  #state: RevisionState;
  #inFlight: InFlight | null = null;

  constructor(options: RevisionManagerOptions) {
    this.planPath = options.planPath;
    this.mode = options.mode;
    this.requestPath = revisionRequestPathFor(options.planPath);
    this.responsePath = revisionResponsePathFor(options.planPath);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_REVISION_TIMEOUT_MS;
    this.#pollIntervalMs = options.pollIntervalMs ?? RESPONSE_POLL_MS;
    // Four polls, and never so short that a slow writer is called broken.
    this.#unreadableGraceMs = Math.max(4 * this.#pollIntervalMs, 250);
    this.#spawn = options.spawnFn ?? (nodeSpawn as SpawnFn);
    this.#logger = options.logger ?? consoleLogger;
    this.#state = { id: "", status: "idle", mode: options.mode };
  }

  /** A copy — callers serialize this straight to the browser. */
  getState(): RevisionState {
    return { ...this.#state };
  }

  get busy(): boolean {
    return this.#state.status === "queued" || this.#state.status === "working";
  }

  /**
   * Clears a request file left behind by a previous session.
   *
   * A queue file whose quill is gone is worse than no queue file: a polling
   * parent would pick it up and rewrite the plan for a review nobody is
   * watching. One belonging to a different plan is left alone — `.quill/` can be
   * shared by two plans in the same directory.
   */
  async sweepStaleRequest(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.requestPath, "utf-8");
    } catch {
      return;
    }

    const parsed = parseQueuedRevision(raw);
    if (parsed.ok && parsed.queued.planPath !== this.planPath) return;

    await rm(this.requestPath, { force: true }).catch(() => undefined);
    await rm(this.responsePath, { force: true }).catch(() => undefined);
    this.#logger.error(
      `quill: cleared a stale ${QUILL_DIR}/${REQUEST_FILENAME} left by a previous session`,
    );
  }

  /** `POST /api/revision`. One revision at a time; a second is refused, not raced. */
  async start(brief: RevisionBrief, prompt: string): Promise<StartResult> {
    if (this.busy) {
      return {
        ok: false,
        status: 409,
        error: `A revision is already ${this.#state.status} — cancel it before starting another`,
        current: this.getState(),
      };
    }

    const id = randomUUID();
    this.#state = { id, status: "queued", mode: this.mode };
    this.#inFlight = {
      id,
      settled: false,
      child: null,
      timeout: null,
      poll: null,
      watcher: null,
      killTimer: null,
      unreadableResponse: null,
    };

    this.#armTimeout(id);

    if (this.mode === "attached") {
      const queued: QueuedRevisionFile = {
        id,
        planPath: this.planPath,
        brief,
        createdAt: new Date().toISOString(),
        prompt,
      };
      try {
        await mkdir(quillDirFor(this.planPath), { recursive: true });
        // Clear any stale reply *before* publishing the request, so a fast
        // parent's response can never be mistaken for leftovers and deleted.
        await rm(this.responsePath, { force: true }).catch(() => undefined);
        // Atomic: a parent polling the directory never reads half a request.
        await writeFileAtomic(this.requestPath, serializeQueuedRevision(queued));
      } catch (err) {
        this.#clearInFlight();
        this.#state = {
          id,
          status: "failed",
          mode: this.mode,
          error: `Could not write ${QUILL_DIR}/${REQUEST_FILENAME} — ${(err as Error).message}`,
        };
        return { ok: false, status: 500, error: this.#state.error!, current: this.getState() };
      }

      this.#watchForResponse(id);
      this.#logger.log(
        `quill: revision ${id} queued in ${QUILL_DIR}/${REQUEST_FILENAME} — waiting for the parent agent`,
      );
    } else {
      this.#startDetached(id, prompt);
    }

    return { ok: true, state: this.getState() };
  }

  /**
   * `DELETE /api/revision`. Idempotent: with nothing in flight it just clears
   * the last result back to idle, so the browser can start clean.
   */
  async cancel(): Promise<void> {
    const inFlight = this.#inFlight;
    if (!inFlight) {
      this.#state = { id: "", status: "idle", mode: this.mode };
      return;
    }

    const wasBusy = this.busy;
    inFlight.settled = true;
    this.#killChild(inFlight);
    this.#clearTimers(inFlight);
    this.#inFlight = null;

    if (this.mode === "attached") {
      // The request file vanishing is the cancel signal to a polling parent.
      await rm(this.requestPath, { force: true }).catch(() => undefined);
      await rm(this.responsePath, { force: true }).catch(() => undefined);
    }

    this.#state = wasBusy
      ? { id: this.#state.id, status: "cancelled", mode: this.mode }
      : { id: "", status: "idle", mode: this.mode };
  }

  /**
   * `PUT /api/revision` — the same payload as the response file, for a parent
   * that would rather curl than write a file. Attached mode only: in detached
   * mode quill is the agent, and accepting an outside answer would let anything
   * on localhost put words in the model's mouth.
   */
  async submitAgentResponse(response: AgentResponse): Promise<SubmitResult> {
    if (this.mode === "detached") {
      return {
        ok: false,
        status: 409,
        error: "quill is running in detached mode and services revisions itself",
        current: this.getState(),
      };
    }
    if (!this.#inFlight || !this.busy) {
      return {
        ok: false,
        status: 404,
        error: "No revision is in flight",
        current: this.getState(),
      };
    }
    if (response.id !== this.#inFlight.id) {
      return {
        ok: false,
        status: 409,
        error: `Revision ${response.id} is not the revision in flight (${this.#inFlight.id})`,
        current: this.getState(),
      };
    }

    await this.#applyAgentResponse(this.#inFlight.id, response);
    return { ok: true, state: this.getState() };
  }

  /** Synchronous teardown, safe to call from a signal handler. */
  shutdownSync(): void {
    const inFlight = this.#inFlight;
    if (!inFlight) return;

    inFlight.settled = true;
    this.#killChild(inFlight);
    this.#clearTimers(inFlight);
    this.#inFlight = null;

    if (this.mode === "attached") {
      // Never leave a request behind for a parent that would service it into a
      // browser that is gone.
      try {
        rmSync(this.requestPath, { force: true });
        rmSync(this.responsePath, { force: true });
      } catch {
        /* best effort on the way out */
      }
    }
  }

  /* ── attached ─────────────────────────────────────────────────────────── */

  #watchForResponse(id: string): void {
    const inFlight = this.#inFlight;
    if (!inFlight || inFlight.id !== id) return;

    // Watch for latency, poll for reliability: fs.watch misses events on some
    // filesystems, and a 500ms poll costs nothing next to an agent rewriting a
    // document. Either path funnels into the same consume-once check.
    try {
      const watcher = watch(quillDirFor(this.planPath), (_event, filename) => {
        if (filename !== null && filename !== RESPONSE_FILENAME) return;
        void this.#checkResponse(id);
      });
      watcher.unref();
      watcher.on("error", () => undefined);
      inFlight.watcher = watcher;
    } catch {
      /* poll-only is a fine degradation */
    }

    const poll = setInterval(() => void this.#checkResponse(id), this.#pollIntervalMs);
    poll.unref();
    inFlight.poll = poll;

    void this.#checkResponse(id);
  }

  async #checkResponse(id: string): Promise<void> {
    const inFlight = this.#inFlight;
    if (!inFlight || inFlight.id !== id || inFlight.settled) return;

    let raw: string;
    try {
      raw = await readFile(this.responsePath, "utf-8");
    } catch {
      return; // not there yet
    }

    const parsed = parseAgentResponse(raw);
    if (!parsed.ok) {
      // Most likely a half-written file: a shell agent that redirects into the
      // file rather than renaming into place is caught mid-write. Give it a
      // grace period, and only give up once the same bytes have been sitting
      // there unreadable for the whole of it.
      const previous = inFlight.unreadableResponse;
      if (!previous || previous.text !== raw) {
        inFlight.unreadableResponse = { text: raw, since: Date.now() };
        return;
      }
      if (Date.now() - previous.since < this.#unreadableGraceMs) return;

      await rm(this.responsePath, { force: true }).catch(() => undefined);
      this.#finish(id, {
        id,
        status: "failed",
        mode: this.mode,
        error: `The agent wrote an unreadable ${QUILL_DIR}/${RESPONSE_FILENAME} — ${parsed.reason}`,
      });
      return;
    }

    inFlight.unreadableResponse = null;

    // Consume it either way: a leftover reply must not be re-read forever.
    await rm(this.responsePath, { force: true }).catch(() => undefined);

    if (parsed.response.id !== id) {
      this.#logger.error(
        `quill: ignored a ${RESPONSE_FILENAME} for revision ${parsed.response.id}; ${id} is in flight`,
      );
      return;
    }

    await this.#applyAgentResponse(id, parsed.response);
  }

  async #applyAgentResponse(id: string, response: AgentResponse): Promise<void> {
    const inFlight = this.#inFlight;
    if (!inFlight || inFlight.id !== id || inFlight.settled) return;

    if (response.status === "working") {
      // A heartbeat. Keep waiting, and restart the clock so a slow-but-alive
      // agent is never timed out.
      this.#state = { id, status: "working", mode: this.mode };
      this.#armTimeout(id);
      return;
    }

    if (response.status === "failed") {
      await this.#removeRequestFile();
      this.#finish(id, {
        id,
        status: "failed",
        mode: this.mode,
        error: response.error?.trim() || "The agent reported a failure but gave no reason",
      });
      return;
    }

    if (response.status === "cancelled") {
      await this.#removeRequestFile();
      this.#finish(id, { id, status: "cancelled", mode: this.mode });
      return;
    }

    // done: the plan on disk is the deliverable and the M2 watcher has already
    // pushed it. `markdown` is handed back so the browser can diff it into
    // tracked changes against the document the reviewer started from.
    let markdown = response.markdown;
    if (markdown === undefined) {
      try {
        markdown = await readFile(this.planPath, "utf-8");
      } catch (err) {
        this.#logger.error(
          `quill: revision ${id} reported done but ${basename(this.planPath)} could not be read — ${(err as Error).message}`,
        );
      }
    }

    await this.#removeRequestFile();
    const done: RevisionState = { id, status: "done", mode: this.mode };
    if (markdown !== undefined) done.markdown = markdown;
    this.#finish(id, done);
  }

  async #removeRequestFile(): Promise<void> {
    await rm(this.requestPath, { force: true }).catch(() => undefined);
    await rm(this.responsePath, { force: true }).catch(() => undefined);
  }

  /* ── detached ─────────────────────────────────────────────────────────── */

  #startDetached(id: string, prompt: string): void {
    const inFlight = this.#inFlight;
    if (!inFlight || inFlight.id !== id) return;

    let child: ChildProcess;
    try {
      // Argument array, no shell: the prompt is arbitrary reviewer text and
      // carries quotes, backticks, $(...) and newlines. Passed this way it is
      // one argv entry that no shell ever sees. `detached` puts the agent in its
      // own process group so cancelling kills anything it spawned too.
      child = this.#spawn(AGENT_COMMAND, ["-p", prompt], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        detached: true,
      });
    } catch (err) {
      this.#finish(id, {
        id,
        status: "failed",
        mode: this.mode,
        error: this.#spawnErrorMessage(err as NodeJS.ErrnoException),
      });
      return;
    }

    inFlight.child = child;

    let stdout = "";
    let stderr = "";
    let overflowed = false;

    child.stdout?.setEncoding("utf-8");
    child.stdout?.on("data", (chunk: string) => {
      if (overflowed) return;
      stdout += chunk;
      if (Buffer.byteLength(stdout, "utf-8") > MAX_AGENT_OUTPUT_BYTES) {
        overflowed = true;
        this.#killChild(inFlight);
        this.#finish(id, {
          id,
          status: "failed",
          mode: this.mode,
          error: `${AGENT_COMMAND} produced more than ${Math.round(MAX_AGENT_OUTPUT_BYTES / 1024 / 1024)} MB of output and was stopped`,
        });
      }
    });

    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < MAX_STDERR_CHARS * 4) stderr += chunk;
    });

    child.on("spawn", () => {
      if (this.#inFlight?.id === id && !this.#inFlight.settled) {
        this.#state = { id, status: "working", mode: this.mode };
      }
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      this.#finish(id, {
        id,
        status: "failed",
        mode: this.mode,
        error: this.#spawnErrorMessage(err),
      });
    });

    child.on("close", (code, signal) => {
      if (overflowed) return;
      const current = this.#inFlight;
      if (!current || current.id !== id || current.settled) return;

      if (signal) {
        this.#finish(id, {
          id,
          status: "failed",
          mode: this.mode,
          error: `${AGENT_COMMAND} was terminated by ${signal} before it produced a revision`,
        });
        return;
      }

      if (code !== 0) {
        const detail = stderr.trim().length > 0 ? ` — ${truncate(stderr, MAX_STDERR_CHARS)}` : "";
        this.#finish(id, {
          id,
          status: "failed",
          mode: this.mode,
          error: `${AGENT_COMMAND} exited with code ${code}${detail}`,
        });
        return;
      }

      const markdown = normalizeAgentMarkdown(stdout);
      if (markdown.length === 0) {
        const detail = stderr.trim().length > 0 ? ` — ${truncate(stderr, MAX_STDERR_CHARS)}` : "";
        this.#finish(id, {
          id,
          status: "failed",
          mode: this.mode,
          error: `${AGENT_COMMAND} exited cleanly but printed nothing, so there is no revised plan to apply${detail}`,
        });
        return;
      }

      // Deliberately not written to disk — the browser applies it as tracked
      // changes so a bad revision is one click from being undone.
      this.#finish(id, { id, status: "done", mode: this.mode, markdown });
    });
  }

  #spawnErrorMessage(err: NodeJS.ErrnoException): string {
    if (err.code === "ENOENT") {
      return `The "${AGENT_COMMAND}" CLI was not found on PATH, so quill cannot revise the plan on its own. Install it and try again, or run quill from an agent that services revisions itself (QUILL_ATTACHED=1, or --attached).`;
    }
    if (err.code === "EACCES") {
      return `The "${AGENT_COMMAND}" CLI was found on PATH but is not executable (EACCES). Fix its permissions, or run quill with --attached so the parent agent does the revision.`;
    }
    return `Could not run "${AGENT_COMMAND}" — ${err.message}`;
  }

  /* ── shared plumbing ──────────────────────────────────────────────────── */

  #armTimeout(id: string): void {
    const inFlight = this.#inFlight;
    if (!inFlight || inFlight.id !== id) return;

    if (inFlight.timeout) clearTimeout(inFlight.timeout);
    if (this.#timeoutMs <= 0) {
      inFlight.timeout = null;
      return;
    }

    const timer = setTimeout(() => void this.#onTimeout(id), this.#timeoutMs);
    timer.unref();
    inFlight.timeout = timer;
  }

  async #onTimeout(id: string): Promise<void> {
    const inFlight = this.#inFlight;
    if (!inFlight || inFlight.id !== id || inFlight.settled) return;

    const seconds = Math.round(this.#timeoutMs / 1000);
    this.#killChild(inFlight);

    const error =
      this.mode === "attached"
        ? `No agent picked up the revision within ${seconds}s. A parent agent must read ${QUILL_DIR}/${REQUEST_FILENAME} and write ${QUILL_DIR}/${RESPONSE_FILENAME} when the plan has been rewritten (see AGENT-BRIDGE.md). If nothing is listening, restart quill with --detached so it calls ${AGENT_COMMAND} itself.`
        : `${AGENT_COMMAND} did not finish within ${seconds}s and was stopped. Raise --revision-timeout if that is too short.`;

    if (this.mode === "attached") await this.#removeRequestFile();
    this.#finish(id, { id, status: "failed", mode: this.mode, error });
  }

  #killChild(inFlight: InFlight): void {
    const child = inFlight.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;

    // Kill the whole group: `copilot` may have children of its own, and marking
    // the state cancelled while a model keeps running is a lie.
    const signalGroup = (signal: NodeJS.Signals): void => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          /* already gone */
        }
      }
    };

    signalGroup("SIGTERM");

    if (inFlight.killTimer) clearTimeout(inFlight.killTimer);
    const killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) signalGroup("SIGKILL");
    }, KILL_GRACE_MS);
    killTimer.unref();
    inFlight.killTimer = killTimer;
  }

  #clearTimers(inFlight: InFlight): void {
    if (inFlight.timeout) clearTimeout(inFlight.timeout);
    if (inFlight.poll) clearInterval(inFlight.poll);
    if (inFlight.watcher) {
      try {
        inFlight.watcher.close();
      } catch {
        /* already closed */
      }
    }
    inFlight.timeout = null;
    inFlight.poll = null;
    inFlight.watcher = null;
  }

  #clearInFlight(): void {
    if (!this.#inFlight) return;
    this.#inFlight.settled = true;
    this.#clearTimers(this.#inFlight);
    this.#inFlight = null;
  }

  #finish(id: string, state: RevisionState): void {
    const inFlight = this.#inFlight;
    if (!inFlight || inFlight.id !== id || inFlight.settled) return;
    this.#clearInFlight();
    this.#state = state;
  }
}

export function createRevisionManager(options: RevisionManagerOptions): RevisionManager {
  return new RevisionManager(options);
}
