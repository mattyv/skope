#!/usr/bin/env node
// Bundles skope into one CommonJS file (SPEC §5.5): the CLI, the compiled
// Dafny core and every runtime dependency (bignumber.js, js-yaml,
// markdown-it), inlined with esbuild so Node's single executable
// applications — which take one script — can embed it. The build identity
// (§7.2) is baked in at bundle time, from the same scripts/build-id.mjs the
// npm build uses, so both builds of the same commit report the same
// identity.
//
// Usage: node scripts/package/bundle.mjs [--outfile path]

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const outAt = args.indexOf("--outfile");
const OUT_FILE = outAt !== -1 ? resolve(process.cwd(), args[outAt + 1]) : join(ROOT, "dist-bundle", "skope.cjs");

// Same computation the npm build stamps into dist/build-identity.js, so a
// bundle built from the same source has the same identity as the package.
const identity = JSON.parse(execFileSync(process.execPath, [join(ROOT, "scripts", "build-id.mjs")], { cwd: ROOT, encoding: "utf8" }));

rmSync(dirname(OUT_FILE), { recursive: true, force: true });
mkdirSync(dirname(OUT_FILE), { recursive: true });

await esbuild.build({
  entryPoints: [join(ROOT, "src", "cli.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: OUT_FILE,
  legalComments: "none",
  // src/cli.ts already starts with its own #!/usr/bin/env node; esbuild
  // preserves a leading shebang as-is, so no banner is needed here (one
  // would duplicate it and break parsing).
  plugins: [buildIdentityPlugin(identity)],
});

console.log(`bundle: wrote ${OUT_FILE}`);

/** Resolves the generated build-identity module (src imports it statically) to the identity computed above, inlined as JSON. */
function buildIdentityPlugin(identity) {
  return {
    name: "skope-build-identity",
    setup(build) {
      build.onResolve({ filter: /build-identity(\.js|\.json)?$/ }, (args) => ({
        path: args.path,
        namespace: "skope-build-identity",
      }));
      build.onLoad({ filter: /.*/, namespace: "skope-build-identity" }, () => ({
        contents: JSON.stringify(identity),
        loader: "json",
      }));
    },
  };
}
