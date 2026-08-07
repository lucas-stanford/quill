import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { readFile, rename, stat } from "node:fs/promises";
import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { resolve, extname, basename, dirname } from "node:path";
import type {
  AnnotationsResponse,
  CompanionDocument,
  CompanionList,
  ExamplesResponse,
  OptionsResponse,
  ConflictResponse,
  ErrorResponse,
  PlanResponse,
  ReviewOutcome,
  ReviewSummary,
  TicketPlan,
  RevisionState,
  SavePlanRequest,
  Sidecar,
} from "./types.js";
import { hashContent } from "./hash.js";
import { writeFileAtomic } from "./atomic.js";
import { resolveStaticPath } from "./static-path.js";
import { listCompanions, readCompanion, writeCompanion } from "./companions.js";
import { parseOptions, readOptions, writeOptions } from "./options.js";
import {
  mediaExists,
  mediaTypeFor,
  parseManifest,
  readManifest,
  resolveMediaPath,
  writeManifest,
} from "./examples.js";
import { buildTicketPlan, countOpenComments, createTickets } from "./review.js";
import {
  EMPTY_SIDECAR_REVISION,
  corruptBackupPathFor,
  emptySidecar,
  parseSidecar,
  serializeSidecar,
  sidecarPathFor,
  validateSaveAnnotationsRequest,
} from "./sidecar.js";
import { RevisionManager } from "./revision.js";
import type { RevisionManagerOptions } from "./revision.js";
import { validateAgentResponse, validateRevisionRequest } from "./revision-protocol.js";
import type { RevisionMode } from "./revision-protocol.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function mimeFor(filePath: string): string {
  return MIME[extname(filePath)] ?? "application/octet-stream";
}

/** 409 for PUT /api/annotations — the sidecar counterpart of ConflictResponse. */
interface AnnotationsConflictResponse extends ErrorResponse {
  current: AnnotationsResponse;
}

/** 409 for PUT /api/options — carries what is actually on disk. */
interface OptionsConflictResponse extends ErrorResponse {
  current: OptionsResponse;
}

/** 409 for PUT /api/examples — carries what is actually on disk. */
interface ExamplesConflictResponse extends ErrorResponse {
  current: ExamplesResponse;
}

/** 409/500 for /api/revision — carries the state the browser should show. */
interface RevisionErrorResponse extends ErrorResponse {
  current: RevisionState;
}

type JsonBody =
  | PlanResponse
  | ErrorResponse
  | ConflictResponse
  | AnnotationsResponse
  | AnnotationsConflictResponse
  | RevisionState
  | RevisionErrorResponse
  | CompanionList
  | CompanionDocument
  | ExamplesResponse
  | ExamplesConflictResponse
  | OptionsResponse
  | OptionsConflictResponse
  | TicketPlan
  | ReviewSummary;

function sendJson(res: ServerResponse, status: number, body: JsonBody): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(json);
}

// ---------------------------------------------------------------------------
// Live state: SSE clients + watcher
// ---------------------------------------------------------------------------

interface LiveState {
  sseClients: Set<ServerResponse>;
  /** Hash last broadcast to SSE clients (prevents sending unchanged content). */
  lastBroadcastedHash: string;
  /**
   * Hash of the content last written by PUT /api/plan. When the watcher fires
   * and the file's current hash equals this value, the event is our own write
   * and must not be re-broadcast. Comparing current hash against the last
   * written hash (rather than a one-shot boolean) is race-safe: duplicate
   * watcher events from the same save all see the same hash and are all
   * suppressed; a subsequent external write to different content produces a
   * different hash and passes through.
   */
  lastWrittenHash: string | null;
  debounceTimer: NodeJS.Timeout | null;
  /** Kept so shutdown can release it — one watcher per server, not per request. */
  watcher: FSWatcher | null;
}

function createLiveState(): LiveState {
  return {
    sseClients: new Set(),
    lastBroadcastedHash: "",
    lastWrittenHash: null,
    debounceTimer: null,
    watcher: null,
  };
}

