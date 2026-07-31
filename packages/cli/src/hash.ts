import { createHash } from "node:crypto";

/**
 * sha256 of a UTF-8 string, hex encoded. Every `revision` in the API is this
 * hash of the exact bytes on disk — the plan's markdown or the serialized
 * sidecar — so a GET after a PUT always reports the revision the PUT returned.
 */
export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
