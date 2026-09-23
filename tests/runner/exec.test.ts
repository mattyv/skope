// Process rules (SPEC §4.4): /bin/sh -c, /dev/null stdin (except the
// pager), LC_ALL=C, its own process group, SIGTERM+grace+SIGKILL on
// timeout, output capped at capture time.

import { describe, expect, test } from "vitest";
import { execCommand } from "../../src/runner/exec.js";

describe("execCommand (SPEC §4.4)", () => {
  test("runs the command with /bin/sh -c and captures exit, stdout and stderr", async () => {
    const r = await execCommand("echo out; echo err >&2; exit 3", { timeoutMs: 2000 });
    expect(r.exit).toBe(3);
    expect(r.stdout).toBe("out\n");
    expect(r.stderr).toBe("err\n");
    expect(r.timedOut).toBe(false);
    expect(r.truncated).toBe(false);
  });

  test("stdin is /dev/null: a command that reads stdin sees immediate EOF, not a hang", async () => {
    const r = await execCommand("cat", { timeoutMs: 2000 });
    expect(r.exit).toBe(0);
    expect(r.stdout).toBe("");
  });

  test("the pager gets its message on stdin instead of /dev/null", async () => {
    const r = await execCommand("cat", { timeoutMs: 2000, input: "page me\n" });
    expect(r.exit).toBe(0);
    expect(r.stdout).toBe("page me\n");
  });

  test("the environment sets LC_ALL=C so output is parseable", async () => {
    const r = await execCommand("echo $LC_ALL", { timeoutMs: 2000 });
    expect(r.stdout).toBe("C\n");
  });

  test("on timeout, SIGTERM then SIGKILL are sent to the whole process group, killing a grandchild too", async () => {
    // The child backgrounds a grandchild and waits, so a plain kill of the
    // direct child would leave the grandchild running.
    const r = await execCommand("sleep 30 & echo $!; wait", { timeoutMs: 100, graceMs: 50 });
    expect(r.timedOut).toBe(true);
    expect(r.exit).toBeNull();
    const grandchildPid = Number(r.stdout.trim());
    expect(Number.isInteger(grandchildPid)).toBe(true);
    // Poll for the grandchild to be reaped; signal delivery can lag under load.
    const isAlive = () => {
      try {
        process.kill(grandchildPid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const deadline = Date.now() + 3000;
    while (isAlive() && Date.now() < deadline) await new Promise((res) => setTimeout(res, 100));
    expect(isAlive()).toBe(false);
  });

  test("a command that ignores SIGTERM is force-killed after the grace period", async () => {
    const start = Date.now();
    const r = await execCommand('trap "" TERM; sleep 30', { timeoutMs: 50, graceMs: 100 });
    const elapsed = Date.now() - start;
    expect(r.timedOut).toBe(true);
    expect(r.exit).toBeNull();
    // Should die at roughly timeoutMs + graceMs, not run the full 30s.
    expect(elapsed).toBeLessThan(5000);
  });

  test("stdout is capped at 1 MiB at capture time, keeping the tail, and sets truncated", async () => {
    // Print an 'A' line then 2 MiB of 'B's: the cap must keep the tail (Bs), not the head.
    const r = await execCommand("node -e \"process.stdout.write('A'); process.stdout.write('B'.repeat(2*1024*1024))\"", {
      timeoutMs: 5000,
    });
    expect(r.truncated).toBe(true);
    expect(r.stdout.length).toBe(1024 * 1024);
    expect(r.stdout.includes("A")).toBe(false);
    expect([...new Set(r.stdout)]).toEqual(["B"]);
  });

  test("output under the cap is not marked truncated", async () => {
    const r = await execCommand("echo short", { timeoutMs: 2000 });
    expect(r.truncated).toBe(false);
  });
});
