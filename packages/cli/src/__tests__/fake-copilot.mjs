#!/usr/bin/env node
/**
 * A stand-in for the `copilot` CLI, so detached mode can be tested end to end
 * without one installed. Behaviour is chosen with FAKE_COPILOT_MODE:
 *
 *   revise  (default) print a revised plan on stdout, exit 0
 *   empty             print nothing, exit 0
 *   fail              write to stderr, exit 3
 *   hang              run until killed (writes its pid to FAKE_COPILOT_PID_FILE)
 *
 * With FAKE_COPILOT_ARGV_FILE set it dumps its own argv as JSON first, which is
 * how the tests prove the prompt arrives as one argument and never touches a
 * shell.
 */
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);

if (process.env.FAKE_COPILOT_ARGV_FILE) {
  writeFileSync(process.env.FAKE_COPILOT_ARGV_FILE, JSON.stringify(argv, null, 2), "utf-8");
}

const mode = process.env.FAKE_COPILOT_MODE ?? "revise";

if (mode === "empty") {
  process.exit(0);
}

if (mode === "fail") {
  process.stderr.write("copilot: not authenticated — run `copilot auth login`\n");
  process.exit(3);
}

if (mode === "hang") {
  if (process.env.FAKE_COPILOT_PID_FILE) {
    writeFileSync(process.env.FAKE_COPILOT_PID_FILE, String(process.pid), "utf-8");
  }
  setInterval(() => {}, 1_000);
} else {
  const output =
    process.env.FAKE_COPILOT_OUTPUT ?? "# Plan\n\nShip the thing next sprint.\n";
  process.stdout.write(output);
}
