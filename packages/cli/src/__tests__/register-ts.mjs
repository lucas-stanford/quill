/**
 * Lets the plain-JS tests import the TypeScript sources directly.
 *
 * Node 24 runs .ts files natively (type stripping) but does not rewrite an
 * import specifier — TypeScript source says `./sidecar.js`, and the file on
 * disk is `sidecar.ts`. This resolve hook bridges the two so the tests can
 * exercise the real modules with no build step, no loader dependency and no
 * change to any frozen config.
 *
 *   node --import ./register-ts.mjs --test *.test.mjs
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && specifier.endsWith(".js")) {
      const asTs = `${specifier.slice(0, -3)}.ts`;
      try {
        const candidate = nextResolve(asTs, context);
        if (existsSync(fileURLToPath(candidate.url))) return candidate;
      } catch {
        /* fall through to the original specifier */
      }
    }
    return nextResolve(specifier, context);
  },
});