function broadcastPlanChanged(state: LiveState, revision: string): void {
  const frame = `event: plan-changed\ndata: ${JSON.stringify({ revision })}\n\n`;
  for (const res of state.sseClients) {
    try {
      res.write(frame);
    } catch {
      state.sseClients.delete(res);
    }
  }
}

async function onFileChanged(planPath: string, state: LiveState): Promise<void> {
  let content: string;
  try {
    content = await readFile(planPath, "utf-8");
  } catch {
    // File may be temporarily absent during an atomic rename; ignore.
    return;
  }

  const hash = hashContent(content);

  if (hash === state.lastBroadcastedHash) return; // content unchanged

  if (hash === state.lastWrittenHash) {
    // This is the echo of our own PUT write — suppress it.
    state.lastBroadcastedHash = hash;
    return;
  }

  // Genuine external change — broadcast.
  state.lastBroadcastedHash = hash;
  broadcastPlanChanged(state, hash);
}

function startWatcher(planPath: string, state: LiveState): void {
  const dir = dirname(planPath);
  const name = basename(planPath);

  // Directory watch, filtered to the plan's own basename: the review sidecar
  // (PLAN.quill.json), its quarantine backups and the .quill-tmp-* files an
  // atomic write creates all live in this directory and must never reach the
  // SSE stream. /api/live is only about the plan — saving annotations must not
  // reload the document the user is typing into.
  const watcher = watch(dir, (_eventType, filename) => {
    if (filename !== name) return;

    if (state.debounceTimer !== null) clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => {
      state.debounceTimer = null;
      void onFileChanged(planPath, state);
    }, 50);
  });

  // Don't prevent clean exit when the event loop drains.
  watcher.unref();
  state.watcher = watcher;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleApiPlanGet(planPath: string, res: ServerResponse): Promise<void> {
  try {
    const markdown = await readFile(planPath, "utf-8");
    const revision = hashContent(markdown);
    const body: PlanResponse = {
      path: planPath,
      name: basename(planPath),
      markdown,
      revision,
    };
    sendJson(res, 200, body);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const body: ErrorResponse = {
      error:
        code === "ENOENT"
          ? `Plan file not found: ${planPath}`
          : "Failed to read plan file",
    };
    sendJson(res, code === "ENOENT" ? 404 : 500, body);
  }
}

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB

/** Shared by PUT /api/plan and PUT /api/annotations — one limit, one behaviour. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((fulfill, reject) => {
    let size = 0;
    let chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Stop buffering, but keep draining the request so the 400 the caller
        // is about to send actually reaches the client instead of a reset.
        chunks = [];
        req.removeAllListeners("data");
        req.resume();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => fulfill(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

async function handleApiPlanPut(
  planPath: string,
  req: IncomingMessage,
  res: ServerResponse,
  state: LiveState,
): Promise<void> {
  let rawBody: string;
  try {
    rawBody = await readBody(req);
  } catch {
    sendJson(res, 400, { error: "Request body too large" });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as Record<string, unknown>).markdown !== "string" ||
    typeof (parsed as Record<string, unknown>).revision !== "string"
  ) {
    sendJson(res, 400, { error: "Body must be { markdown: string; revision: string }" });
    return;
  }

  const { markdown, revision } = parsed as SavePlanRequest;

  // Read current file to check revision and preserve permissions.
  let currentContent: string;
  let fileMode: number;
  try {
    const [content, fileStats] = await Promise.all([
      readFile(planPath, "utf-8"),
      stat(planPath),
    ]);
    currentContent = content;
    fileMode = fileStats.mode;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    sendJson(res, code === "ENOENT" ? 404 : 500, { error: "Failed to read plan file" });
    return;
  }

  const currentHash = hashContent(currentContent);
  if (currentHash !== revision) {
    const conflict: ConflictResponse = {
      error: "The file has been modified since your last load — please reload",
      current: {
        path: planPath,
        name: basename(planPath),
        markdown: currentContent,
        revision: currentHash,
      },
    };
    sendJson(res, 409, conflict);
    return;
  }

  // Atomic write: temp file in the same directory, then rename. Shared with
  // the sidecar writer so both endpoints have one crash-safe write path.
  try {
    await writeFileAtomic(planPath, markdown, fileMode);
  } catch {
    sendJson(res, 500, { error: "Failed to write plan file" });
    return;
  }

  const newHash = hashContent(markdown);
  // Record the hash we just wrote so the watcher can suppress the echo.
  state.lastWrittenHash = newHash;

  const body: PlanResponse = {
    path: planPath,
    name: basename(planPath),
    markdown,
    revision: newHash,
  };
  sendJson(res, 200, body);
}

/** PUT /api/options — picks and drops, guarded like every other write. */
async function handleApiOptionsPut(
  planPath: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let rawBody: string;
  try {
    rawBody = await readBody(req);
  } catch {
    sendJson(res, 400, { error: "Request body too large" });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const raw = parsed as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object" || typeof raw.revision !== "string") {
    sendJson(res, 400, { error: "body.revision must be a string" });
    return;
  }

  const result = await writeOptions(planPath, parseOptions(raw.manifest), raw.revision);
  if (result.ok) {
    sendJson(res, 200, result.state);
    return;
  }
  if (result.status === 409 && result.current) {
    sendJson(res, 409, { error: result.error, current: result.current });
    return;
  }
  sendJson(res, result.status, { error: result.error } satisfies ErrorResponse);
}

