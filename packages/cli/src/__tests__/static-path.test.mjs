import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveStaticPath } from "../static-path.js";

const ROOT = "/srv/quill/dist/web";

const resolved = (pathname, root = ROOT) => resolveStaticPath(root, pathname);

function expectFile(pathname, expected, root = ROOT) {
  const result = resolved(pathname, root);
  assert.equal(result.ok, true, `expected ${pathname} to resolve, got ${JSON.stringify(result)}`);
  assert.equal(result.filePath, expected);
}

function expectRefused(pathname, reason = "forbidden", root = ROOT) {
  const result = resolved(pathname, root);
  assert.equal(result.ok, false, `expected ${pathname} to be refused, got ${JSON.stringify(result)}`);
  assert.equal(result.reason, reason);
}

describe("resolveStaticPath — normal serving", () => {
  it("serves index.html for the root path", () => {
    expectFile("/", `${ROOT}/index.html`);
    expectFile("//", `${ROOT}/index.html`);
  });

  it("serves a hashed asset", () => {
    expectFile("/assets/index-D4f8a1.js", `${ROOT}/assets/index-D4f8a1.js`);
  });

  it("serves an unknown route as a path inside the root (SPA fallback happens on ENOENT)", () => {
    expectFile("/some/spa/route", `${ROOT}/some/spa/route`);
  });

  it("tolerates a webRoot with a trailing separator", () => {
    expectFile("/assets/app.css", `${ROOT}/assets/app.css`, `${ROOT}/`);
  });
});

describe("resolveStaticPath — percent-decoding (qui-aejb)", () => {
  it("decodes an encoded space", () => {
    expectFile("/assets/my%20font.woff2", `${ROOT}/assets/my font.woff2`);
  });

  it("decodes non-ASCII UTF-8", () => {
    expectFile("/assets/caf%C3%A9.css", `${ROOT}/assets/café.css`);
    expectFile("/assets/%E6%97%A5%E6%9C%AC.svg", `${ROOT}/assets/日本.svg`);
  });

  it("decodes a literal percent sign, encoded as %25", () => {
    expectFile("/assets/100%25.png", `${ROOT}/assets/100%.png`);
  });

  it("decodes exactly once — a double-encoded traversal stays a filename", () => {
    // %252e decodes to "%2e", a literal filename, not to "." — decoding twice
    // would turn this into ../../ after the containment check had passed.
    expectFile("/%252e%252e/x", `${ROOT}/%2e%2e/x`);
  });

  it("refuses a malformed escape instead of throwing", () => {
    expectRefused("/assets/%zz.css", "malformed");
    expectRefused("/%", "malformed");
    expectRefused("/%E0%A4%A", "malformed");
  });
});

describe("resolveStaticPath — traversal guard", () => {
  it("refuses plain traversal", () => {
    expectRefused("/../../../../etc/passwd");
    expectRefused("/..");
    expectRefused("/assets/../../../../etc/passwd");
  });

  it("refuses encoded traversal (decoding happens before the check)", () => {
    expectRefused("/%2e%2e/%2e%2e/etc/passwd");
    expectRefused("/..%2f..%2fetc/passwd");
    expectRefused("/%2e%2e%2f%2e%2e%2fetc/passwd");
    expectRefused("/assets/..%2F..%2F..%2F..%2Fetc%2Fpasswd");
    expectRefused("/%2E%2E/%2E%2E/etc/passwd");
  });

  it("refuses mixed encoded and literal traversal", () => {
    expectRefused("/..%2f../etc/passwd");
    expectRefused("/assets/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd");
  });

  it("refuses an absolute path escape", () => {
    expectRefused("/%2fetc%2fpasswd/../../../../etc/passwd");
  });

  it("refuses a sibling directory that merely shares the root's prefix", () => {
    // /srv/quill/dist/web-evil starts with "/srv/quill/dist/web" as a string.
    expectRefused("/../web-evil/secret.txt");
  });

  it("refuses an embedded NUL byte", () => {
    expectRefused("/assets/app.css%00.txt");
    expectRefused("/%00");
  });

  it("keeps a filename that merely contains dots inside the root", () => {
    expectFile("/assets/..weird..css", `${ROOT}/assets/..weird..css`);
    expectFile("/assets/....//x", `${ROOT}/assets/..../x`);
  });

  it("never returns a path outside the root, for any of these", () => {
    const attacks = [
      "/../../../../etc/passwd",
      "/%2e%2e/%2e%2e/etc/passwd",
      "/..%2f..%2fetc/passwd",
      "/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd",
      "/assets/../../../../../../etc/passwd",
      "/..%2F..%2F..%2Fetc%2Fpasswd",
      "/%252e%252e/%252e%252e/etc/passwd",
      "/./../../etc/passwd",
      "/%2e/%2e%2e/%2e%2e/etc/passwd",
    ];
    for (const attack of attacks) {
      const result = resolved(attack);
      if (result.ok) {
        // Containment is the invariant. `/%252e%252e/...` legitimately resolves
        // to a literal `%2e%2e` directory *inside* the root — that is what
        // decoding exactly once means.
        assert.ok(
          result.filePath.startsWith(`${ROOT}/`),
          `${attack} escaped the web root: ${result.filePath}`,
        );
        assert.notEqual(result.filePath, "/etc/passwd");
      }
    }
  });
});
