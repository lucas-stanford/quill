/**
 * Options — candidate names, and picking one.
 *
 * Naming is the decision people most want alternatives for and least want to
 * make alone at 11pm with one idea. So Quill can ask for a spread of
 * candidates, with optional steering, and keep them: the ones you rejected are
 * as useful as the one you took, because the next round should not offer them
 * again.
 *
 * A poll per round rather than one flat list. Asking again with sharper
 * steering is the normal way this goes — "shorter", "no compound words", "less
 * on the nose" — and a round records what was asked as well as what came back,
 * so the history reads as the argument it was.
 *
 * Same shape as the examples manifest deliberately: a file the agent writes,
 * read tolerantly, written back under a revision guard.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { hashContent } from "./hash.js";
import { writeFileAtomic } from "./atomic.js";
import type { OptionPoll, OptionsManifest, NameOption } from "./types.js";

export const OPTIONS_DIR = "research";
export const OPTIONS_FILE = "options.json";
export const OPTIONS_VERSION = 1;

export function optionsPathFor(planPath: string): string {
  return join(dirname(planPath), OPTIONS_DIR, OPTIONS_FILE);
}

export function emptyOptions(): OptionsManifest {
  return { version: OPTIONS_VERSION, polls: [] };
}

export function serializeOptions(manifest: OptionsManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Reads the manifest tolerantly — an agent writes it, and one malformed round
 * should cost that round rather than the whole history.
 */
export function parseOptions(raw: unknown): OptionsManifest {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(record.polls) ? record.polls : [];

  const polls: OptionPoll[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const p = entry as Record<string, unknown>;
    const id = str(p.id);
    if (id === "") continue;

    const rawOptions = Array.isArray(p.options) ? p.options : [];
    const options: NameOption[] = [];
    for (const o of rawOptions) {
      if (typeof o !== "object" || o === null) continue;
      const opt = o as Record<string, unknown>;
      const optId = str(opt.id);
      const value = str(opt.value).trim();
      // An option with no text is not an option.
      if (optId === "" || value === "") continue;
      options.push({
        id: optId,
        value,
        note: str(opt.note),
        dropped: opt.dropped === true,
      });
    }
    if (options.length === 0) continue;

    const poll: OptionPoll = {
      id,
      subject: str(p.subject) || "name",
      steering: str(p.steering),
      createdAt: str(p.createdAt),
      options,
    };
    const chosen = str(p.chosen);
    // A chosen id that names nothing is worse than none — it would render as a
    // pick nobody made.
    if (chosen && options.some((o) => o.id === chosen)) poll.chosen = chosen;
    polls.push(poll);
  }

  return { version: OPTIONS_VERSION, polls };
}

export interface OptionsState {
  manifest: OptionsManifest;
  revision: string;
}

export async function readOptions(planPath: string): Promise<OptionsState> {
  try {
    const raw = await readFile(optionsPathFor(planPath), "utf-8");
    return { manifest: parseOptions(JSON.parse(raw)), revision: hashContent(raw) };
  } catch {
    const empty = emptyOptions();
    return { manifest: empty, revision: hashContent(serializeOptions(empty)) };
  }
}

export type OptionsWriteResult =
  | { ok: true; state: OptionsState }
  | { ok: false; status: 409 | 500; error: string; current?: OptionsState };

export async function writeOptions(
  planPath: string,
  manifest: OptionsManifest,
  revision: string,
): Promise<OptionsWriteResult> {
  const current = await readOptions(planPath);
  if (current.revision !== revision) {
    return {
      ok: false,
      status: 409,
      error: "The options changed on disk since you loaded them — please reload",
      current,
    };
  }

  const text = serializeOptions({ version: OPTIONS_VERSION, polls: manifest.polls });
  try {
    await writeFileAtomic(optionsPathFor(planPath), text);
  } catch {
    return { ok: false, status: 500, error: "Failed to write the options" };
  }
  return {
    ok: true,
    state: { manifest: parseOptions(JSON.parse(text)), revision: hashContent(text) },
  };
}
