/**
 * Loads the real TypeScript markdown module into Node.
 *
 * The previous version of the round-trip check kept a hand-written JavaScript
 * copy of the parser and serializer, which could silently drift from the code
 * that actually ships. This bundles `src/markdown/index.ts` with the esbuild
 * that Vite already depends on and imports the result, so the check can only
 * ever describe the real implementation. No new dependency is involved.
 */

import { readdirSync } from "fs";
import { createRequire } from "module";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));

/** `packages/web` */
export const webRoot = resolve(here, "../../..");
/** repository root */
export const repoRoot = resolve(webRoot, "../..");

function loadEsbuild() {
  const store = resolve(repoRoot, "node_modules/.pnpm");
  const dir = readdirSync(store).find((d) => d.startsWith("esbuild@"));
  if (!dir) throw new Error("esbuild not found in node_modules/.pnpm");
  const require = createRequire(
    resolve(store, dir, "node_modules/esbuild/package.json"),
  );
  return require("esbuild");
}

export async function loadMarkdownModule() {
  const esbuild = loadEsbuild();
  const result = await esbuild.build({
    entryPoints: [resolve(webRoot, "src/markdown/index.ts")],
    absWorkingDir: webRoot,
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node20",
  });
  const code = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${code}`);
}
