/**
 * Runs every CLI test in one command:
 *
 *   node packages/cli/src/__tests__/run.mjs
 *
 * `packages/cli` has no vitest config and adding one means editing the frozen
 * packages/cli/package.json, so these use the node:test runner that ships with
 * Node — no dependency change. See register-ts.mjs.
 */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tests = readdirSync(here)
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => join(here, name));

const child = spawn(
  process.execPath,
  ["--import", join(here, "register-ts.mjs"), "--test", ...tests],
  { stdio: "inherit" },
);

child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1));
});
