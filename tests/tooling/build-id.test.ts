// Tests for scripts/build-id.mjs (SPEC §7.2): every test builds a throwaway
// copy of the inputs the script hashes, so nothing here touches the repo's
// own build identity.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(REPO, "scripts", "build-id.mjs");

const INPUT_DIRS = ["src", "core", "contracts"];
const INPUT_FILES = ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", ".dafny-version"];

const dirsMade: string[] = [];

afterEach(() => {
  for (const d of dirsMade.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A fresh, non-git copy of everything build-id.mjs reads, so the script
 * falls back to its own directory walk instead of `git ls-files`. */
function makeTree(): string {
  const dir = mkdtempSync(join(tmpdir(), "build-id-"));
  dirsMade.push(dir);
  for (const d of INPUT_DIRS) cpSync(join(REPO, d), join(dir, d), { recursive: true });
  for (const f of INPUT_FILES) cpSync(join(REPO, f), join(dir, f));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  cpSync(SCRIPT, join(dir, "scripts", "build-id.mjs"));
  return dir;
}

type Result = { status: number; stdout: string; stderr: string };

function runBuildId(dir: string, args: string[] = []): Result {
  try {
    const stdout = execFileSync("node", ["scripts/build-id.mjs", ...args], { cwd: dir, encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

function buildOf(dir: string): string {
  const r = runBuildId(dir);
  expect(r.status).toBe(0);
  return (JSON.parse(r.stdout) as { version: string; build: string }).build;
}

describe("build-id.mjs (SPEC §7.2)", () => {
  test("prints a version and a sha256 build id", () => {
    const dir = makeTree();
    const r = runBuildId(dir);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.version).toBe("0.1.0");
    expect(parsed.build).toMatch(/^[0-9a-f]{64}$/);
  });

  test.each(["src/core.ts", "core/Interp.dfy", "contracts/error-codes.json", "package-lock.json"])(
    "changing a byte under %s changes the build id",
    (rel) => {
      const dir = makeTree();
      const before = buildOf(dir);
      const p = join(dir, rel);
      const bytes = readFileSync(p);
      bytes[0] = (bytes[0] ?? 0) ^ 0xff;
      writeFileSync(p, bytes);
      expect(buildOf(dir)).not.toBe(before);
    },
  );

  test("a file under tests/ doesn't affect the build id", () => {
    const dir = makeTree();
    const before = buildOf(dir);
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "extra.test.ts"), "test('x', () => {});\n");
    expect(buildOf(dir)).toBe(before);
  });

  test("README.md doesn't affect the build id", () => {
    const dir = makeTree();
    const before = buildOf(dir);
    writeFileSync(join(dir, "README.md"), "# different readme\n");
    expect(buildOf(dir)).toBe(before);
  });

  test("a git checkout and a plain directory with the same content give the same id", () => {
    // The script prefers `git ls-files` (globally path-sorted across all of
    // src/core/contracts) when it's in a git checkout, and otherwise walks
    // src, then core, then contracts (SPEC: the identity must not depend on
    // how the files were discovered).
    const gitDir = makeTree();
    execFileSync("git", ["init", "-q"], { cwd: gitDir });
    execFileSync("git", ["add", "-A"], { cwd: gitDir });
    execFileSync("git", ["-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "-m", "x"], { cwd: gitDir });

    const plainDir = makeTree();

    expect(buildOf(gitDir)).toBe(buildOf(plainDir));
  });

  test("moving content between two same-length files changes the build id", () => {
    // Guards against a hash that only covers paths, or that hashes bytes
    // without tying them to a path/length, and so can't tell "file A holds
    // X" from "file A holds Y" as long as the total input is unchanged.
    const dir = makeTree();
    const a = join(dir, "src", "__a.ts");
    const b = join(dir, "src", "__b.ts");
    writeFileSync(a, "AAAAAAAAAA");
    writeFileSync(b, "BBBBBBBBBB");
    expect(readFileSync(a).length).toBe(readFileSync(b).length);
    const before = buildOf(dir);
    const ca = readFileSync(a);
    const cb = readFileSync(b);
    writeFileSync(a, cb);
    writeFileSync(b, ca);
    expect(buildOf(dir)).not.toBe(before);
  });

  test("two path/content splits that concatenate to the same bytes still give different ids", () => {
    // Without a length (or other unambiguous separator) between a path and
    // its content, `src/x` holding "yz" and `src/xy` holding "z" hash to
    // the same bytes as each other for that entry. The two trees below
    // differ only in that one entry, so a hash that isn't collision-safe
    // here would call them identical.
    const dir1 = makeTree();
    writeFileSync(join(dir1, "src", "x"), "yz");
    const dir2 = makeTree();
    writeFileSync(join(dir2, "src", "xy"), "z");

    expect(buildOf(dir1)).not.toBe(buildOf(dir2));
  });

  test("a missing required input makes the script exit non-zero", () => {
    const dir = makeTree();
    rmSync(join(dir, "package-lock.json"));
    const r = runBuildId(dir);
    expect(r.status).not.toBe(0);
  });

  test("a non-semver package.json version makes the script exit non-zero", () => {
    const dir = makeTree();
    const pkgPath = join(dir, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    pkg.version = "not-a-version";
    writeFileSync(pkgPath, JSON.stringify(pkg));
    const r = runBuildId(dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/semver/i);
  });

  test("--write writes the identity JSON to the given path", () => {
    const dir = makeTree();
    const out = join(dir, "dist", "build-identity.json");
    const r = runBuildId(dir, ["--write", "dist/build-identity.json"]);
    expect(r.status).toBe(0);
    const written = JSON.parse(readFileSync(out, "utf8"));
    expect(written).toEqual(JSON.parse(r.stdout));
  });
});
