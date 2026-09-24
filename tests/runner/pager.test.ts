// The pager (SPEC §8): the message on stdin, and a pager failure doesn't
// throw or otherwise change the outcome — the caller just gets ok: false.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { commandEnv } from "../../src/runner/exec.js";
import { sendPage } from "../../src/runner/pager.js";

const env = commandEnv(process.env, []);

let dir: string;
function freshDir() {
  dir = mkdtempSync(join(tmpdir(), "skope-pager-test-"));
  return dir;
}
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("sendPage (SPEC §8)", () => {
  test("the pager command gets the message on stdin", async () => {
    const d = freshDir();
    const out = join(d, "captured.txt");
    const r = await sendPage({ command: `cat > ${out}`, timeout_ms: 2000 }, "hk-app-03: skope disk-full handed off", env);
    expect(r.ok).toBe(true);
    expect(readFileSync(out, "utf8")).toBe("hk-app-03: skope disk-full handed off");
  });

  test("a pager that exits non-zero reports ok: false without throwing", async () => {
    const r = await sendPage({ command: "exit 1", timeout_ms: 2000 }, "message", env);
    expect(r.ok).toBe(false);
  });

  test("a pager that times out reports ok: false without throwing", async () => {
    const r = await sendPage({ command: "sleep 5", timeout_ms: 100 }, "message", env);
    expect(r.ok).toBe(false);
  });

  test("a pager command that doesn't exist reports ok: false without throwing", async () => {
    const r = await sendPage({ command: "this-command-does-not-exist-xyz", timeout_ms: 2000 }, "message", env);
    expect(r.ok).toBe(false);
  });

  test("a pager that exits without reading a 1 MiB message: no uncaught EPIPE, ok follows its exit (P1-1)", async () => {
    const errors: unknown[] = [];
    const onError = (e: unknown) => errors.push(e);
    process.on("uncaughtException", onError);
    try {
      const big = "x".repeat(1024 * 1024);
      expect(await sendPage({ command: "exit 0", timeout_ms: 5000 }, big, env)).toEqual({ ok: true });
      expect(await sendPage({ command: "exit 1", timeout_ms: 5000 }, big, env)).toEqual({ ok: false });
      await new Promise((res) => setTimeout(res, 50));
      expect(errors).toEqual([]);
    } finally {
      process.off("uncaughtException", onError);
    }
  });

  test("the pager runs with the environment it's given (no backend keys)", async () => {
    const d = freshDir();
    const out = join(d, "env.txt");
    const r = await sendPage(
      { command: `echo "[\${SKOPE_PAGER_TEST_KEY-unset}][$LC_ALL]" > ${out}`, timeout_ms: 2000 },
      "m",
      commandEnv({ ...process.env, SKOPE_PAGER_TEST_KEY: "k" }, ["SKOPE_PAGER_TEST_KEY"]),
    );
    expect(r.ok).toBe(true);
    expect(readFileSync(out, "utf8")).toBe("[unset][C]\n");
  });

  test("an out-of-range pager timeout reports ok: false without throwing", async () => {
    expect(await sendPage({ command: "true", timeout_ms: 2 ** 31 }, "m", env)).toEqual({ ok: false });
  });
});
