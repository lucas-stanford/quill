import { resolve, basename, extname, dirname } from "node:path";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import open from "open";
import { parseCliArgs } from "./args.js";
import { startServer } from "./server.js";

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
  const server = await startServer(filePath, webRoot, args.port).catch((err: unknown) => {
    console.error(`quill: failed to start server — ${(err as Error).message}`);
    process.exit(1);
  });

  if (server.port !== args.port) {
    console.log(`quill: port ${args.port} was in use, using ${server.port}`);
  }

  const url = `http://127.0.0.1:${server.port}`;
  console.log(`quill  ${basename(filePath)}`);
  console.log(`  → ${url}`);

  if (args.open) {
    await open(url);
  }

  process.on("SIGINT", () => {
    process.exit(0);
  });
}

main().catch((err: unknown) => {
  console.error(`quill: unexpected error: ${(err as Error).message}`);
  process.exit(1);
});

