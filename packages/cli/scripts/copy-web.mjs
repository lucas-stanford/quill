import { cp, mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = resolve(here, "../../web/dist");
const to = resolve(here, "../dist/web");

try {
  await access(from);
} catch {
  console.error(`[copy-web] missing ${from} — run \`pnpm -F @quill/web build\` first`);
  process.exit(1);
}

await mkdir(dirname(to), { recursive: true });
await cp(from, to, { recursive: true });
console.log(`[copy-web] ${from} -> ${to}`);
