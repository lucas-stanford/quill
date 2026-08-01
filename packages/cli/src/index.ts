import { resolve, basename, extname, dirname } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import open from "open";
import { parseCliArgs } from "./args.js";
import { startServer } from "./server.js";
import { AGENT_COMMAND } from "./revision.js";
import { QUILL_DIR, REQUEST_FILENAME } from "./revision-protocol.js";
import { EXIT_APPROVED, EXIT_CANCELLED, EXIT_ERRORED } from "./review.js";
import type { ReviewSummary } from "./types.js";

/**
 * stdout carries exactly one line: the ReviewSummary as JSON, so a parent
 * agent can read it without parsing prose. Everything a human reads goes to
 * stderr, where it cannot corrupt that line.
 */
const say = (line: string): void => {
  process.stderr.write(line + "\n");
};

const EXIT_FOR: Record<ReviewSummary["outcome"], number> = {
  approved: EXIT_APPROVED,
  cancelled: EXIT_CANCELLED,
  errored: EXIT_ERRORED,
};

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
  let onFinish: (summary: ReviewSummary) => void = () => {};
  const server = await startServer(filePath, webRoot, args.port, {
    mode: args.mode,
    revisionTimeoutMs: args.revisionTimeoutMs,
    onFinish: (summary) => onFinish(summary),
  }).catch((err: unknown) => {
    console.error(`quill: failed to start server — ${(err as Error).message}`);
    process.exit(1);
  });

  if (server.port !== args.port) {
    say(`quill: port ${args.port} was in use, using ${server.port}`);
  }

  const url = `http://127.0.0.1:${server.port}`;
  say(`quill  ${basename(filePath)}`);
  say(`  → ${url}`);
  say(
    args.mode === "attached"
      ? `  → attached (${args.modeDetail}): "Update with AI" queues ${QUILL_DIR}/${REQUEST_FILENAME} for the parent agent`
      : `  → detached (${args.modeDetail}): "Update with AI" runs \`${AGENT_COMMAND}\` here`,
  );

  if (args.open) {
    await open(url);
  }

  const finish = (summary: ReviewSummary): void => {
    server.shutdownSync();
    process.stdout.write(JSON.stringify(summary) + "\n");
    if (summary.outcome === "approved") {
      say(
        summary.tickets?.length
          ? `quill: approved — ${summary.tickets.length} ticket(s) created`
          : "quill: approved",
      );
    } else {
      say(`quill: ${summary.outcome}`);
    }
    if (summary.error) say(`quill: ${summary.error}`);
    process.exit(EXIT_FOR[summary.outcome]);
  };
  onFinish = finish;

  const stop = (): void => {
    // Ctrl-C is a cancellation. Emit a summary anyway so a parent agent is
    // never left guessing why the review ended.
    server.shutdownSync();
    void readFile(filePath, "utf-8")
      .catch(() => "")
      .then((markdown) => {
        finish({
          outcome: "cancelled",
          planPath: filePath,
          revision: createHash("sha256").update(markdown).digest("hex"),
          openComments: 0,
        });
      });
  };

  process.on("SIGINT", stop);
  // A parent agent that spawned quill is more likely to send SIGTERM than ^C.
  process.on("SIGTERM", stop);
}

main().catch((err: unknown) => {
  console.error(`quill: unexpected error: ${(err as Error).message}`);
  process.exit(1);
});

