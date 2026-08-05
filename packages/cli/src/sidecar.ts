/**
 * The review sidecar: `PLAN.md` -> `PLAN.quill.json`.
 *
 * Review metadata lives beside the plan rather than inside it so PLAN.md stays
 * clean and diffable. Everything in here is pure: path derivation, the
 * canonical serialization the revision hash is taken over, and validation of
 * anything read from disk or sent by the browser.
 */
import { basename, dirname, extname, join } from "node:path";
import { hashContent } from "./hash.js";
import type {
  Comment,
  CommentReply,
  FeedbackEntry,
  SaveAnnotationsRequest,
  Sidecar,
  TextAnchor,
} from "./types.js";

/** The only schema version this build understands. */
export const SIDECAR_VERSION = 1;

const SIDECAR_SUFFIX = ".quill.json";

/**
 * Derives the sidecar path from the plan path by replacing the extension:
 * `PLAN.md` -> `PLAN.quill.json`, `notes.markdown` -> `notes.quill.json`,
 * `PLAN` -> `PLAN.quill.json`, `.plan` -> `.plan.quill.json` (a leading dot is
 * not an extension).
 *
 * The derived name is always the stem plus a six-character-longer suffix, so it
 * can never collide with the plan itself — not even for a plan named
 * `X.quill.json`, which yields `X.quill.quill.json`.
 */
export function sidecarPathFor(planPath: string): string {
  const dir = dirname(planPath);
  const name = basename(planPath);
  const ext = extname(name);
  const stem = ext.length > 0 ? name.slice(0, -ext.length) : name;

  return join(dir, stem + SIDECAR_SUFFIX);
}

/** Timestamped quarantine path for a sidecar we could not understand. */
export function corruptBackupPathFor(sidecarPath: string, now: Date = new Date()): string {
  return `${sidecarPath}.corrupt-${now.toISOString().replace(/[:.]/g, "-")}`;
}

export function emptySidecar(): Sidecar {
  return { version: SIDECAR_VERSION, comments: [] };
}

/**
 * The canonical on-disk form. A revision is the sha256 of exactly these bytes,
 * and exactly these bytes are what gets written — otherwise a GET after a PUT
 * reports a different revision and the browser sees a phantom conflict.
 * Pretty-printed with a trailing newline so the sidecar diffs like a text file.
 */
export function serializeSidecar(sidecar: Sidecar): string {
  return `${JSON.stringify(sidecar, null, 2)}\n`;
}

/** The state a missing (or quarantined) sidecar degrades to. */
export const EMPTY_SIDECAR_TEXT = serializeSidecar(emptySidecar());
export const EMPTY_SIDECAR_REVISION = hashContent(EMPTY_SIDECAR_TEXT);

/** Why a sidecar was rejected: bad JSON, wrong shape, or a version we can't read. */
export type SidecarProblem = "syntax" | "shape" | "version";

export type SidecarParseResult =
  | { ok: true; sidecar: Sidecar }
  | { ok: false; problem: SidecarProblem; reason: string };

class ShapeError extends Error {}

function fail(message: string): never {
  throw new ShapeError(message);
}

function requireRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${where} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, where: string): string {
  if (typeof value !== "string") fail(`${where} must be a string`);
  return value;
}

function requireId(value: unknown, where: string): string {
  const id = requireString(value, where);
  if (id.length === 0) fail(`${where} must not be empty`);
  return id;
}

function requireBoolean(value: unknown, where: string): boolean {
  if (typeof value !== "boolean") fail(`${where} must be a boolean`);
  return value;
}

function requireArray(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) fail(`${where} must be an array`);
  return value;
}

function readAnchor(value: unknown, where: string): TextAnchor {
  const raw = requireRecord(value, where);
  return {
    quote: requireString(raw.quote, `${where}.quote`),
    prefix: requireString(raw.prefix, `${where}.prefix`),
    suffix: requireString(raw.suffix, `${where}.suffix`),
  };
}

function readReply(value: unknown, where: string): CommentReply {
  const raw = requireRecord(value, where);
  return {
    id: requireId(raw.id, `${where}.id`),
    author: requireString(raw.author, `${where}.author`),
    body: requireString(raw.body, `${where}.body`),
    createdAt: requireString(raw.createdAt, `${where}.createdAt`),
  };
}