/** PUT /api/examples — keep/cut decisions, guarded like every other write. */
async function handleApiExamplesPut(
  planPath: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let rawBody: string;
  try {
    rawBody = await readBody(req);
  } catch {
    sendJson(res, 400, { error: "Request body too large" });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const raw = parsed as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object" || typeof raw.revision !== "string") {
    sendJson(res, 400, { error: "body.revision must be a string" });
    return;
  }

  const result = await writeManifest(planPath, parseManifest(raw.manifest), raw.revision);
  if (result.ok) {
    sendJson(res, 200, result.state);
    return;
  }
  if (result.status === 409 && result.current) {
    sendJson(res, 409, { error: result.error, current: result.current });
    return;
  }
  sendJson(res, result.status, { error: result.error } satisfies ErrorResponse);
}

/**
 * GET /api/examples/media/:file — the screenshots themselves.
 *
 * The name comes from a manifest an agent wrote rather than from a fixed set,
 * so containment is proved rather than assumed, and only image types are
 * served: this endpoint must never become a way to read a file that happens to
 * sit in that directory.
 */
async function handleApiExamplesMedia(
  planPath: string,
  pathname: string,
  res: ServerResponse,
): Promise<void> {
  let requested: string;
  try {
    requested = decodeURIComponent(pathname.slice("/api/examples/media/".length));
  } catch {
    sendJson(res, 404, { error: "Not found" } satisfies ErrorResponse);
    return;
  }

  const type = mediaTypeFor(requested);
  const path = resolveMediaPath(planPath, requested);
  if (type === null || path === null || !(await mediaExists(path))) {
    sendJson(res, 404, { error: "Not found" } satisfies ErrorResponse);
    return;
  }

  try {
    const bytes = await readFile(path);
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": String(bytes.length),
      // The agent may replace a shot in place; a cached one would show the old.
      "Cache-Control": "no-store",
    });
    res.end(bytes);
  } catch {
    sendJson(res, 500, { error: "Failed to read the image" } satisfies ErrorResponse);
  }
}

/** PUT /api/companions/:name — the same guarded write the plan gets. */
async function handleApiCompanionPut(
  planPath: string,
  requested: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let rawBody: string;
  try {
    rawBody = await readBody(req);
  } catch {
    sendJson(res, 400, { error: "Request body too large" });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const raw = parsed as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object" || typeof raw.markdown !== "string") {
    sendJson(res, 400, { error: "body.markdown must be a string" });
    return;
  }
  if (typeof raw.revision !== "string") {
    sendJson(res, 400, { error: "body.revision must be a string" });
    return;
  }

  const result = await writeCompanion(planPath, requested, raw.markdown, raw.revision);
  if (result.ok) {
    sendJson(res, 200, result.document);
    return;
  }
  if (result.status === 409 && result.current) {
    sendJson(res, 409, { error: result.error, current: result.current });
    return;
  }
  sendJson(res, result.status, { error: result.error } satisfies ErrorResponse);
}

