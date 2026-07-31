import { normalize, resolve, sep } from "node:path";

export type StaticPathResult =
  | { ok: true; filePath: string }
  | { ok: false; reason: "malformed" | "forbidden" };

/**
 * Resolves a URL pathname to a file path inside `webRoot`.
 *
 * Percent-decoding happens **before** the containment check, never after:
 * `/%2e%2e/%2e%2e/etc/passwd` becomes `/../../etc/passwd` and is then resolved
 * and rejected. Decoding after resolving would hand back an escaping path that
 * had already been blessed as safe. The decode is done exactly once — a
 * filename that legitimately contains a percent sign arrives as `%25`, decodes
 * to `%`, and is never decoded again.
 *
 * A malformed escape (`/%zz`, which makes decodeURIComponent throw) is reported
 * rather than crashing the request.
 */
export function resolveStaticPath(webRoot: string, pathname: string): StaticPathResult {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  // A NUL byte truncates the path in the syscall layer; never let one through.
  if (decoded.includes("\0")) return { ok: false, reason: "forbidden" };

  const relative = decoded.replace(/^\/+/, "") || "index.html";
  const root = resolve(webRoot);
  const resolved = resolve(root, normalize(relative));

  // Guard: the resolved path must remain inside webRoot.
  const safePrefix = root.endsWith(sep) ? root : root + sep;
  if (resolved !== root && !resolved.startsWith(safePrefix)) {
    return { ok: false, reason: "forbidden" };
  }

  return { ok: true, filePath: resolved };
}
