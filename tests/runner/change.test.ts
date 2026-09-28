// Plan changes applied by the host (docs/design/plan-mode.md): matching, re-running, confinement
// and file hygiene. The core only ever sees a `do` of the descriptor.

import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { applyChange } from "../../src/runner/change.js";

function repo(files: Record<string, string | Buffer> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "skope-change-"));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(root, p, ".."), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  return root;
}
const read = (root: string, p: string) => readFileSync(join(root, p), "utf8");

describe("edit", () => {
  test("replaces whole lines, exactly once", () => {
    const root = repo({ "a.txt": "one\nold\nthree\n" });
    expect(applyChange(root, { op: "edit", path: "a.txt", old: "old\n", new: "new\n" })).toEqual({ result: "applied" });
    expect(read(root, "a.txt")).toBe("one\nnew\nthree\n");
  });

  test("matches whole lines only: part of a line isn't a match", () => {
    const root = repo({ "a.txt": "an old line\n" });
    expect(applyChange(root, { op: "edit", path: "a.txt", old: "old\n", new: "new\n" })).toMatchObject({ result: "failed" });
    expect(read(root, "a.txt")).toBe("an old line\n");
  });

  test("more than one match fails unless `all`, which replaces every one", () => {
    const root = repo({ "a.txt": "x\ny\nx\n" });
    expect(applyChange(root, { op: "edit", path: "a.txt", old: "x\n", new: "z\n" })).toMatchObject({
      result: "failed",
      message: expect.stringContaining("2 times"),
    });
    expect(applyChange(root, { op: "edit", path: "a.txt", old: "x\n", new: "z\n", all: true })).toEqual({ result: "applied" });
    expect(read(root, "a.txt")).toBe("z\ny\nz\n");
  });

  test("already applied: old gone and new there once is a success that changes nothing", () => {
    const root = repo({ "a.txt": "one\nnew\n" });
    expect(applyChange(root, { op: "edit", path: "a.txt", old: "old\n", new: "new\n" })).toEqual({ result: "already_applied" });
    expect(read(root, "a.txt")).toBe("one\nnew\n");
  });

  test("an empty new deletes the lines, and can't count as already applied", () => {
    const root = repo({ "a.txt": "keep\ndrop\n" });
    expect(applyChange(root, { op: "edit", path: "a.txt", old: "drop\n", new: "" })).toEqual({ result: "applied" });
    expect(read(root, "a.txt")).toBe("keep\n");
    expect(applyChange(root, { op: "edit", path: "a.txt", old: "drop\n", new: "" })).toMatchObject({ result: "failed" });
  });

  test("keeps CRLF line endings, a missing final newline, and the file's mode", () => {
    const root = repo({ "w.txt": "a\r\nb\r\n", "n.txt": "a\nb" });
    chmodSync(join(root, "n.txt"), 0o755);
    applyChange(root, { op: "edit", path: "w.txt", old: "b\n", new: "c\n" });
    expect(read(root, "w.txt")).toBe("a\r\nc\r\n");
    applyChange(root, { op: "edit", path: "n.txt", old: "b\n", new: "c\n" });
    expect(read(root, "n.txt")).toBe("a\nc");
    expect(statSync(join(root, "n.txt")).mode & 0o777).toBe(0o755);
  });

  test.each([
    ["mixed line endings", "a\r\nb\n", "mixed line endings"],
    ["a NUL byte", Buffer.from([0x61, 0x00, 0x0a]), "binary"],
    ["invalid UTF-8", Buffer.from([0xff, 0xfe, 0x0a]), "UTF-8"],
  ])("refuses %s, leaving the file as it was", (_, content, why) => {
    const root = repo({ "f.txt": content });
    expect(applyChange(root, { op: "edit", path: "f.txt", old: "a\n", new: "z\n" })).toMatchObject({
      result: "failed",
      message: expect.stringContaining(why),
    });
    expect(readFileSync(join(root, "f.txt"))).toEqual(Buffer.from(content));
  });
});

describe("create and delete", () => {
  test("create makes parent directories; the same content again is already applied; other content fails", () => {
    const root = repo();
    expect(applyChange(root, { op: "create", path: "d/e/f.md", new: "hi\n" })).toEqual({ result: "applied" });
    expect(read(root, "d/e/f.md")).toBe("hi\n");
    expect(applyChange(root, { op: "create", path: "d/e/f.md", new: "hi\n" })).toEqual({ result: "already_applied" });
    expect(applyChange(root, { op: "create", path: "d/e/f.md", new: "other\n" })).toMatchObject({ result: "failed" });
  });

  test("delete removes a file; a missing file is already applied; a directory is refused", () => {
    const root = repo({ "a.txt": "x\n", "dir/b.txt": "y\n" });
    expect(applyChange(root, { op: "delete", path: "a.txt" })).toEqual({ result: "applied" });
    expect(existsSync(join(root, "a.txt"))).toBe(false);
    expect(applyChange(root, { op: "delete", path: "a.txt" })).toEqual({ result: "already_applied" });
    expect(applyChange(root, { op: "delete", path: "dir" })).toMatchObject({ result: "failed" });
  });
});

describe("confinement", () => {
  test.each([
    ["an absolute path", "/etc/passwd"],
    ["`..`", "../outside.txt"],
    ["`..` inside the path", "a/../../outside.txt"],
    ["under .git", ".git/config"],
  ])("refuses %s", (_, path) => {
    const root = repo({ ".git/config": "[core]\n" });
    expect(applyChange(root, { op: "create", path, new: "x\n" })).toMatchObject({ result: "failed" });
    expect(applyChange(root, { op: "delete", path })).toMatchObject({ result: "failed" });
  });

  test("refuses a symlink, or a directory symlink, that leads outside the root", () => {
    const outside = repo({ "secret.txt": "s\n" });
    const root = repo();
    symlinkSync(join(outside, "secret.txt"), join(root, "link.txt"));
    symlinkSync(outside, join(root, "out"));
    expect(applyChange(root, { op: "edit", path: "link.txt", old: "s\n", new: "x\n" })).toMatchObject({ result: "failed" });
    expect(applyChange(root, { op: "create", path: "out/new.txt", new: "x\n" })).toMatchObject({ result: "failed" });
    expect(applyChange(root, { op: "delete", path: "out/secret.txt" })).toMatchObject({ result: "failed" });
    expect(read(outside, "secret.txt")).toBe("s\n");
    expect(existsSync(join(outside, "new.txt"))).toBe(false);
  });

  test("an existing temporary-file symlink cannot redirect an edit outside the root", () => {
    const outside = repo({ "victim.txt": "private\n" });
    const root = repo({ "a.txt": "before\n" });
    const file = join(root, "a.txt");
    symlinkSync(join(outside, "victim.txt"), `${file}.skope-tmp-${process.pid}`);
    expect(applyChange(root, { op: "edit", path: "a.txt", old: "before", new: "after" })).toEqual({ result: "applied" });
    expect(read(outside, "victim.txt")).toBe("private\n");
    expect(read(root, "a.txt")).toBe("after\n");
    expect(lstatSync(file).isSymbolicLink()).toBe(false);
  });
});