// ---------------------------------------------------------------------------
// Annotations (review sidecar)
// ---------------------------------------------------------------------------

interface SidecarState {
  sidecar: Sidecar;
  /** sha256 of exactly the bytes on disk, or of the canonical empty sidecar. */
  revision: string;
  status: "ok" | "missing" | "corrupt";
  /** Set when status is "corrupt". */
  reason?: string;
  /** Permission bits of the file being replaced, when there is one. */
  mode?: number;
}

type SidecarLoad =
  | { kind: "state"; state: SidecarState }
  | { kind: "io-error"; message: string };

/**
 * Reads the sidecar and classifies it.
 *
 * A missing sidecar is not an error — it degrades to the empty sidecar so Quill
 * still works as a plain markdown editor on a plan that was never annotated.
 *
 * A sidecar that exists but cannot be understood (bad JSON, wrong shape,
 * unknown version) also degrades to empty rather than refusing to open the
 * document, but it is never discarded: the next write quarantines it (see
 * handleApiAnnotationsPut) instead of overwriting it, and every read logs
 * loudly. Reading is left free of side effects.
 *
 * A sidecar we cannot read at all (permissions, it's a directory) is a real
 * fault and is reported as one — degrading there would risk clobbering a file
 * whose contents we never saw.
 */
async function loadSidecarState(sidecarPath: string): Promise<SidecarLoad> {
  let raw: string;
  let mode: number;
  try {
    const [content, fileStats] = await Promise.all([
      readFile(sidecarPath, "utf-8"),
      stat(sidecarPath),
    ]);
    raw = content;
    mode = fileStats.mode;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        kind: "state",
        state: { sidecar: emptySidecar(), revision: EMPTY_SIDECAR_REVISION, status: "missing" },
      };
    }
    return {
      kind: "io-error",
      message: `Failed to read ${basename(sidecarPath)}${code ? ` (${code})` : ""}`,
    };
  }

  const parsed = parseSidecar(raw);
  if (!parsed.ok) {
    return {
      kind: "state",
      state: {
        sidecar: emptySidecar(),
        revision: EMPTY_SIDECAR_REVISION,
        status: "corrupt",
        reason: parsed.reason,
        mode,
      },
    };
  }

  // The revision is the hash of the bytes actually on disk, so a GET after a
  // PUT reports exactly the revision that PUT returned.
  return {
    kind: "state",
    state: { sidecar: parsed.sidecar, revision: hashContent(raw), status: "ok", mode },
  };
}

function warnCorruptSidecar(sidecarPath: string, reason: string | undefined): void {
  console.error(
    `quill: ${basename(sidecarPath)} could not be read — ${reason ?? "unknown problem"}`,
  );
  console.error(
    "  Continuing with no comments. The file is left untouched; the next save moves it aside to a .corrupt-* backup rather than overwriting it.",
  );
}

async function handleApiAnnotationsGet(sidecarPath: string, res: ServerResponse): Promise<void> {
  const load = await loadSidecarState(sidecarPath);

  if (load.kind === "io-error") {
    sendJson(res, 500, { error: load.message });
    return;
  }

  const { state } = load;
  if (state.status === "corrupt") warnCorruptSidecar(sidecarPath, state.reason);

  const body: AnnotationsResponse = { sidecar: state.sidecar, revision: state.revision };
  sendJson(res, 200, body);
}

