/**
 * Examples — what other people did, as evidence you can look at.
 *
 * Some of a design is learned by reading and some of it only by looking. A
 * screen list written out in prose is a checklist; four screenshots of how
 * comparable products actually did that screen is an argument. So Quill can ask
 * for examples, and the agent goes and gets them.
 *
 * Three constraints shape this file.
 *
 * **Quill never fetches anything.** It binds to loopback, has no auth and has
 * no egress story, and it is not going to grow one. The request leaves over the
 * agent bridge; what comes back is files on disk, which Quill then serves to
 * its own page.
 *
 * **The pictures stay out of the markdown.** `parse.ts` deliberately has no
 * image node — an image survives a round trip as literal `![alt](src)` text
 * precisely because a construct the schema cannot model gets dropped on the
 * next autosave. So an example is a manifest entry beside the document, and
 * citing one into the research inserts a link, which is text.
 *
 * **Media is served from one directory, and only from it.** The file names come
 * from an agent rather than from an allowlist, so unlike the companions this
 * needs a real containment check rather than a fixed set of names.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { hashContent } from "./hash.js";
import { writeFileAtomic } from "./atomic.js";
import type { Example, ExampleManifest } from "./types.js";

/** Where the manifest and its images live, relative to the plan. */
export const EXAMPLES_DIR = "research";
export const EXAMPLES_MANIFEST = "examples.json";
export const EXAMPLES_MEDIA = "examples";

export const EXAMPLES_VERSION = 1;

export function examplesRootFor(planPath: string): string {
  return join(dirname(planPath), EXAMPLES_DIR);
}

export function manifestPathFor(planPath: string): string {
  return join(examplesRootFor(planPath), EXAMPLES_MANIFEST);
}

export function mediaRootFor(planPath: string): string {
  return join(examplesRootFor(planPath), EXAMPLES_MEDIA);
}

export function emptyManifest(): ExampleManifest {
  return { version: EXAMPLES_VERSION, examples: [] };
}

/** The canonical on-disk form; the revision is the sha256 of exactly these bytes. */
export function serializeManifest(manifest: ExampleManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Reads the manifest tolerantly. It is written by an agent, so a malformed
 * entry is skipped rather than taking the gallery down with it — an example you
 * cannot see is a smaller loss than a page that will not open.
 */
export function parseManifest(raw: unknown): ExampleManifest {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(record.examples) ? record.examples : [];

  const examples: Example[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const id = str(e.id);
    const image = str(e.image);
    // An entry with no id cannot be kept or cut, and one with no image is not
    // an example — it is a citation, which belongs in the research itself.
    if (id === "" || image === "") continue;
    examples.push({
      id,
      title: str(e.title) || image,
      source: str(e.source),
      note: str(e.note),
      image,
      tags: Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === "string") : [],
      addedAt: str(e.addedAt),
    });
  }

  return { version: EXAMPLES_VERSION, examples };
}

export interface ManifestState {
  manifest: ExampleManifest;
  revision: string;
}

/** The manifest as it stands. A missing one is an empty gallery, not an error. */
export async function readManifest(planPath: string): Promise<ManifestState> {
  const path = manifestPathFor(planPath);
  try {
    const raw = await readFile(path, "utf-8");
    return { manifest: parseManifest(JSON.parse(raw)), revision: hashContent(raw) };
  } catch {
    const empty = emptyManifest();
    return { manifest: empty, revision: hashContent(serializeManifest(empty)) };
  }
}

export type ManifestWriteResult =
  | { ok: true; state: ManifestState }
  | { ok: false; status: 409 | 500; error: string; current?: ManifestState };

/** Writes the manifest, refusing when the agent changed it underneath the page. */
export async function writeManifest(
  planPath: string,
  manifest: ExampleManifest,
  revision: string,
): Promise<ManifestWriteResult> {
  const current = await readManifest(planPath);
  if (current.revision !== revision) {
    return {
      ok: false,
      status: 409,
      error: "The examples changed on disk since you loaded them — please reload",
      current,
    };
  }

  const text = serializeManifest({ version: EXAMPLES_VERSION, examples: manifest.examples });
  try {
    await writeFileAtomic(manifestPathFor(planPath), text);
  } catch {
    return { ok: false, status: 500, error: "Failed to write the examples manifest" };
  }
  return { ok: true, state: { manifest: parseManifest(JSON.parse(text)), revision: hashContent(text) } };
}

/**
 * The absolute path of one media file, or null when the request escapes.
 *
 * The name comes from a manifest an agent wrote, so it is not from a fixed set
 * and cannot be checked against one. Containment is proved instead: the
 * resolved path must sit inside the media root, and a name is refused outright
 * if it carries a separator or a NUL rather than relying on resolution alone.
 */
export function resolveMediaPath(planPath: string, requested: string): string | null {
  if (requested === "" || requested.includes("\0")) return null;
  if (requested.includes("/") || requested.includes("\\")) return null;
  if (requested === "." || requested === "..") return null;

  const root = resolve(mediaRootFor(planPath));
  const target = resolve(root, requested);
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

const MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

/** Content type for a media file, or null for anything we will not serve. */
export function mediaTypeFor(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  return MEDIA_TYPES[name.slice(dot).toLowerCase()] ?? null;
}

/** Media files present on disk — used to report a manifest entry with no picture. */
export async function listMedia(planPath: string): Promise<string[]> {
  try {
    const entries = await readdir(mediaRootFor(planPath), { withFileTypes: true });
    return entries.filter((e) => e.isFile() && mediaTypeFor(e.name)).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Whether a media file exists and is a file. */
export async function mediaExists(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  return info?.isFile() === true;
}
