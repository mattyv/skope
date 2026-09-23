#!/usr/bin/env node
// Verifies the Dafny core and translates it to JavaScript (SPEC §5.5).
//
// The output, core/generated/core.cjs, is committed, so installing, testing
// and releasing skop never needs Dafny. CI reruns this script and fails if
// the committed file differs from a fresh build.
//
// Needs the Dafny version pinned in .dafny-version, found as $DAFNY or
// `dafny` on the PATH.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DAFNY = process.env.DAFNY ?? "dafny";
// The Dafny modules the TypeScript adapter uses (src/core.ts).
const MODULES = ["SkopSyntax", "SkopLint", "SkopInterp"];

function dafny(args) {
  return execFileSync(DAFNY, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

const pinned = readFileSync(join(ROOT, ".dafny-version"), "utf8").trim();
const installed = dafny(["--version"]).trim();
if (!installed.startsWith(pinned)) {
  console.error(`build-core: .dafny-version pins ${pinned}, but ${DAFNY} is ${installed}.`);
  process.exit(1);
}

const files = readdirSync(join(ROOT, "core")).filter((f) => f.endsWith(".dfy")).sort().map((f) => join("core", f));
process.stdout.write(dafny(["verify", ...files]));

const tmp = mkdtempSync(join(tmpdir(), "skop-core-"));
try {
  // Keep one-field datatypes (like Program) as real objects. Dafny otherwise
  // erases them to their field inside functions but not in their
  // constructors, so values built by the adapter wouldn't match.
  dafny([
    "translate", "js", "--include-runtime", "--optimize-erasable-datatype-wrapper:false",
    "--output", join(tmp, "core"), ...files,
  ]);
  const js = readFileSync(join(tmp, "core.js"), "utf8");
  const out = join(ROOT, "core", "generated", "core.cjs");
  mkdirSync(dirname(out), { recursive: true });
  // Dafny's JavaScript declares each module as a top-level binding and
  // exports nothing, so export the ones the adapter needs.
  writeFileSync(out, `${js}\nmodule.exports = { _dafny, ${MODULES.join(", ")} };\n`);
  console.log(`build-core: wrote ${out.slice(ROOT.length + 1)}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
