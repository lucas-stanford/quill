import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRevisionMode } from "./revision-protocol.js";
import type { ModeSource, RevisionMode } from "./revision-protocol.js";
import { DEFAULT_REVISION_TIMEOUT_MS } from "./revision.js";

export interface ParsedArgs {
  file: string;
  port: number;
  open: boolean;
  /** Who services `POST /api/revision`. */
  mode: RevisionMode;
  /** Where the mode came from, printed at startup so it is never a surprise. */
  modeSource: ModeSource;
  /** Human-readable justification for `mode`. */
  modeDetail: string;
  /** Milliseconds before an unfinished revision fails. 0 disables the timeout. */
  revisionTimeoutMs: number;
}

function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(here, "..", "package.json");
  const raw = readFileSync(pkgPath, "utf-8");
  const pkg = JSON.parse(raw) as { version: string };
  return pkg.version;
}

/** Seconds -> milliseconds, or `null` when the value is not a usable timeout. */
export function parseTimeoutSeconds(value: string): number | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "off" || trimmed === "none") return 0;
  if (trimmed === "") return null;
  const seconds = Number(trimmed);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.round(seconds * 1000);
}

export function parseCliArgs(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): ParsedArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      port: { type: "string", default: "7823" },
      "no-open": { type: "boolean", default: false },
      attached: { type: "boolean", default: false },
      detached: { type: "boolean", default: false },
      "revision-timeout": { type: "string" },
      help: { type: "boolean", default: false },
      version: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`Usage: quill [file] [options]

  file          Path to the markdown plan file (default: PLAN.md)

Options:
  --port <n>              Port to listen on (default: 7823)
  --no-open               Print the URL instead of opening a browser
  --attached              A parent agent services "Update with AI" by picking up
                          .quill/revision-request.json (see AGENT-BRIDGE.md)
  --detached              Quill runs the \`copilot\` CLI itself (default)
  --revision-timeout <s>  Seconds before an unanswered revision fails
                          (default: ${Math.round(DEFAULT_REVISION_TIMEOUT_MS / 1000)}, "off" to disable)
  --help                  Show this help message
  --version               Show version number

Environment:
  QUILL_ATTACHED=1        Same as --attached. Set this when spawning quill from
                          an agent that will service revision requests itself.
  QUILL_REVISION_TIMEOUT  Same as --revision-timeout.

Exit codes:
  0   approved   the reviewer approved the plan
  10  cancelled  the review ended without approval (including Ctrl-C)
  11  errored    the review could not be completed
  1   startup failure (bad arguments, missing file, no free port)

On exit quill prints the review summary as one line of JSON on stdout;
everything else goes to stderr, so a parent can read stdout directly:

  quill PLAN.md --no-open | jq -r .outcome`);
    process.exit(0);
  }

  if (values.version) {
    console.log(readVersion());
    process.exit(0);
  }

  const portStr = (values.port ?? "7823") as string;
  const portNum = parseInt(portStr, 10);
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    console.error(`quill: invalid port "${portStr}" — must be a number between 1 and 65535`);
    process.exit(1);
  }

  // A flag beats the environment: a human debugging a spawned quill has to be
  // able to override whatever the parent claimed.
  let mode;
  try {
    mode = resolveRevisionMode({
      attachedFlag: values.attached as boolean,
      detachedFlag: values.detached as boolean,
      env: env.QUILL_ATTACHED,
    });
  } catch (err) {
    console.error(`quill: ${(err as Error).message}`);
    process.exit(1);
  }

  const timeoutRaw =
    (values["revision-timeout"] as string | undefined) ?? env.QUILL_REVISION_TIMEOUT;
  let revisionTimeoutMs = DEFAULT_REVISION_TIMEOUT_MS;
  if (timeoutRaw !== undefined && timeoutRaw.trim() !== "") {
    const parsed = parseTimeoutSeconds(timeoutRaw);
    if (parsed === null) {
      console.error(
        `quill: invalid revision timeout "${timeoutRaw}" — expected a number of seconds, or "off"`,
      );
      process.exit(1);
    }
    revisionTimeoutMs = parsed;
  }

  return {
    file: (positionals[0] as string | undefined) ?? "PLAN.md",
    port: portNum,
    open: !(values["no-open"] as boolean),
    mode: mode.mode,
    modeSource: mode.source,
    modeDetail: mode.detail,
    revisionTimeoutMs,
  };
}