async function handleApiAnnotationsPut(
  sidecarPath: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let rawBody: string;
  try {
    rawBody = await readBody(req);
  } catch {
    sendJson(res, 400, { error: "Request body too large" });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const validated = validateSaveAnnotationsRequest(parsed);
  if (!validated.ok) {
    sendJson(res, 400, { error: validated.reason });
    return;
  }

  const { sidecar, revision } = validated.request;

  const load = await loadSidecarState(sidecarPath);
  if (load.kind === "io-error") {
    sendJson(res, 500, { error: load.message });
    return;
  }
  const { state } = load;

  if (state.revision !== revision) {
    const conflict: AnnotationsConflictResponse = {
      error: "The review sidecar has been modified since your last load — please reload",
      current: { sidecar: state.sidecar, revision: state.revision },
    };
    sendJson(res, 409, conflict);
    return;
  }

  if (state.status === "corrupt") {
    // Never silently discard review data we failed to parse: move it aside,
    // keeping the bytes, before writing a fresh sidecar in its place.
    const backupPath = corruptBackupPathFor(sidecarPath);
    try {
      await rename(sidecarPath, backupPath);
      console.error(`quill: moved unreadable ${basename(sidecarPath)} to ${basename(backupPath)}`);
    } catch (err) {
      sendJson(res, 500, {
        error: `Refusing to overwrite an unreadable ${basename(sidecarPath)} — could not move it aside (${(err as Error).message})`,
      });
      return;
    }
  }

  // Hash exactly the bytes written, and write exactly the bytes hashed.
  const serialized = serializeSidecar(sidecar);
  try {
    await writeFileAtomic(sidecarPath, serialized, state.status === "ok" ? state.mode : undefined);
  } catch {
    sendJson(res, 500, { error: `Failed to write ${basename(sidecarPath)}` });
    return;
  }

  const body: AnnotationsResponse = { sidecar, revision: hashContent(serialized) };
  sendJson(res, 200, body);
}

// ---------------------------------------------------------------------------
// Revision (the agent bridge)
// ---------------------------------------------------------------------------

/**
 * POST /api/revision — asks for a revision of the plan.
 *
 * Returns the state, never the finished text: in both modes the answer arrives
 * later, by polling GET /api/revision. A second request while one is in flight
 * is refused with 409 rather than raced — two agents rewriting one plan is a
 * lost-update bug that no amount of conflict checking downstream can repair.
 */
async function handleApiRevisionPost(
  revision: RevisionManager,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let rawBody: string;
  try {
    rawBody = await readBody(req);
  } catch {
    sendJson(res, 400, { error: "Request body too large" });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const validated = validateRevisionRequest(parsed);
  if (!validated.ok) {
    sendJson(res, 400, { error: validated.reason });
    return;
  }

  const started = await revision.start(
    validated.brief,
    validated.prompt,
    validated.target,
    validated.scope,
  );
  if (!started.ok) {
    sendJson(res, started.status, { error: started.error, current: started.current });
    return;
  }

  sendJson(res, 200, started.state);
}

/**
 * PUT /api/revision — the parent agent's completion signal, for an agent that
 * would rather curl than write `.quill/revision-response.json`. Same payload as
 * the file. See AGENT-BRIDGE.md.
 */
async function handleApiRevisionPut(
  revision: RevisionManager,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let rawBody: string;
  try {
    rawBody = await readBody(req);
  } catch {
    sendJson(res, 400, { error: "Request body too large" });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const validated = validateAgentResponse(parsed, "body");
  if (!validated.ok) {
    sendJson(res, 400, { error: validated.reason });
    return;
  }

  const submitted = await revision.submitAgentResponse(validated.response);
  if (!submitted.ok) {
    sendJson(res, submitted.status, { error: submitted.error, current: submitted.current });
    return;
  }

  sendJson(res, 200, submitted.state);
}

function handleApiLive(
  req: IncomingMessage,
  res: ServerResponse,
  state: LiveState,
): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  // Flush headers immediately so the client sees the stream open.
  res.flushHeaders();

  state.sseClients.add(res);

  const keepalive = setInterval(() => {
    try {
      res.write(":keepalive\n\n");
    } catch {
      cleanup();
    }
  }, 25_000);
  // Don't hold the process open just for a keepalive timer.
  keepalive.unref();

  function cleanup(): void {
    clearInterval(keepalive);
    state.sseClients.delete(res);
  }

  req.on("close", cleanup);
  req.on("error", cleanup);
  res.on("close", cleanup);
  res.on("error", cleanup);
}

async function handleStatic(webRoot: string, pathname: string, res: ServerResponse): Promise<void> {
  const resolved = resolveStaticPath(webRoot, pathname);

  if (!resolved.ok) {
    if (resolved.reason === "malformed") {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Bad Request");
    } else {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden");
    }
    return;
  }

  const { filePath } = resolved;

  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mimeFor(filePath) });
    res.end(data);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR") {
      // SPA fallback: serve index.html for unknown paths that aren't /api
      try {
        const data = await readFile(resolve(webRoot, "index.html"));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(data);
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
      }
    } else {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal server error");
    }
  }
}

