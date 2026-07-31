---
id: qui-aejb
status: closed
deps: [qui-ycaz]
links: []
created: 2026-07-31T20:42:00Z
parent: qui-0ull
type: bug
priority: 3
tags: [cli, server]
---
# Static file server does not percent-decode request paths

resolveStaticPath deliberately never decodes percent-encoding, which is safe against traversal but means an asset whose filename contains an encoded character will 404 and fall through to the SPA shell. Vite emits hashed ASCII filenames so nothing breaks today; this is latent.

## Design

If decoding is added it must happen before the containment check, never after, or the traversal guard is defeated.

## Acceptance Criteria

Encoded-but-legitimate asset paths resolve, and traversal attempts are still refused.


## Notes

**2026-07-31T22:04:11Z**

Fixed. Decoding now happens before the containment check, which is the load-bearing ordering: decoding after the check would let %2e%2e%2f collapse into ../ once validation had already passed. Malformed escapes return 400 instead of crashing, NUL bytes are refused, and the containment check uses the path separator so a sibling directory sharing the root's prefix cannot pass. Verified: legitimate percent-encoded asset names now resolve, and every traversal form tested still refuses.
