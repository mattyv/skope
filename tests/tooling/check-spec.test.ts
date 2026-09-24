// Tests for scripts/check_spec.py. Each test builds a throwaway copy of
// whatever the script reads, so nothing here touches SPEC.md, PLAN.md,
// README.md, contracts/, fixtures/ or tests/acceptance/ in
// the real repo.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const dirsMade: string[] = [];
afterEach(() => {
  for (const d of dirsMade.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A tree with everything check_spec.py reads for `docs` and `coverage`:
 * the three docs, contracts/, and both fixture directories. Callers add
 * their own tests/ and tests/acceptance/CLOSED as needed. */
function makeDocsTree(): string {
  const dir = mkdtempSync(join(tmpdir(), "check-spec-"));
  dirsMade.push(dir);
  for (const f of ["SPEC.md", "PLAN.md", "README.md"]) cpSync(join(REPO, f), join(dir, f));
  cpSync(join(REPO, "contracts"), join(dir, "contracts"), { recursive: true });
  cpSync(join(REPO, "fixtures"), join(dir, "fixtures"), { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });
  cpSync(join(REPO, "scripts", "check_spec.py"), join(dir, "scripts", "check_spec.py"));
  return dir;
}

/** Adds package.json and a symlinked node_modules, so `npx vitest` in the
 * milestones command resolves the repo's real vitest install. */
function withNodeModules(dir: string): void {
  cpSync(join(REPO, "package.json"), join(dir, "package.json"));
  symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"));
}

function writeClosed(dir: string, milestones: string[]): void {
  mkdirSync(join(dir, "tests", "acceptance"), { recursive: true });
  writeFileSync(join(dir, "tests", "acceptance", "CLOSED"), `${milestones.join("\n")}\n`);
}

type Result = { status: number; stdout: string; stderr: string };

function checkSpec(dir: string, cmd: string): Result {
  try {
    const stdout = execFileSync("python3", [join(dir, "scripts", "check_spec.py"), cmd], {
      cwd: dir,
      encoding: "utf8",
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

describe("check_spec.py docs", () => {
  test("passes on an untouched copy of the docs", () => {
    const dir = makeDocsTree();
    const r = checkSpec(dir, "docs");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("docs: ok");
  });

  test("fails on a stale contracts/error-codes.json", () => {
    const dir = makeDocsTree();
    writeFileSync(join(dir, "contracts", "error-codes.json"), "[]\n");
    const r = checkSpec(dir, "docs");
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain("error-codes.json is stale");
  });

  test("fails on fixture drift from the SPEC appendix", () => {
    const dir = makeDocsTree();
    const p = join(dir, "fixtures", "disk-full", "SKILL.md");
    writeFileSync(p, `${readFileSync(p, "utf8")}\nan extra line not in the spec appendix\n`);
    const r = checkSpec(dir, "docs");
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain("differs from its SPEC appendix");
  });

  test("fails on a code referenced in the docs but not defined in SPEC §7.1", () => {
    const dir = makeDocsTree();
    const p = join(dir, "README.md");
    writeFileSync(p, `${readFileSync(p, "utf8")}\nSee \`E-TOTALLY-MADE-UP\` for details.\n`);
    const r = checkSpec(dir, "docs");
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain("E-TOTALLY-MADE-UP is used but not defined");
  });

  test("fails on an invalid JSON example", () => {
    const dir = makeDocsTree();
    const p = join(dir, "README.md");
    writeFileSync(p, `${readFileSync(p, "utf8")}\n\`\`\`json\n{ not valid json\n\`\`\`\n`);
    const r = checkSpec(dir, "docs");
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain("doesn't parse");
  });
});

describe("check_spec.py coverage", () => {
  test("passes when nothing closed needs a code that has no test", () => {
    const dir = makeDocsTree();
    mkdirSync(join(dir, "tests"), { recursive: true });
    const r = checkSpec(dir, "coverage");
    expect(r.status).toBe(0);
  });

  test("fails for a code whose milestone is closed but that has no test", () => {
    const dir = makeDocsTree();
    mkdirSync(join(dir, "tests"), { recursive: true });
    // E-NOT-RUNNABLE is a `parse`-stage code, due at M2 (check_spec.due_at).
    writeClosed(dir, ["M2"]);
    const r = checkSpec(dir, "coverage");
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain("E-NOT-RUNNABLE has no test");
    expect(r.stdout).toContain("M2");
  });

  test("a code named only in a comment doesn't count as tested (no over-credit)", () => {
    const dir = makeDocsTree();
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(
      join(dir, "tests", "extra.test.ts"),
      "// this file is about E-NOT-RUNNABLE in passing, but never tests it\n" +
        "import { test, expect } from 'vitest';\n" +
        "test('unrelated', () => { expect(1).toBe(1); });\n",
    );
    writeClosed(dir, ["M2"]);
    const r = checkSpec(dir, "coverage");
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain("E-NOT-RUNNABLE has no test");
  });

  test("a code named in a test title or an expect(...) line counts as tested", () => {
    const dir = makeDocsTree();
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(
      join(dir, "tests", "extra.test.ts"),
      "import { test, expect } from 'vitest';\n" + "test('reports E-NOT-RUNNABLE when format is missing', () => { expect(1).toBe(1); });\n",
    );
    writeClosed(dir, ["M2"]);
    const r = checkSpec(dir, "coverage");
    // Other M2 codes are still untested in this minimal tree, so the run as
    // a whole still fails; E-NOT-RUNNABLE specifically must not be among
    // the codes reported as missing a test.
    expect(r.stdout).not.toContain("E-NOT-RUNNABLE has no test");
  });
});

describe("check_spec.py milestones", () => {
  test("passes with nothing closed", () => {
    const dir = makeDocsTree();
    withNodeModules(dir);
    writeClosed(dir, []);
    const r = checkSpec(dir, "milestones");
    expect(r.status).toBe(0);
  });

  test("fails when a closed milestone's acceptance dir is empty", () => {
    const dir = makeDocsTree();
    withNodeModules(dir);
    mkdirSync(join(dir, "tests", "acceptance", "m2"), { recursive: true });
    writeClosed(dir, ["M2"]);
    const r = checkSpec(dir, "milestones");
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain("has no tests");
  });

  test("fails when a closed milestone's acceptance dir has a skipped test", () => {
    const dir = makeDocsTree();
    withNodeModules(dir);
    const m = join(dir, "tests", "acceptance", "m2");
    mkdirSync(m, { recursive: true });
    writeFileSync(join(m, "skip.test.ts"), "import { test } from 'vitest';\n" + "test.skip('not ready yet', () => {});\n");
    writeClosed(dir, ["M2"]);
    const r = checkSpec(dir, "milestones");
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain("skipped");
  });

  test("fails when a closed milestone's acceptance dir has a test.fails", () => {
    const dir = makeDocsTree();
    withNodeModules(dir);
    const m = join(dir, "tests", "acceptance", "m2");
    mkdirSync(m, { recursive: true });
    writeFileSync(
      join(m, "fails.test.ts"),
      "import { test } from 'vitest';\n" + "test.fails('not implemented yet', () => { throw new Error('nope'); });\n",
    );
    writeClosed(dir, ["M2"]);
    const r = checkSpec(dir, "milestones");
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain("can't be an expected failure");
  });

  test("passes when a closed milestone's acceptance tests all pass", () => {
    const dir = makeDocsTree();
    withNodeModules(dir);
    const m = join(dir, "tests", "acceptance", "m2");
    mkdirSync(m, { recursive: true });
    writeFileSync(join(m, "ok.test.ts"), "import { test, expect } from 'vitest';\n" + "test('it works', () => { expect(1).toBe(1); });\n");
    writeClosed(dir, ["M2"]);
    const r = checkSpec(dir, "milestones");
    expect(r.status).toBe(0);
  });
});