// ---------------------------------------------------------------------------
// Review: preview the ticket breakdown, then finish and release the CLI
// ---------------------------------------------------------------------------

async function handleTicketPreview(planPath: string, res: ServerResponse): Promise<void> {
  try {
    const markdown = await readFile(planPath, "utf-8");
    sendJson(res, 200, await buildTicketPlan(planPath, markdown));
  } catch {
    sendJson(res, 500, { error: "Failed to read the plan" });
  }
}

const OUTCOMES: ReviewOutcome[] = ["approved", "cancelled", "errored"];

async function handleFinishReview(
  planPath: string,
  sidecarPath: string,
  req: IncomingMessage,
  res: ServerResponse,
  onFinish: (summary: ReviewSummary) => void,
): Promise<void> {
  let body: unknown;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const outcome = (body as { outcome?: unknown })?.outcome;
  if (typeof outcome !== "string" || !OUTCOMES.includes(outcome as ReviewOutcome)) {
    sendJson(res, 400, { error: `body.outcome must be one of ${OUTCOMES.join(", ")}` });
    return;
  }
  const wantsTickets = (body as { createTickets?: unknown })?.createTickets === true;

  let markdown = "";
  try {
    markdown = await readFile(planPath, "utf-8");
  } catch {
    sendJson(res, 500, { error: "Failed to read the plan" });
    return;
  }

  const summary: ReviewSummary = {
    outcome: outcome as ReviewOutcome,
    planPath,
    revision: hashContent(markdown),
    openComments: await countOpenComments(sidecarPath),
  };

  if (outcome === "approved" && wantsTickets) {
    const plan = await buildTicketPlan(planPath, markdown);
    if (!plan.available) {
      // The handoff is optional; a missing fer must never fail an approval.
      summary.error = plan.reason;
    } else {
      const created = await createTickets(planPath, plan.tickets);
      summary.tickets = created.ids;
      if (created.error) summary.error = created.error;
    }
  }

  sendJson(res, 200, summary);
  // Let the response flush before the process goes.
  res.on("finish", () => onFinish(summary));
}

// ---------------------------------------------------------------------------
// Request router
// ---------------------------------------------------------------------------

