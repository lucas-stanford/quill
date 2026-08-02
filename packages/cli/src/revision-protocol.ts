/**
 * The agent bridge protocol — paths, file shapes and validation.
 *
 * Everything here is pure. The side-effecting half lives in `revision.ts`; the
 * human-facing documentation for the parent-agent side lives in AGENT-BRIDGE.md
 * beside this file. Keep the three in step: the queue file is a public API.
 *
 * Layout, beside the plan:
 *
 *   PLAN.md
 *   .quill/revision-request.json    written by quill, read by the parent agent
 *   .quill/revision-response.json   written by the parent agent, consumed by quill
 *
 * `.quill/revision-request.json` is exactly a `QueuedRevision` (frozen in
 * types.ts) plus the rendered `prompt`, so a parent can `jq -r .brief.markdown`
 * or `jq -r .prompt` it with no client library.
 */
import { dirname, join } from "node:path";
import type { BriefComment, BriefEdit, QueuedRevision, RevisionBrief } from "./types.js";
import {
  collectShapeErrors,
  fail,
  optionalArray,
  optionalBoolean,
  optionalString,
  requireRecord,
  requireString,
} from "./validate.js";

/** The bridge directory, created beside the plan on demand. */
export const QUILL_DIR = ".quill";
export const REQUEST_FILENAME = "revision-request.json";
export const RESPONSE_FILENAME = "revision-response.json";

export function quillDirFor(planPath: string): string {
  return join(dirname(planPath), QUILL_DIR);
}

export function revisionRequestPathFor(planPath: string): string {
  return join(quillDirFor(planPath), REQUEST_FILENAME);
}

export function revisionResponsePathFor(planPath: string): string {
  return join(quillDirFor(planPath), RESPONSE_FILENAME);
}

/**
 * The queue file: exactly a `QueuedRevision` (frozen in types.ts) plus the
 * rendered `prompt` the browser sent.
 *
 * The extra key is additive — a parent written against `QueuedRevision` alone
 * reads the file unchanged — and it saves a shell-scripted agent from having to
 * turn the structured brief into English itself.
 */
export interface QueuedRevisionFile extends QueuedRevision {
  prompt: string;
}

/** Pretty-printed with a trailing newline: a human and `jq` both have to read it. */
export function serializeQueuedRevision(queued: QueuedRevisionFile): string {
  return `${JSON.stringify(queued, null, 2)}\n`;
}

/* ── Mode detection ──────────────────────────────────────────────────────── */

export type RevisionMode = "attached" | "detached";

/** Where the decision came from — reported at startup so it is never a guess. */
export type ModeSource = "flag" | "env" | "default";

export interface ModeSignals {
  /** `--attached` on the command line. */
  attachedFlag?: boolean;
  /** `--detached` on the command line. */
  detachedFlag?: boolean;
  /** `QUILL_ATTACHED` from the environment of the process that spawned quill. */
  env?: string | undefined;
}

export interface ModeDecision {
  mode: RevisionMode;
  source: ModeSource;
  /** Short human-readable justification, printed at startup. */
  detail: string;
}

const FALSY_ENV = new Set(["", "0", "false", "no", "off"]);

/**
 * Decides which side of the bridge is real.
 *
 * Attached is opt-in, never inferred. The two failure modes are not symmetric:
 * guessing "detached" when a parent is waiting means a *second* model answers a
 * request the parent was going to service, silently; guessing "attached" when
 * nobody is listening means the request sits in a file until it times out. Both
 * are bad, and neither can be detected after the fact — so the only honest rule
 * is that somebody has to say so. A parent agent sets `QUILL_ATTACHED=1` when it
 * spawns quill (one env var, no handshake, works through `sh -c` and `npx`); a
 * human can override either way with `--attached` / `--detached`.
 *
 * A bare `quill PLAN.md` therefore lands in detached mode, which is the mode
 * that can actually complete a revision with no help.
 */
