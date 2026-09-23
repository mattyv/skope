// The pager (SPEC §8): the message on stdin, and a pager failure doesn't
// throw or otherwise change the outcome — the caller just gets ok: false.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { sendPage } from "../../src/runner/pager.js";

let dir: string;
function freshDir() {
  dir = mkdtempSync(join(tmpdir(), "skop-pager-test-"));
  return dir;
}
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("sendPage (SPEC §8)", () => {
  test("the pager command gets the message on stdin", async () => {
    const d = freshDir();
    const out = join(d, "captured.txt");
    const r = await sendPage({ command: `cat > ${out}`, timeout_ms: 2000 }, "hk-app-03: skop disk-full handed off");
    expect(r.ok).toBe(true);
    expect(readFileSync(out, "utf8")).toBe("hk-app-03: skop disk-full handed off");
  });

  test("a pager that exits non-zero reports ok: false without throwing", async () => {
    const r = await sendPage({ command: "exit 1", timeout_ms: 2000 }, "message");
    expect(r.ok).toBe(false);
  });

  test("a pager that times out reports ok: false without throwing", async () => {
    const r = await sendPage({ command: "sleep 5", timeout_ms: 100 }, "message");
    expect(r.ok).toBe(false);
  });

  test("a pager command that doesn't exist reports ok: false without throwing", async () => {
    const r = await sendPage({ command: "this-command-does-not-exist-xyz", timeout_ms: 2000 }, "message");
    expect(r.ok).toBe(false);
  });
});