function createHandler(
  planPath: string,
  webRoot: string,
  state: LiveState,
  revision: RevisionManager,
  onFinish: (summary: ReviewSummary) => void,
) {
  const sidecarPath = sidecarPathFor(planPath);

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Bad Request");
      return;
    }

    const { pathname } = url;
    const method = (req.method ?? "GET").toUpperCase();

    if (pathname === "/api/plan") {
      if (method === "GET") {
        await handleApiPlanGet(planPath, res);
      } else if (method === "PUT") {
        await handleApiPlanPut(planPath, req, res, state);
      } else {
        res.writeHead(405, { "Content-Type": "text/plain", Allow: "GET, PUT" });
        res.end("Method Not Allowed");
      }
      return;
    }

    if (pathname === "/api/options") {
      if (method === "GET") {
        sendJson(res, 200, await readOptions(planPath));
      } else if (method === "PUT") {
        await handleApiOptionsPut(planPath, req, res);
      } else {
        res.writeHead(405, { "Content-Type": "text/plain", Allow: "GET, PUT" });
        res.end("Method Not Allowed");
      }
      return;
    }

    if (pathname === "/api/examples") {
      if (method === "GET") {
        const state = await readManifest(planPath);
        sendJson(res, 200, state);
      } else if (method === "PUT") {
        await handleApiExamplesPut(planPath, req, res);
      } else {
        res.writeHead(405, { "Content-Type": "text/plain", Allow: "GET, PUT" });
        res.end("Method Not Allowed");
      }
      return;
    }

    if (pathname.startsWith("/api/examples/media/")) {
      if (method !== "GET") {
        res.writeHead(405, { "Content-Type": "text/plain", Allow: "GET" });
        res.end("Method Not Allowed");
        return;
      }
      await handleApiExamplesMedia(planPath, pathname, res);
      return;
    }

    if (pathname === "/api/companions") {
      if (method === "GET") {
        sendJson(res, 200, await listCompanions(planPath));
      } else {
        res.writeHead(405, { "Content-Type": "text/plain", Allow: "GET" });
        res.end("Method Not Allowed");
      }
      return;
    }

    if (pathname.startsWith("/api/companions/")) {
      if (method !== "GET" && method !== "PUT") {
        res.writeHead(405, { "Content-Type": "text/plain", Allow: "GET, PUT" });
        res.end("Method Not Allowed");
        return;
      }
      /*
       * Decoded before the allowlist check, so an encoded name is matched as
       * the name it decodes to rather than slipping through as a literal. A
       * malformed escape is simply not a companion.
       */
      let requested: string;
      try {
        requested = decodeURIComponent(pathname.slice("/api/companions/".length));
      } catch {
        sendJson(res, 404, { error: "Not a companion document" } satisfies ErrorResponse);
        return;
      }
      if (method === "PUT") {
        await handleApiCompanionPut(planPath, requested, req, res);
        return;
      }

      const result = await readCompanion(planPath, requested);
      if (result.ok) {
        sendJson(res, 200, result.document);
      } else {
        sendJson(res, result.status, { error: result.error } satisfies ErrorResponse);
      }
      return;
    }

    if (pathname === "/api/annotations") {
      if (method === "GET") {
        await handleApiAnnotationsGet(sidecarPath, res);
      } else if (method === "PUT") {
        await handleApiAnnotationsPut(sidecarPath, req, res);
      } else {
        res.writeHead(405, { "Content-Type": "text/plain", Allow: "GET, PUT" });
        res.end("Method Not Allowed");
      }
      return;
    }

    if (pathname === "/api/live") {
      if (method === "GET") {
        handleApiLive(req, res, state);
      } else {
        res.writeHead(405, { "Content-Type": "text/plain", Allow: "GET" });
        res.end("Method Not Allowed");
      }
      return;
    }

    if (pathname === "/api/revision") {
      if (method === "GET") {
        sendJson(res, 200, revision.getState());
      } else if (method === "POST") {
        await handleApiRevisionPost(revision, req, res);
      } else if (method === "PUT") {
        await handleApiRevisionPut(revision, req, res);
      } else if (method === "DELETE") {
        await revision.cancel();
        res.writeHead(204);
        res.end();
      } else {
        res.writeHead(405, {
          "Content-Type": "text/plain",
          Allow: "GET, POST, PUT, DELETE",
        });
        res.end("Method Not Allowed");
      }
      return;
    }

    if (pathname === "/api/tickets/preview") {
      if (method === "GET") {
        await handleTicketPreview(planPath, res);
      } else {
        res.writeHead(405, { "Content-Type": "text/plain", Allow: "GET" });
        res.end("Method Not Allowed");
      }
      return;
    }

    if (pathname === "/api/review/finish") {
      if (method === "POST") {
        await handleFinishReview(planPath, sidecarPath, req, res, onFinish);
      } else {
        res.writeHead(405, { "Content-Type": "text/plain", Allow: "POST" });
        res.end("Method Not Allowed");
      }
      return;
    }

    if (pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    if (method !== "GET") {
      res.writeHead(405, { "Content-Type": "text/plain", Allow: "GET" });
      res.end("Method Not Allowed");
      return;
    }

    await handleStatic(webRoot, pathname, res);
  };
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

