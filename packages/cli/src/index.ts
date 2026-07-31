import { resolve, basename, extname, dirname } from "node:path";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import open from "open";
import { parseCliArgs } from "./args.js";
import { startServer } from "./server.js";
import { AGENT_COMMAND } from "./revision.js";
import { QUILL_DIR, REQUEST_FILENAME } from "./revision-protocol.js";

async function main(): Promise<void> {
  const args = parseCliArgs();

  const filePath = resolve(process.cwd(), args.file);

  // Validate the plan file
  const fileStats = await stat(filePath).catch((err: unknown) => {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      console.error(`quill: file not found: ${filePath}`);
    } else {
      console.error(`quill: cannot access "${filePath}": ${(err as Error).message}`);
    }
    process.exit(1);
  });

  if (fileStats.isDirectory()) {
    console.error(`quill: "${filePath}" is a directory — please provide a .md file`);
    process.exit(1);
  }

  if (extname(filePath).toLowerCase() !== ".md") {
    console.error(`quill: "${basename(filePath)}" is not a markdown file — expected a .md extension`);
    process.exit(1);
  }

  // Locate dist/web/ relative to this bundle
  const distDir = dirname(fileURLToPath(import.meta.url));
  const webRoot = resolve(distDir, "web");

  await stat(webRoot).catch(() => {
    console.error(`quill: web app not found at ${webRoot}`);
    console.error(`  Run \`pnpm build\` to build the web app first.`);
    process.exit(1);
  });

  // Start server, scanning upward from preferred port on EADDRINUSE
  const server = await startServer(filePath, webRoot, args.port, {
    mode: args.mode,
    revisionTimeoutMs: args.revisionTimeoutMs,
  }).catch((err: unknown) => {
    console.error(`quill: failed to start server — ${(err as Error).message}`);
    process.exit(1);
  });

  if (server.port !== args.port) {
    console.log(`quill: port ${args.port} was in use, using ${server.port}`);
  }

  const url = `http://127.0.0.1:${server.port}`;
  console.log(`quill  ${basename(filePath)}`);
  console.log(`  → ${url}`);
  console.log(
    args.mode === "attached"
      ? `  → attached (${args.modeDetail}): "Update with AI" queues ${QUILL_DIR}/${REQUEST_FILENAME} for the parent agent`
      : `  → detached (${args.modeDetail}): "Update with AI" runs \`${AGENT_COMMAND}\` here`,
  );

  if (args.open) {
    await open(url);
  }

  const stop = (): void => {
    // Kill a running agent and clear the queue file before going: a request
    // left behind would be serviced into a browser that no longer exists.
    server.shutdownSync();
    process.exit(0);
  };

  process.on("SIGINT", stop);
  // A parent agent that spawned quill is more likely to send SIGTERM than ^C.
  process.on("SIGTERM", stop);
}

main().catch((err: unknown) => {
  console.error(`quill: unexpected error: ${(err as Error).message}`);
  process.exit(1);
});

