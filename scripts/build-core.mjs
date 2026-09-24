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
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DAFNY = process.env.DAFNY ?? "dafny";
// The Dafny modules the TypeScript adapter uses (src/core.ts).
const MODULES = ["SkopAst", "SkopStep", "SkopWellFormed", "SkopCheck", "SkopValues", "SkopState", "SkopRun"];

// Dafny prints verification errors on stdout, so pass it straight through.
function dafny(args) {
  try {
    execFileSync(DAFNY, args, { cwd: ROOT, stdio: "inherit" });
  } catch {
    console.error(`build-core: dafny ${args[0]} failed (its output is above).`);
    process.exit(1);
  }
}

const pinned = readFileSync(join(ROOT, ".dafny-version"), "utf8").trim();
const installed = execFileSync(DAFNY, ["--version"], { encoding: "utf8" }).trim();
// `dafny --version` prints e.g. 4.11.0+fcb2042d…; compare the version part exactly.
if (installed.split("+")[0] !== pinned) {
  console.error(`build-core: .dafny-version pins ${pinned}, but ${DAFNY} is ${installed}.`);
  process.exit(1);
}

const files = readdirSync(join(ROOT, "core"))
  .filter((f) => f.endsWith(".dfy"))
  .sort()
  .map((f) => join("core", f));

const tmp = mkdtempSync(join(tmpdir(), "skop-core-"));
try {
  // translate verifies first, and fails on any unproven obligation.
  // Keep one-field datatypes (like Program) as real objects. Dafny otherwise
  // erases them to their field inside functions but not in their
  // constructors, so values built by the adapter wouldn't match.
  dafny(["translate", "js", "--include-runtime", "--optimize-erasable-datatype-wrapper:false", "--output", join(tmp, "core"), ...files]);
  const js = patchRuntime(readFileSync(join(tmp, "core.js"), "utf8"));
  const out = join(ROOT, "core", "generated", "core.cjs");
  // Dafny's JavaScript declares each module as a top-level binding and
  // exports nothing, so export the ones the adapter needs.
  writeFileSync(out, `${js}\nmodule.exports = { _dafny, ${MODULES.join(", ")} };\n`);
  console.log(`build-core: wrote ${out.slice(ROOT.length + 1)}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// Dafny's JavaScript runtime builds sequences by spreading every element
// into a function call (`new Seq(...chars)`, `Seq.of(...a)`), which
// overflows the stack past roughly 30k elements. Command output is up to
// 1 MiB (SPEC §4.4), so those spots are rewritten as loops. Each target
// must match exactly: a Dafny upgrade that changes one fails the build
// here rather than shipping the crash again.
function patchRuntime(js) {
  const patches = [
    [
      "return new Seq(...([...s].map(c => new _dafny.CodePoint(c.codePointAt(0)))))",
      "const r = new Seq(); for (const c of s) r.push(new _dafny.CodePoint(c.codePointAt(0))); return r;",
    ],
    ["let r = Seq.of(...a);\n        r.push(...b);", "let r = new Seq();\n        for (const x of a) r.push(x);\n        for (const x of b) r.push(x);"],
    ["return _dafny.Set.fromElements(...this);", "const s = new _dafny.Set(); for (const k of this) s.add(k); return s;"],
  ];
  for (const [from, to] of patches) {
    if (js.split(from).length !== 2) {
      console.error(`build-core: expected exactly one \`${from}\` in Dafny's runtime; update patchRuntime for this Dafny version.`);
      process.exit(1);
    }
    js = js.replace(from, to);
  }
  return js;
}

