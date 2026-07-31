import { chmod, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * Writes `content` to `targetPath` atomically: write a temp file in the same
 * directory, then rename(2) over the target. rename within a directory is
 * atomic, so a crash mid-write leaves the previous file intact and readers
 * never observe a half-written file.
 *
 * The single write path shared by the plan and the review sidecar.
 *
 * @param mode Permission bits to preserve from the file being replaced. Omit
 *             to let the umask decide (new files).
 */
export async function writeFileAtomic(
  targetPath: string,
  content: string,
  mode?: number,
): Promise<void> {
  const tmpPath = resolve(
    dirname(targetPath),
    `.quill-tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  try {
    await writeFile(tmpPath, content, "utf-8");
    if (mode !== undefined) await chmod(tmpPath, mode & 0o777);
    await rename(tmpPath, targetPath);
  } catch (err) {
    // Best-effort cleanup; the original target is untouched either way.
    await unlink(tmpPath).catch(() => undefined);
    throw err;
  }
}
