import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, writeFile, rename, stat, unlink, chmod } from "node:fs/promises";
import { watch } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, extname, normalize, basename, dirname } from "node:path";
import type { PlanResponse, ErrorResponse, SavePlanRequest, ConflictResponse } from "./types.js";

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

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: PlanResponse | ErrorResponse | ConflictResponse,
): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(json);
}

/**
 * Resolves a URL pathname to a file path inside webRoot.
 * Returns null if the resolved path escapes webRoot (path traversal guard).
 */
function resolveStaticPath(webRoot: string, pathname: string): string | null {
  const relative = pathname.replace(/^\/+/, "") || "index.html";
  const resolved = resolve(webRoot, normalize(relative));

  // Guard: resolved path must remain inside webRoot
  const safePrefix = webRoot.endsWith("/") ? webRoot : webRoot + "/";
  if (!resolved.startsWith(safePrefix) && resolved !== webRoot) {
    return null;
  }

  return resolved;
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
}

function createLiveState(): LiveState {
  return {
    sseClients: new Set(),
    lastBroadcastedHash: "",
    lastWrittenHash: null,
    debounceTimer: null,
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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
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

  // Atomic write: write to a temp file in the same directory, then rename.
  // rename(2) within a directory is atomic; a crash mid-write leaves the
  // original file intact.
  const dir = dirname(planPath);
  const tmpPath = resolve(
    dir,
    `.quill-tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  try {
    await writeFile(tmpPath, markdown, "utf-8");
    await chmod(tmpPath, fileMode & 0o777);
    await rename(tmpPath, planPath);
  } catch {
    try {
      await unlink(tmpPath);
    } catch {
      /* best-effort cleanup */
    }
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
  const filePath = resolveStaticPath(webRoot, pathname);

  if (filePath === null) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mimeFor(filePath) });
    res.end(data);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
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
// Request router
// ---------------------------------------------------------------------------

function createHandler(planPath: string, webRoot: string, state: LiveState) {
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

    if (pathname === "/api/live") {
      if (method === "GET") {
        handleApiLive(req, res, state);
      } else {
        res.writeHead(405, { "Content-Type": "text/plain", Allow: "GET" });
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
}

function bindServer(
  planPath: string,
  webRoot: string,
  port: number,
  state: LiveState,
): Promise<ServerHandle> {
  const handler = createHandler(planPath, webRoot, state);

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
      fulfill({ port });
    });

    server.on("error", reject);
  });
}

export async function startServer(
  planPath: string,
  webRoot: string,
  preferredPort: number,
  maxAttempts = 20,
): Promise<ServerHandle> {
  const state = createLiveState();

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
      return await bindServer(planPath, webRoot, port, state);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") continue;
      throw err;
    }
  }

  throw new Error(
    `could not find a free port (tried ${maxAttempts} ports starting from ${preferredPort})`,
  );
}
