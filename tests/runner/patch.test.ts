import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { unifiedDiff } from "../../src/host/plan.js";
import { applyChange } from "../../src/runner/change.js";
import { parsePatch, patchText } from "../../src/runner/patch.js";

describe("exact unified patches", () => {
  test.each([
    ["one\nold\nthree\n", "one\nnew\nthree\n"],
    ["repeated\nrepeated\nrepeated\n", "repeated\nnew\nrepeated\n"],
    ["a\nb\n", "inserted\na\nb\nlast\n"],
    ["a\nb\nc\n", "a\n"],
    [null, "new\n"],
    [null, ""],
    ["", null],
    ["a\n", null],
    ["", "a\n"],
    ["a\n", ""],
    ["a", "b"],
    ["a", "a\n"],
    ["a\n", "a"],
    [null, "a"],
    ["a", null],
  ])("applies and re-runs %#", (before, after) => {
    const patch = unifiedDiff("file.txt", before, after);
    expect(patchText(before, "file.txt", patch)).toEqual({ result: "applied", after });
    expect(patchText(after, "file.txt", patch)).toEqual({ result: "already_applied" });
  });

  test("multiple separated hunks use both exact positions", () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i}\n`).join("");
    const after = before.replace("line 2\n", "replacement\nextra\n").replace("line 25\n", "changed\n");
    const patch = unifiedDiff("file.txt", before, after);
    expect(parsePatch(patch)[0]?.hunks).toHaveLength(2);
    expect(patchText(before, "file.txt", patch)).toEqual({ result: "applied", after });
  });

  test("rejects offsets and partial application without changing the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "skope-patch-"));
    const before = "one\nold\nthree\n";
    const patch = unifiedDiff("f.txt", before, "one\nnew\nthree\n");
    writeFileSync(join(dir, "f.txt"), `extra\n${before}`);
    expect(applyChange(dir, { op: "patch", path: "f.txt", patch }).result).toBe("failed");
    expect(readFileSync(join(dir, "f.txt"), "utf8")).toBe(`extra\n${before}`);
  });

  test("preserves CRLF while allowing a patch to change the final newline", () => {
    const dir = mkdtempSync(join(tmpdir(), "skope-patch-"));
    writeFileSync(join(dir, "f.txt"), "a\r\nb");
    const patch = unifiedDiff("f.txt", "a\nb", "a\nc\n");
    expect(applyChange(dir, { op: "patch", path: "f.txt", patch })).toEqual({ result: "applied" });
    expect(readFileSync(join(dir, "f.txt"), "utf8")).toBe("a\r\nc\r\n");
  });

  test.each([
    "--- a/../escape\n+++ b/../escape\n@@ -1 +1 @@\n-a\n+b\n",
    "--- a/.git/config\n+++ b/.git/config\n@@ -1 +1 @@\n-a\n+b\n",
    "--- a/old\n+++ b/new\n@@ -1 +1 @@\n-a\n+b\n",
    "--- a/a\n+++ b/a\n@@ -1,2 +1 @@\n-a\n+b\n",
    "diff --git a/a b/a\nold mode 100644\nnew mode 100755\n",
    "diff --git a/a b/a\nnew file mode 120000\n--- /dev/null\n+++ b/a\n@@ -0,0 +1 @@\n+target\n",
    "GIT binary patch\nliteral 100\n",
  ])("refuses unsupported or malformed patches %#", (patch) => {
    expect(() => parsePatch(patch)).toThrow();
  });

  test("the embedded patch cannot target a different or additional file", () => {
    const patch = unifiedDiff("other.txt", "a\n", "b\n");
    expect(() => patchText("a\n", "f.txt", patch)).toThrow("exactly this file");
    expect(() => patchText("a\n", "f.txt", unifiedDiff("f.txt", "a\n", "b\n") + patch)).toThrow("exactly this file");
  });

  test("bounds diff memory for a large replaced middle", () => {
    const before = Array.from({ length: 2500 }, (_, n) => `old ${n}\n`).join("");
    const after = Array.from({ length: 2500 }, (_, n) => `new ${n}\n`).join("");
    expect(patchText(before, "f.txt", unifiedDiff("f.txt", before, after))).toEqual({ result: "applied", after });
  });
});