export function resolveRevisionMode(signals: ModeSignals): ModeDecision {
  if (signals.attachedFlag && signals.detachedFlag) {
    fail("--attached and --detached are mutually exclusive");
  }
  if (signals.attachedFlag) {
    return { mode: "attached", source: "flag", detail: "--attached" };
  }
  if (signals.detachedFlag) {
    return { mode: "detached", source: "flag", detail: "--detached" };
  }

  const env = signals.env;
  if (env !== undefined) {
    const attached = !FALSY_ENV.has(env.trim().toLowerCase());
    return {
      mode: attached ? "attached" : "detached",
      source: "env",
      detail: `QUILL_ATTACHED=${env}`,
    };
  }

  return {
    mode: "detached",
    source: "default",
    detail: "no --attached flag and no QUILL_ATTACHED in the environment",
  };
}

/* ── POST /api/revision body ─────────────────────────────────────────────── */

export type BriefResult = { ok: true; brief: RevisionBrief } | { ok: false; reason: string };

function readEdit(value: unknown, where: string): BriefEdit {
  const raw = requireRecord(value, where);
  const kind = requireString(raw.kind, `${where}.kind`);
  if (kind !== "insertion" && kind !== "deletion") {
    fail(`${where}.kind must be "insertion" or "deletion"`);
  }
  const edit: BriefEdit = { kind, text: optionalString(raw.text, `${where}.text`) };
  if (raw.context !== undefined && raw.context !== null) {
    edit.context = requireString(raw.context, `${where}.context`);
  }
  return edit;
}

function readComment(value: unknown, where: string): BriefComment {
  const raw = requireRecord(value, where);
  return {
    quote: optionalString(raw.quote, `${where}.quote`),
    body: optionalString(raw.body, `${where}.body`),
    author: optionalString(raw.author, `${where}.author`),
    replies: optionalArray(raw.replies, `${where}.replies`).map((reply, i) =>
      requireString(reply, `${where}.replies[${i}]`),
    ),
    orphaned: optionalBoolean(raw.orphaned, `${where}.orphaned`),
  };
}

/**
 * Validates a `RevisionBrief` and normalizes it to exactly the documented shape.
 *
 * Only `markdown` is genuinely required — a brief with no plan text is not a
 * revision request. Everything else defaults, because a brief with no comments
 * and no edits is a legitimate "just apply my instruction" and because the
 * validated object is written straight to the queue file, where a parent agent
 * reads it: every key it documents is always present.
 */
export function validateRevisionBrief(value: unknown, where = "brief"): BriefResult {
  const result = collectShapeErrors<RevisionBrief>(() => {
    const raw = requireRecord(value, where);
    const brief: RevisionBrief = {
      markdown: requireString(raw.markdown, `${where}.markdown`),
      comments: optionalArray(raw.comments, `${where}.comments`).map((comment, i) =>
        readComment(comment, `${where}.comments[${i}]`),
      ),
      edits: optionalArray(raw.edits, `${where}.edits`).map((edit, i) =>
        readEdit(edit, `${where}.edits[${i}]`),
      ),
    };
    if (raw.feedback !== undefined && raw.feedback !== null) {
      const feedback = requireString(raw.feedback, `${where}.feedback`);
      if (feedback.trim().length > 0) brief.feedback = feedback;
    }
    if (raw.instruction !== undefined && raw.instruction !== null) {
      const instruction = requireString(raw.instruction, `${where}.instruction`);
      if (instruction.trim().length > 0) brief.instruction = instruction;
    }
    return brief;
  });

  return result.ok ? { ok: true, brief: result.value } : { ok: false, reason: result.reason };
}

export type RevisionRequestResult =
  | { ok: true; brief: RevisionBrief; prompt: string }
  | { ok: false; reason: string };

/**
 * Validates a `POST /api/revision` body: `{ brief: RevisionBrief; prompt: string }`.
 *
 * Both are required. The browser renders the prompt (`formatBriefPrompt` in the
 * web package) so the product has exactly one prompt implementation; the CLI
 * sends it verbatim and never re-derives it — a second formatter here is the
 * drift this contract exists to prevent. A blank prompt is refused rather than
 * silently patched over: sending a model an empty instruction is never what the
 * caller meant, and a 400 says so at the point the mistake was made.
 */