function readComment(value: unknown, where: string): Comment {
  const raw = requireRecord(value, where);
  const comment: Comment = {
    id: requireId(raw.id, `${where}.id`),
    anchor: readAnchor(raw.anchor, `${where}.anchor`),
    author: requireString(raw.author, `${where}.author`),
    body: requireString(raw.body, `${where}.body`),
    createdAt: requireString(raw.createdAt, `${where}.createdAt`),
    resolved: requireBoolean(raw.resolved, `${where}.resolved`),
    replies: requireArray(raw.replies, `${where}.replies`).map((reply, i) =>
      readReply(reply, `${where}.replies[${i}]`),
    ),
  };
  if (raw.orphaned !== undefined) {
    comment.orphaned = requireBoolean(raw.orphaned, `${where}.orphaned`);
  }
  return comment;
}

/**
 * Reads the `feedback` field, tolerating the shape an earlier build wrote.
 *
 * A bare string was the original schema and is migrated to a single entry
 * rather than dropped: a reviewer's note is not worth losing over a format
 * change, and both forms are unambiguous. Entries with no text are discarded —
 * they ask the agent for nothing and would render as blank rows.
 */
function readFeedback(value: unknown, where: string): FeedbackEntry[] {
  if (value === undefined || value === null) return [];

  if (typeof value === "string") {
    const body = value;
    if (body.trim().length === 0) return [];
    return [
      {
        id: `migrated-${hashContent(body).slice(0, 12)}`,
        body,
        createdAt: new Date(0).toISOString(),
        resolved: false,
      },
    ];
  }

  return requireArray(value, where)
    .map((entry, i) => {
      const raw = requireRecord(entry, `${where}[${i}]`);
      return {
        id: requireId(raw.id, `${where}[${i}].id`),
        body: requireString(raw.body, `${where}[${i}].body`),
        createdAt: requireString(raw.createdAt, `${where}[${i}].createdAt`),
        resolved: requireBoolean(raw.resolved, `${where}[${i}].resolved`),
      };
    })
    .filter((entry) => entry.body.trim().length > 0);
}

/**
 * Validates a decoded sidecar and normalizes it to exactly the documented
 * shape — unknown keys are dropped, so what lands on disk always matches the
 * schema the `version` field advertises.
 *
 * An unrecognized `version` is rejected rather than trusted: a sidecar written
 * by a future Quill may mean something different by the same field names, and
 * reading it as v1 would corrupt it on the next write.
 */
export function validateSidecar(value: unknown, where = "sidecar"): SidecarParseResult {
  try {
    const raw = requireRecord(value, where);

    if (typeof raw.version !== "number" || !Number.isInteger(raw.version)) {
      return { ok: false, problem: "shape", reason: `${where}.version must be an integer` };
    }
    if (raw.version !== SIDECAR_VERSION) {
      return {
        ok: false,
        problem: "version",
        reason: `unsupported sidecar version ${raw.version} — this quill reads version ${SIDECAR_VERSION}`,
      };
    }

    const comments = requireArray(raw.comments, `${where}.comments`).map((comment, i) =>
      readComment(comment, `${where}.comments[${i}]`),
    );

    const sidecar: Sidecar = { version: SIDECAR_VERSION, comments };

    /*
     * Empty and absent are the same state, and only one of them may reach the
     * file: an empty array here would rewrite every sidecar written before
     * this field existed, for no change the reviewer made.
     */
    const feedback = readFeedback(raw.feedback, `${where}.feedback`);
    if (feedback.length > 0) sidecar.feedback = feedback;

    return { ok: true, sidecar };
  } catch (err) {
    if (err instanceof ShapeError) return { ok: false, problem: "shape", reason: err.message };
    throw err;
  }
}

/** Parses the raw text of a sidecar file. */
export function parseSidecar(raw: string): SidecarParseResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    return { ok: false, problem: "syntax", reason: `not valid JSON — ${(err as Error).message}` };
  }
  return validateSidecar(value);
}

export type SaveRequestResult =
  | { ok: true; request: SaveAnnotationsRequest }
  | { ok: false; reason: string };

/** Validates a PUT /api/annotations body. */
export function validateSaveAnnotationsRequest(value: unknown): SaveRequestResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "Body must be { sidecar: Sidecar; revision: string }" };
  }

  const raw = value as Record<string, unknown>;
  if (typeof raw.revision !== "string") {
    return { ok: false, reason: "body.revision must be a string" };
  }

  const sidecar = validateSidecar(raw.sidecar, "body.sidecar");
  if (!sidecar.ok) return { ok: false, reason: sidecar.reason };

  return { ok: true, request: { sidecar: sidecar.sidecar, revision: raw.revision } };
}
