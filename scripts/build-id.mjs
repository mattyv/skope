#!/usr/bin/env node
// Computes skop's build identity (SPEC §7.2), copied from ply's scheme.
//
// Two numbers, two questions. The package version in package.json says
// which release this is. It's edited by hand, so nothing forces it to move
// when behaviour changes: ply shipped fourteen fixes under one unchanged
// version string, and every stored result from the broken build kept being
// trusted. The build identity answers "is this the same skop?": a sha256
// over the source that decides what skop does.
//
// Hashed from file contents, not a git commit, so it works the same from a
// clone, a dirty tree or a release tarball. In a git checkout only tracked
// files count, so a stray editor file doesn't change the identity.
//
// No fallback. If an input can't be read, this throws and the build fails.
// A build that doesn't know its own identity must not produce a package
// that lies about it.
//
// Usage:
//   node scripts/build-id.mjs                  print {"version", "build"}
//   node scripts/build-id.mjs --write FILE     also write that JSON to FILE

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Every file under these directories decides behaviour: the TypeScript
// source, the Dafny core, and the shared contracts.
const INPUT_DIRS = ["src", "core", "contracts"];

// Plus these files. The lockfile is here because the versions dependencies
// resolve to change behaviour; the TypeScript configs because they change
// the emitted JavaScript. This script is here because a change to what gets
// hashed is a change to what the identity is worth.
const INPUT_FILES = ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", ".dafny-version", "scripts/build-id.mjs"];

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full);
    if (entry.isFile()) return [full];
    throw new Error(`build-id: ${relative(ROOT, full)} is neither a file nor a directory`);
  });
}

function trackedFiles() {
  try {
    // Tracked files plus untracked ones git doesn't ignore: a new module
    // that isn't committed yet still changes what skop does.
    return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...INPUT_DIRS], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\0")
      .filter(Boolean);
  } catch {
    return null; // not a git checkout, e.g. a release tarball
  }
}

const posix = (full) => relative(ROOT, full).split(sep).join("/");
const inDirs = trackedFiles() ?? INPUT_DIRS.flatMap((d) => listFiles(join(ROOT, d))).map(posix);
const files = [...inDirs, ...INPUT_FILES].sort();

const hash = createHash("sha256");
for (const path of files) {
  const bytes = readFileSync(join(ROOT, path));
  // Length-prefixed, so no two different file sets can produce the same stream.
  hash.update(`${path}\0${bytes.length}\0`);
  hash.update(bytes);
}

const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
  throw new Error(`build-id: package.json version "${version}" isn't semver, so skop can't be built`);
}

const json = JSON.stringify({ version, build: hash.digest("hex") });
const writeAt = process.argv.indexOf("--write");
if (writeAt !== -1) {
  const out = process.argv[writeAt + 1];
  if (!out) throw new Error("build-id: --write needs a file path");
  mkdirSync(dirname(join(ROOT, out)), { recursive: true });
  writeFileSync(join(ROOT, out), `${json}\n`);
  // The same identity as a module, next to the JSON, so a bundled CLI carries it (SPEC §7.2).
  writeFileSync(join(ROOT, out.replace(/\.json$/, ".js")), `export default ${json};\n`);
}
console.log(json);