export function validateRevisionRequest(value: unknown): RevisionRequestResult {
  const shape = "Body must be { brief: RevisionBrief, prompt: string }";
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: shape };
  }
  const raw = value as Record<string, unknown>;
  if (raw.brief === undefined) return { ok: false, reason: shape };

  const brief = validateRevisionBrief(raw.brief, "body.brief");
  if (!brief.ok) return brief;

  if (raw.prompt === undefined || raw.prompt === null) {
    return { ok: false, reason: `${shape} — body.prompt is missing` };
  }
  if (typeof raw.prompt !== "string") {
    return { ok: false, reason: "body.prompt must be a string" };
  }
  if (raw.prompt.trim().length === 0) {
    return { ok: false, reason: "body.prompt must not be empty" };
  }
  return { ok: true, brief: brief.brief, prompt: raw.prompt };
}

/* ── The parent agent's reply ────────────────────────────────────────────── */

/**
 * What the parent agent writes to `.quill/revision-response.json` (or PUTs to
 * `/api/revision`, which is the same payload for agents that would rather curl
 * than write a file).
 *
 * `working` is an optional heartbeat: it flips the browser from "queued" to
 * "working" and restarts the timeout, so a slow agent that keeps saying so is
 * never timed out.
 */
export interface AgentResponse {
  /** Must equal the `id` from the request file — a stale reply is ignored. */
  id: string;
  status: "working" | "done" | "failed" | "cancelled";
  /**
   * Optional. In attached mode the plan on disk is the deliverable; supply this
   * only if the revised text differs from what was written, or to save quill a
   * read. Quill never writes it back to the plan.
   */
  markdown?: string;
  /** Required in spirit when `status` is `failed` — shown to the reviewer. */
  error?: string;
}

export type AgentResponseResult =
  | { ok: true; response: AgentResponse }
  | { ok: false; reason: string };

const AGENT_STATUSES = new Set(["working", "done", "failed", "cancelled"]);

export function validateAgentResponse(value: unknown, where = "response"): AgentResponseResult {
  const result = collectShapeErrors<AgentResponse>(() => {
    const raw = requireRecord(value, where);
    const id = requireString(raw.id, `${where}.id`);
    if (id.length === 0) fail(`${where}.id must not be empty`);

    const status = requireString(raw.status, `${where}.status`);
    if (!AGENT_STATUSES.has(status)) {
      fail(`${where}.status must be one of "working", "done", "failed", "cancelled"`);
    }

    const response: AgentResponse = { id, status: status as AgentResponse["status"] };
    if (raw.markdown !== undefined && raw.markdown !== null) {
      response.markdown = requireString(raw.markdown, `${where}.markdown`);
    }
    if (raw.error !== undefined && raw.error !== null) {
      response.error = requireString(raw.error, `${where}.error`);
    }
    return response;
  });

  return result.ok ? { ok: true, response: result.value } : { ok: false, reason: result.reason };
}

/** Parses the raw text of `.quill/revision-response.json`. */
export function parseAgentResponse(raw: string): AgentResponseResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    return { ok: false, reason: `not valid JSON — ${(err as Error).message}` };
  }
  return validateAgentResponse(value, RESPONSE_FILENAME);
}

/**
 * A queue file as read back. `prompt` is optional here and required when
 * writing: the sweep's job is to identify a stale file, not to validate it, and
 * a file left by an older quill should still be recognizable enough to clear.
 */
export type ParsedQueuedRevision = QueuedRevision & { prompt?: string };

export type QueuedRevisionResult =
  | { ok: true; queued: ParsedQueuedRevision }
  | { ok: false; reason: string };

/** Parses a queue file we wrote earlier — used to identify a stale one at startup. */
export function parseQueuedRevision(raw: string): QueuedRevisionResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    return { ok: false, reason: `not valid JSON — ${(err as Error).message}` };
  }

  const result = collectShapeErrors<ParsedQueuedRevision>(() => {
    const where = REQUEST_FILENAME;
    const raw2 = requireRecord(value, where);
    const brief = validateRevisionBrief(raw2.brief, `${where}.brief`);
    if (!brief.ok) fail(brief.reason);
    const queued: ParsedQueuedRevision = {
      id: requireString(raw2.id, `${where}.id`),
      planPath: requireString(raw2.planPath, `${where}.planPath`),
      brief: brief.brief,
      createdAt: requireString(raw2.createdAt, `${where}.createdAt`),
    };
    if (raw2.prompt !== undefined && raw2.prompt !== null) {
      queued.prompt = requireString(raw2.prompt, `${where}.prompt`);
    }
    return queued;
  });

  return result.ok ? { ok: true, queued: result.value } : { ok: false, reason: result.reason };
}
