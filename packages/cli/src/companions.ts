/**
 * Companion documents — the reading material a plan is judged against.
 *
 * A plan is an argument, and an argument is only reviewable next to its
 * evidence. A milestone list that says "cut M4" is a different proposition
 * depending on whether the research found that M4's feature is table stakes or
 * a nice-to-have. So Quill will show, beside `PLAN.md`, the documents an agent
 * wrote to justify it: `research.md`, `reference.md`.
 *
 * Three deliberate limits.
 *
 * **The plan is still the artifact.** Companions are editable — you prune a
 * stale finding where you are reading it — but only the plan becomes tickets
 * and only the plan is what the exit protocol reports on. Writes are guarded by
 * a revision hash exactly as the plan's are, because the agent that wrote a
 * research document may still be writing it.
 *
 * **The names are an allowlist, not a pattern.** The only paths this module can
 * ever produce are `dirname(plan) + "/" + <a name from the list>`, so there is
 * no user-controlled path component to traverse with. A request for a name that
 * is not on the list is a 404 before any filesystem call happens.
 *
 * **Discovery is per request.** In the planfer flow the agent writes
 * `research.md` and then opens Quill, but it may also write it while Quill is
 * already up. Re-reading the directory on each request means a companion that
 * appears later is picked up without a restart.
 */
import { readFile, stat } from "node:fs/promises";
import { hashContent } from "./hash.js";
import { writeFileAtomic } from "./atomic.js";
import { basename, dirname, join } from "node:path";
import type { CompanionDocument, CompanionList } from "./types.js";

/**
 * The conventional companions, in the order they are offered. Research first:
 * it is the thing a reviewer reaches for when a milestone looks wrong, and the
 * reference is a spec you consult rather than read.
 */
export const COMPANION_NAMES: readonly string[] = ["research.md", "reference.md"];

/** A human label for the tab. `research.md` reads better as "Research". */
export function companionLabel(name: string): string {
  const stem = name.replace(/\.md$/i, "");
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

/**
 * Is this a name we serve at all? The check is exact and case-insensitive, and
 * it is what keeps the endpoint from being a file-read primitive: nothing a
 * caller sends is ever joined onto a path unless it matched one of these.
 */
export function resolveCompanionName(requested: string): string | null {
  const wanted = requested.trim().toLowerCase();
  return COMPANION_NAMES.find((name) => name.toLowerCase() === wanted) ?? null;
}

/** Absolute path a companion would have, whether or not it exists. */
export function companionPathFor(planPath: string, name: string): string {
  return join(dirname(planPath), name);
}

/**
 * The companions that exist right now, beside the plan.
 *
 * A companion that is missing is not an error and not reported: most plans have
 * none, and an empty tab strip is the correct rendering of that.
 */
export async function listCompanions(planPath: string): Promise<CompanionList> {
  const documents: CompanionList["documents"] = [];

  for (const name of COMPANION_NAMES) {
    // A companion cannot be the plan itself: opening PLAN.md as a read-only
    // tab beside its own editor would offer two views of one file, one of
    // which silently stops updating.
    if (name.toLowerCase() === basename(planPath).toLowerCase()) continue;

    const path = companionPathFor(planPath, name);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) continue;

    documents.push({ name, label: companionLabel(name), path });
  }

  return { documents };
}

export type CompanionResult =
  | { ok: true; document: CompanionDocument }
  | { ok: false; status: 404 | 500; error: string };

/** Reads one companion by name. */
export async function readCompanion(
  planPath: string,
  requested: string,
): Promise<CompanionResult> {
  const name = resolveCompanionName(requested);
  if (name === null) {
    return { ok: false, status: 404, error: `Not a companion document: ${requested}` };
  }

  const path = companionPathFor(planPath, name);
  try {
    const markdown = await readFile(path, "utf-8");
    return {
      ok: true,
      document: {
        name,
        label: companionLabel(name),
        path,
        markdown,
        revision: hashContent(markdown),
      },
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR") {
      return { ok: false, status: 404, error: `Companion document not found: ${path}` };
    }
    return { ok: false, status: 500, error: `Failed to read ${name}` };
  }
}

export type CompanionWriteResult =
  | { ok: true; document: CompanionDocument }
  | { ok: false; status: 404 | 409 | 500; error: string; current?: CompanionDocument };

/**
 * Writes a companion, refusing when the file moved underneath the editor.
 *
 * The same bargain the plan makes: a stale write is rejected with the current
 * contents attached, so the browser can show what happened rather than
 * silently losing whichever side lost the race. In this flow the other writer
 * is usually the agent that was asked to re-run a section, which makes the
 * race routine rather than exotic.
 */
export async function writeCompanion(
  planPath: string,
  requested: string,
  markdown: string,
  revision: string,
): Promise<CompanionWriteResult> {
  const name = resolveCompanionName(requested);
  if (name === null) {
    return { ok: false, status: 404, error: `Not a companion document: ${requested}` };
  }

  const path = companionPathFor(planPath, name);

  let current: string;
  let mode: number;
  try {
    const [content, info] = await Promise.all([readFile(path, "utf-8"), stat(path)]);
    current = content;
    mode = info.mode;
  } catch {
    return { ok: false, status: 404, error: `Companion document not found: ${path}` };
  }

  const currentHash = hashContent(current);
  if (currentHash !== revision) {
    return {
      ok: false,
      status: 409,
      error: "The file has been modified since your last load — please reload",
      current: {
        name,
        label: companionLabel(name),
        path,
        markdown: current,
        revision: currentHash,
      },
    };
  }

  try {
    await writeFileAtomic(path, markdown, mode);
  } catch {
    return { ok: false, status: 500, error: `Failed to write ${name}` };
  }

  return {
    ok: true,
    document: {
      name,
      label: companionLabel(name),
      path,
      markdown,
      revision: hashContent(markdown),
    },
  };
}
