#!/usr/bin/env node
// Computes skop's build identity (SPEC §7.2), copied from ply's scheme.
//
// Two numbers, two questions. The package version in package.json says
// which release this is. It's edited by hand, so nothing forces it to move
// when behaviour changes: ply shipped fourteen fixes under one unchanged
// version string, and every stored result from the broken build kept being
// trusted. The build identity is the answer to "is this the same skop?":
// a sha256 over the source that decides what skop does.
//
// Hashed from file contents, not a git commit, so it works the same from a
// clone, a dirty tree or a release tarball.
//
// No fallback. If an input can't be read, this exits non-zero and the build
// fails. A build that doesn't know its own identity must not produce a
// package that lies about it.
//
// Usage:
//   node scripts/build-id.mjs                  print {"version", "build"}
//   node scripts/build-id.mjs --write FILE     also write that JSON to FILE

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Every file under these directories decides behaviour:
// the TypeScript source, the Dafny core, and the shared contracts.
const INPUT_DIRS = ["src", "core", "contracts"];

// Plus these files. The lockfile is here because the versions dependencies
// actually resolved to change behaviour too. This script is here because a
// change to what gets hashed is a change to what the identity is worth.
const INPUT_FILES = ["package.json", "package-lock.json", ".dafny-version", "scripts/build-id.mjs"];

function fail(message) {
  console.error(`build-id: ${message}. skop can't be built without knowing its own identity.`);
  process.exit(1);
}

function listFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    fail(`can't list ${relative(ROOT, dir)} (${e.code})`);
  }
  return entries.flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full);
    if (entry.isFile()) return [full];
    return fail(`${relative(ROOT, full)} is neither a file nor a directory`);
  });
}

function readInput(full) {
  try {
    return readFileSync(full);
  } catch (e) {
    return fail(`can't read ${relative(ROOT, full)} (${e.code})`);
  }
}

const files = [
  ...INPUT_DIRS.flatMap((d) => {
    const full = join(ROOT, d);
    try {
      if (!statSync(full).isDirectory()) fail(`${d} is not a directory`);
    } catch (e) {
      fail(`can't find ${d}/ (${e.code})`);
    }
    return listFiles(full);
  }),
  ...INPUT_FILES.map((f) => join(ROOT, f)),
]
  .map((full) => relative(ROOT, full).split(sep).join("/"))
  .sort();

const hash = createHash("sha256");
for (const path of files) {
  const bytes = readInput(join(ROOT, path));
  // Length-prefixed, so no two different file sets can produce the same stream.
  hash.update(`${path}\0${bytes.length}\0`);
  hash.update(bytes);
}

let version;
try {
  version = JSON.parse(readInput(join(ROOT, "package.json"))).version;
} catch {
  fail("package.json isn't valid JSON");
}
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
  fail(`package.json version "${version}" isn't semver`);
}

const identity = { version, build: hash.digest("hex") };
const json = JSON.stringify(identity);
const writeAt = process.argv.indexOf("--write");
if (writeAt !== -1) {
  const out = process.argv[writeAt + 1];
  if (!out) fail("--write needs a file path");
  mkdirSync(dirname(join(ROOT, out)), { recursive: true });
  writeFileSync(join(ROOT, out), json + "\n");
}
console.log(json);
