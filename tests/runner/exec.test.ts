// Process rules (SPEC §4.4): /bin/sh -c, /dev/null stdin (except the
// pager), the command environment, its own process group,
// SIGTERM+grace+SIGKILL on timeout, bounded timeouts, output capped at
// capture time, and stopping every live command when skope is interrupted.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { commandEnv, DEFAULT_GRACE_MS, execCommand, liveCommands, stopAll } from "../../src/runner/exec.js";

const env = commandEnv(process.env, []);
const node = JSON.stringify(process.execPath);

let dir: string | undefined;
afterEach(async () => {
  await stopAll(0);
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

/** Whether a process is running: not gone, and not a zombie waiting to be reaped (PID 1 may never reap it). */
function running(pid: number): boolean {
  try {
    return !execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" })
      .trim()
      .startsWith("Z");
  } catch {
    return false;
  }
}

/** A path the command touches once its traps are set, so a test can wait for it. */
function marker(name: string): string {
  dir ??= mkdtempSync(join(tmpdir(), "skope-exec-test-"));
  return join(dir, name);
}

describe("execCommand (SPEC §4.4)", () => {
  test("runs the command with /bin/sh -c and captures exit, stdout and stderr", async () => {
    const r = await execCommand("echo out; echo err >&2; exit 3", { timeoutMs: 2000, env });
    expect(r).toEqual({ exit: 3, signal: null, stdout: "out\n", stderr: "err\n", timedOut: false, truncated: false });
  });

  test("stdin is /dev/null: a command that reads stdin sees immediate EOF, not a hang", async () => {
    const r = await execCommand("cat", { timeoutMs: 2000, env });
    expect(r.exit).toBe(0);
    expect(r.stdout).toBe("");
  });

  test("stdin doesn't leak a file descriptor per command (P2-8)", async () => {
    const fdDir = process.platform === "linux" ? "/proc/self/fd" : "/dev/fd";
    const before = readdirSync(fdDir).length;
    for (let i = 0; i < 20; i++) await execCommand("true", { timeoutMs: 2000, env });
    expect(readdirSync(fdDir).length).toBeLessThan(before + 5);
  });

  test("the pager gets its message on stdin instead of /dev/null", async () => {
    const r = await execCommand("cat", { timeoutMs: 2000, env, input: "page me\n" });
    expect(r.exit).toBe(0);
    expect(r.stdout).toBe("page me\n");
  });

  test("the environment is exactly the one given, not merged onto skope's own (P2-9)", async () => {
    const r = await execCommand('echo "[$SKOPE_EXEC_TEST_ONLY_GIVEN][$HOME]"', {
      timeoutMs: 2000,
      env: { SKOPE_EXEC_TEST_ONLY_GIVEN: "yes" },
    });
    expect(r.stdout).toBe("[yes][]\n");
  });

  test("a command killed by a signal records the signal, with exit null", async () => {
    const r = await execCommand("kill -TERM $$", { timeoutMs: 2000, env });
    expect(r.exit).toBeNull();
    expect(r.signal).toBe("SIGTERM");
    expect(r.timedOut).toBe(false);
  });

  test("on timeout the group gets SIGTERM first: a command that handles it exits before the grace period ends", async () => {
    const start = Date.now();
    const r = await execCommand("trap 'echo got-term; exit 0' TERM; echo ready; sleep 30 & wait", { timeoutMs: 200, graceMs: 20_000, env });
    expect(r.timedOut).toBe(true);
    expect(r.exit).toBeNull();
    expect(r.stdout).toBe("ready\ngot-term\n");
    expect(Date.now() - start).toBeLessThan(10_000);
  });

  test("on timeout, the whole process group dies, grandchild too", async () => {
    // The grandchild inherits stdout, so `close` only fires once it has
    // died: the command resolving at all proves the group was killed.
    const start = Date.now();
    const r = await execCommand("sleep 30 & wait", { timeoutMs: 100, graceMs: 50, env });
    expect(r.timedOut).toBe(true);
    expect(r.exit).toBeNull();
    expect(Date.now() - start).toBeLessThan(10_000);
  });

  test("a command that ignores SIGTERM is force-killed only after the grace period", async () => {
    const start = Date.now();
    const r = await execCommand('trap "" TERM; sleep 30', { timeoutMs: 300, graceMs: 400, env });
    const elapsed = Date.now() - start;
    expect(r.timedOut).toBe(true);
    expect(r.exit).toBeNull();
    expect(r.signal).toBe("SIGKILL");
    expect(elapsed).toBeGreaterThanOrEqual(700);
    expect(elapsed).toBeLessThan(10_000);
  });

  test("a timed-out command stays live until its whole group is gone, even after the shell exits", async () => {
    // The shell dies on SIGTERM; its background child ignores SIGTERM and holds no pipe, so
    // `close` fires while the child still runs. It must still get SIGKILL before the result.
    const pidFile = marker("survivor");
    const start = Date.now();
    const p = execCommand(`(trap "" TERM; exec sleep 30) >/dev/null 2>&1 & echo $! > '${pidFile}'; sleep 30`, {
      timeoutMs: 200,
      graceMs: 600,
      env,
    });
    await vi.waitFor(() => expect(existsSync(pidFile)).toBe(true));
    const survivor = Number(readFileSync(pidFile, "utf8"));
    await new Promise((res) => setTimeout(res, 400));
    expect(liveCommands()).toBe(1); // the shell is gone, the survivor isn't
    const r = await p;
    expect(r.timedOut).toBe(true);
    expect(Date.now() - start).toBeGreaterThanOrEqual(800);
    expect(liveCommands()).toBe(0);
    expect(running(survivor)).toBe(false);
  });

  test("the default grace period is 5s: a SIGTERM-ignoring command is still alive well after its timeout", async () => {
    expect(DEFAULT_GRACE_MS).toBe(5000);
    let settled = false;
    const p = execCommand('trap "" TERM; sleep 30', { timeoutMs: 300, env }).then((r) => {
      settled = true;
      return r;
    });
    await new Promise((res) => setTimeout(res, 1000));
    expect(settled).toBe(false);
    await stopAll(0);
    expect((await p).signal).toBe("SIGKILL");
  });

  test.each([0, -1, 1.5, 2 ** 31, Number.NaN, Number.POSITIVE_INFINITY])(
    "a timeout of %s ms is rejected before anything runs (P2-7)",
    async (t) => {
      await expect(execCommand("true", { timeoutMs: t, env })).rejects.toThrow(RangeError);
    },
  );

  test("the largest timeout, 2^31-1 ms, is accepted", async () => {
    const r = await execCommand("true", { timeoutMs: 2 ** 31 - 1, env });
    expect(r.exit).toBe(0);
  });

  test("stdout is capped at 1 MiB at capture time, keeping the tail, and sets truncated", async () => {
    // Print an 'A' then 2 MiB of 'B's: the cap must keep the tail (Bs), not the head.
    const r = await execCommand(`${node} -e "process.stdout.write('A'); process.stdout.write('B'.repeat(2*1024*1024))"`, {
      timeoutMs: 10_000,
      env,
    });
    expect(r.truncated).toBe(true);
    expect(r.stdout.length).toBe(1024 * 1024);
    expect(r.stdout.includes("A")).toBe(false);
    expect([...new Set(r.stdout)]).toEqual(["B"]);
  });

  test("stderr is capped too, and a capped stderr alone sets truncated", async () => {
    const r = await execCommand(
      `${node} -e "process.stderr.write('A'); process.stderr.write('C'.repeat(2*1024*1024)); process.stdout.write('ok')"`,
      {
        timeoutMs: 10_000,
        env,
      },
    );
    expect(r.truncated).toBe(true);
    expect(r.stdout).toBe("ok");
    expect(r.stderr.length).toBe(1024 * 1024);
    expect(r.stderr.includes("A")).toBe(false);
  });

  test("output under the cap is not marked truncated", async () => {
    const r = await execCommand("echo short", { timeoutMs: 2000, env });
    expect(r.truncated).toBe(false);
  });

  test("a pager that exits without reading a large message doesn't crash skope with EPIPE (P1-1)", async () => {
    const errors: unknown[] = [];
    const onError = (e: unknown) => errors.push(e);
    process.on("uncaughtException", onError);
    try {
      const big = "x".repeat(1024 * 1024);
      const ok = await execCommand("exit 0", { timeoutMs: 5000, env, input: big });
      const bad = await execCommand("exit 1", { timeoutMs: 5000, env, input: big });
      await new Promise((res) => setTimeout(res, 50));
      expect(ok.exit).toBe(0);
      expect(bad.exit).toBe(1);
      expect(errors).toEqual([]);
    } finally {
      process.off("uncaughtException", onError);
    }
  });
});

describe("commandEnv (SPEC §4.4)", () => {
  test("is skope's environment minus the backend key variables, plus LC_ALL=C", () => {
    const e = commandEnv({ PATH: "/bin", TYPESAFE_API_KEY: "k1", OPENROUTER_API_KEY: "k2", KEEP: "1" }, [
      "TYPESAFE_API_KEY",
      "OPENROUTER_API_KEY",
    ]);
    expect(e).toEqual({ PATH: "/bin", KEEP: "1", LC_ALL: "C" });
  });

  test("LC_ALL=C wins over an inherited LC_ALL", async () => {
    const e = commandEnv({ LC_ALL: "de_DE.UTF-8" }, []);
    expect(e.LC_ALL).toBe("C");
    const r = await execCommand('echo "$LC_ALL"', { timeoutMs: 2000, env: e });
    expect(r.stdout).toBe("C\n");
  });

  test("a skill command never sees the backend key", async () => {
    const e = commandEnv({ ...process.env, SKOPE_TEST_KEY: "sekrit" }, ["SKOPE_TEST_KEY"]);
    const r = await execCommand('echo "[$SKOPE_TEST_KEY]"; env | grep -c SKOPE_TEST_KEY', { timeoutMs: 2000, env: e });
    expect(r.stdout).toBe("[]\n0\n");
  });

  test("doesn't modify the environment it's given", () => {
    const base = { A: "1", K: "2" };
    commandEnv(base, ["K"]);
    expect(base).toEqual({ A: "1", K: "2" });
  });
});

describe("stopAll (SPEC §4.4: skope interrupted, P2-13)", () => {
  test("tracks live commands and stops them all: SIGTERM, then SIGKILL after the grace period", async () => {
    const [m1, m2] = [marker("polite"), marker("stubborn")];
    const polite = execCommand(`trap 'exit 7' TERM; touch '${m1}'; sleep 30 & wait`, { timeoutMs: 60_000, env });
    const stubborn = execCommand(`trap "" TERM; touch '${m2}'; sleep 30`, { timeoutMs: 60_000, env });
    await vi.waitFor(() => expect(existsSync(m1) && existsSync(m2)).toBe(true), { timeout: 5000 });
    expect(liveCommands()).toBe(2);
    const start = Date.now();
    await stopAll(300);
    const [p, s] = await Promise.all([polite, stubborn]);
    expect(p.exit).toBe(7); // it got SIGTERM and handled it
    expect(p.timedOut).toBe(false);
    expect(s.signal).toBe("SIGKILL");
    expect(Date.now() - start).toBeGreaterThanOrEqual(300);
    expect(liveCommands()).toBe(0);
  });

  test("returns as soon as every command has exited, without waiting out the grace period", async () => {
    const c = execCommand("sleep 30", { timeoutMs: 60_000, env });
    await vi.waitFor(() => expect(liveCommands()).toBe(1));
    const start = Date.now();
    await stopAll(20_000);
    expect((await c).signal).toBe("SIGTERM");
    expect(Date.now() - start).toBeLessThan(5000);
  });

  test("waits for every process in a stopped group, not just the shell", async () => {
    const pidFile = marker("survivor");
    const p = execCommand(`(trap "" TERM; exec sleep 30) >/dev/null 2>&1 & echo $! > '${pidFile}'; sleep 30`, {
      timeoutMs: 60_000,
      env,
    });
    await vi.waitFor(() => expect(existsSync(pidFile)).toBe(true));
    const survivor = Number(readFileSync(pidFile, "utf8"));
    const start = Date.now();
    await stopAll(300);
    expect(Date.now() - start).toBeGreaterThanOrEqual(300);
    expect(liveCommands()).toBe(0);
    expect(running(survivor)).toBe(false);
    await p;
  });

  test("with nothing running, it returns at once", async () => {
    expect(liveCommands()).toBe(0);
    await stopAll(20_000);
  });
});
