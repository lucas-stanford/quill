import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, extname, normalize, basename } from "node:path";
import type { PlanResponse, ErrorResponse } from "./types.js";

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

function sendJson(res: ServerResponse, status: number, body: PlanResponse | ErrorResponse): void {
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

async function handleApiPlan(planPath: string, res: ServerResponse): Promise<void> {
  try {
    const markdown = await readFile(planPath, "utf-8");
    const revision = createHash("sha256").update(markdown).digest("hex");
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

function createHandler(planPath: string, webRoot: string) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "text/plain" });
      res.end("Method Not Allowed");
      return;
    }

    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Bad Request");
      return;
    }

    const { pathname } = url;

    if (pathname === "/api/plan") {
      await handleApiPlan(planPath, res);
      return;
    }

    if (pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    await handleStatic(webRoot, pathname, res);
  };
}

export interface ServerHandle {
  port: number;
}

function bindServer(planPath: string, webRoot: string, port: number): Promise<ServerHandle> {
  const handler = createHandler(planPath, webRoot);

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
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = preferredPort + attempt;
    if (port > 65535) break;

    try {
      return await bindServer(planPath, webRoot, port);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") continue;
      throw err;
    }
  }

  throw new Error(
    `could not find a free port (tried ${maxAttempts} ports starting from ${preferredPort})`,
  );
}
