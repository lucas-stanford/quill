/**
 * Shared scaffolding for the M4 bridge tests: throwaway workspaces under
 * `__tests__/.tmp/` (never /tmp — the sandbox this runs in rejects it) and a
 * polling wait so no test sleeps for a fixed guess.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
export const TMP_ROOT = join(TESTS_DIR, ".tmp");

/** The stand-in for the `copilot` CLI, driven by FAKE_COPILOT_* env vars. */
export const FAKE_COPILOT = join(TESTS_DIR, "fake-copilot.mjs");

export function makeWorkspace(name) {
  mkdirSync(TMP_ROOT, { recursive: true });
  return mkdtempSync(join(TMP_ROOT, `${name}-`));
}

export function removeWorkspace(dir) {
  rmSync(dir, { recursive: true, force: true });
}

export function sleep(ms) {
  return new Promise((fulfill) => setTimeout(fulfill, ms));
}

/** Resolves when `predicate()` returns a truthy value, or throws on timeout. */
export async function waitFor(predicate, { timeout = 5_000, interval = 10, what = "condition" } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(interval);
  }
}

/** True while a pid is alive. Used to prove a cancelled child is really gone. */
export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

export function brief(overrides = {}) {
  return {
    markdown: "# Plan\n\nShip the thing on Friday.\n",
    comments: [],
    edits: [],
    ...overrides,
  };
}