export interface ServerHandle {
  port: number;
  /** The revision bridge, exposed so tests and shutdown can reach it. */
  revision: RevisionManager;
  /** Graceful stop: closes the watcher, ends SSE clients, stops listening. */
  close(): Promise<void>;
  /** Signal-handler-safe stop: kills a running agent, clears the queue file. */
  shutdownSync(): void;
}

export interface StartServerOptions {
  /** Who services a revision request. See revision-protocol.ts. */
  mode: RevisionMode;
  /** Milliseconds before an unfinished revision fails. 0 disables. */
  revisionTimeoutMs?: number;
  /** Ports scanned upward from the preferred one on EADDRINUSE. */
  maxAttempts?: number;
  /** Test seams, forwarded to the revision manager. */
  revisionOptions?: Pick<RevisionManagerOptions, "spawnFn" | "pollIntervalMs" | "logger">;
  /** Called once the review ends, after the response has flushed. */
  onFinish: (summary: ReviewSummary) => void;
}

function closeServer(
  server: Server,
  state: LiveState,
  revision: RevisionManager,
): Promise<void> {
  return new Promise((fulfill) => {
    if (state.debounceTimer !== null) clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
    state.watcher?.close();
    state.watcher = null;
    revision.shutdownSync();

    // An open SSE response keeps the socket alive forever, so close() would
    // never call back.
    for (const client of state.sseClients) {
      try {
        client.end();
      } catch {
        /* already gone */
      }
    }
    state.sseClients.clear();

    server.close(() => fulfill());
    server.closeAllConnections?.();
  });
}

function bindServer(
  planPath: string,
  webRoot: string,
  port: number,
  state: LiveState,
  revision: RevisionManager,
  onFinish: (summary: ReviewSummary) => void,
): Promise<ServerHandle> {
  const handler = createHandler(planPath, webRoot, state, revision, onFinish);

  return new Promise((fulfill, reject) => {
    const server = createServer((req, res) => {
      handler(req, res).catch((err: unknown) => {
        console.error("quill: request error:", (err as Error).message);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("Internal server error");
        }
      });
    });

    server.listen(port, "127.0.0.1", () => {
      // Report the port actually bound, so a caller may pass 0 and be told.
      const address = server.address();
      const boundPort = typeof address === "object" && address !== null ? address.port : port;
      fulfill({
        port: boundPort,
        revision,
        close: () => closeServer(server, state, revision),
        shutdownSync: () => {
          state.watcher?.close();
          state.watcher = null;
          revision.shutdownSync();
        },
      });
    });

    server.on("error", reject);
  });
}

export async function startServer(
  planPath: string,
  webRoot: string,
  preferredPort: number,
  options: StartServerOptions,
): Promise<ServerHandle> {
  const state = createLiveState();
  const maxAttempts = options.maxAttempts ?? 20;

  const revision = new RevisionManager({
    planPath,
    mode: options.mode,
    timeoutMs: options.revisionTimeoutMs,
    ...options.revisionOptions,
  });
  await revision.sweepStaleRequest();

  // Seed lastBroadcastedHash from the current file so the first watcher event
  // after startup is only emitted if the content actually changed.
  try {
    const initial = await readFile(planPath, "utf-8");
    state.lastBroadcastedHash = hashContent(initial);
  } catch {
    /* file may not exist yet; watcher will handle it */
  }

  startWatcher(planPath, state);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = preferredPort + attempt;
    if (port > 65535) break;

    try {
      return await bindServer(planPath, webRoot, port, state, revision, options.onFinish);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") continue;
      throw err;
    }
  }

  state.watcher?.close();
  throw new Error(
    `could not find a free port (tried ${maxAttempts} ports starting from ${preferredPort})`,
  );
}
