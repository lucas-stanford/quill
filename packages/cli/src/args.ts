import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ParsedArgs {
  file: string;
  port: number;
  open: boolean;
}

function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(here, "..", "package.json");
  const raw = readFileSync(pkgPath, "utf-8");
  const pkg = JSON.parse(raw) as { version: string };
  return pkg.version;
}

export function parseCliArgs(): ParsedArgs {
  const { values, positionals } = parseArgs({
    options: {
      port: { type: "string", default: "7823" },
      "no-open": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
      version: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`Usage: quill [file] [options]

  file          Path to the markdown plan file (default: PLAN.md)

Options:
  --port <n>    Port to listen on (default: 7823)
  --no-open     Print the URL instead of opening a browser
  --help        Show this help message
  --version     Show version number`);
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

  return {
    file: (positionals[0] as string | undefined) ?? "PLAN.md",
    port: portNum,
    open: !(values["no-open"] as boolean),
  };
}
