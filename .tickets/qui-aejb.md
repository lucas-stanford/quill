---
id: qui-aejb
status: open
deps: []
links: []
created: 2026-07-31T20:42:00Z
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

