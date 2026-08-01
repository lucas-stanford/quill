import { access, cp, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Publishing without the built web assets would produce a package that
 * installs cleanly and then fails on first run. Refuse to pack instead.
 */

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "../dist");

const required = ["cli.js", "web/index.html"];

for (const rel of required) {
  const target = resolve(dist, rel);
  try {
    await access(target);
  } catch {
    console.error(`[check-package] missing ${target}`);
    console.error("[check-package] run `pnpm build` at the workspace root before packing");
    process.exit(1);
  }
}

const assets = resolve(dist, "web/assets");
const info = await stat(assets).catch(() => null);
if (!info?.isDirectory()) {
  console.error(`[check-package] missing ${assets} — the web build did not produce assets`);
  process.exit(1);
}

// npm shows the package README, so ship the repo one rather than none.
const readmeSrc = resolve(here, "../../../README.md");
const readmeDst = resolve(here, "../README.md");
try {
  await cp(readmeSrc, readmeDst);
} catch {
  console.error("[check-package] could not copy README.md into the package");
  process.exit(1);
}

console.log("[check-package] dist/cli.js, dist/web and README.md are present");
