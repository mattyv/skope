// The lock (SPEC §7 step 3): the per-user lock directory and its checks,
// atomic create, held → locked (exit 30), stale → stale_lock (exit 31),
// liveness by pid and start time, unreadable → stale with no holder, and
// owner-only delete on exit. Raced with real processes, not just
// in-process calls.

import { type ChildProcess, execFileSync, fork, spawn } from "node:child_process";
import * as realFs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { acquireLock, LockError, lockDir, processStartId, startIdFromProc, startIdFromPs } from "../../src/runner/lock.js";

const {
  chmodSync,
  chownSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} = realFs;

// Lets a test act between the lock's failed link and its read of the file.
const hooks = vi.hoisted(() => ({ beforeRead: undefined as undefined | ((path: string) => void) }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    readFileSync: ((path: realFs.PathOrFileDescriptor, ...rest: unknown[]) => {
      hooks.beforeRead?.(String(path));
      return (fs.readFileSync as (...a: unknown[]) => unknown)(path, ...rest);
    }) as typeof fs.readFileSync,
  };
});

let dir: string;
const children: ChildProcess[] = [];
const savedEnv = { ...process.env };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "skop-lock-test-"));
});
afterEach(() => {
  hooks.beforeRead = undefined;
  vi.restoreAllMocks();
  for (const c of children.splice(0)) c.kill("SIGKILL");
  for (const k of ["TMPDIR", "XDG_RUNTIME_DIR"]) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(dir, { recursive: true, force: true });
});

/** A live process that isn't us, with its pid. */
async function liveChild(): Promise<number> {
  const c = spawn("sleep", ["30"], { stdio: "ignore" });
  children.push(c);
  await new Promise((res) => c.once("spawn", res));
  return c.pid as number;
}

const deadPid = () => Number(execFileSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]).toString());

const lockFile = () => join(dir, "myskill.lock");
const writeLock = (content: unknown) => writeFileSync(lockFile(), typeof content === "string" ? content : JSON.stringify(content));

describe("acquireLock (SPEC §7 step 3)", () => {
  test("creates the lock file with pid and start time, acquires it, and leaves no temporary file", () => {
    const r = acquireLock("myskill", dir);
    expect(r.status).toBe("acquired");
    const info = JSON.parse(readFileSync(lockFile(), "utf8"));
    expect(info).toEqual({ pid: process.pid, startTime: processStartId(process.pid) });
    expect(typeof info.startTime).toBe("string");
    expect(readdirSync(dir)).toEqual(["myskill.lock"]);
    if (r.status === "acquired") r.release();
  });

  test("a live holder with a matching start time → locked, and the file is left untouched", async () => {
    const pid = await liveChild();
    writeLock({ pid, startTime: processStartId(pid) });
    const before = readFileSync(lockFile(), "utf8");
    expect(acquireLock("myskill", dir)).toEqual({ status: "locked", path: lockFile(), holderPid: pid });
    expect(readFileSync(lockFile(), "utf8")).toBe(before);
  });

  test("a live pid whose start time doesn't match (a reused pid) → stale (P2-6)", async () => {
    const pid = await liveChild();
    writeLock({ pid, startTime: "not-when-it-started" });
    expect(acquireLock("myskill", dir)).toEqual({ status: "stale", path: lockFile(), holderPid: pid });
    expect(existsSync(lockFile())).toBe(true);
  });

  test("a lock holding our own pid is stale, not held: we haven't taken it yet (P1-4)", () => {
    writeLock({ pid: process.pid, startTime: processStartId(process.pid) });
    expect(acquireLock("myskill", dir)).toEqual({ status: "stale", path: lockFile(), holderPid: process.pid });
  });

  test("a dead holder → stale, and the lock file is left in place (never taken over)", () => {
    const pid = deadPid();
    writeLock({ pid, startTime: null });
    expect(acquireLock("myskill", dir)).toEqual({ status: "stale", path: lockFile(), holderPid: pid });
    expect(existsSync(lockFile())).toBe(true);
  });

  test("a holder we may not signal (EPERM) is alive", () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
    });
    writeLock({ pid: 4242, startTime: null });
    expect(acquireLock("myskill", dir)).toEqual({ status: "locked", path: lockFile(), holderPid: 4242 });
  });

  test.each([
    ["garbage", "not json"],
    ["empty", ""],
    ["pid a string", '{"pid":"12","startTime":null}'],
    ["pid 0", '{"pid":0,"startTime":null}'],
    ["pid negative", '{"pid":-3,"startTime":null}'],
    ["pid fractional", '{"pid":1.5,"startTime":null}'],
    ["no pid", '{"startTime":null}'],
    ["JSON null", "null"],
  ])("an unparsable lock (%s) is stale with an unknown holder, and left in place (P2-5)", (_what, content) => {
    writeLock(content);
    expect(acquireLock("myskill", dir)).toEqual({ status: "stale", path: lockFile(), holderPid: null });
    expect(readFileSync(lockFile(), "utf8")).toBe(content);
  });

  test("an unreadable lock is stale with an unknown holder", () => {
    mkdirSync(lockFile()); // reading a directory fails with EISDIR
    expect(acquireLock("myskill", dir)).toEqual({ status: "stale", path: lockFile(), holderPid: null });
  });

  test("a lock released between our create and our read is retried, not reported (P2-5)", () => {
    const pid = deadPid();
    writeLock({ pid, startTime: null });
    let reads = 0;
    hooks.beforeRead = (p) => {
      if (p === lockFile() && reads++ === 0) unlinkSync(p); // the holder releases it just now
    };
    const r = acquireLock("myskill", dir);
    expect(r.status).toBe("acquired");
    expect(JSON.parse(readFileSync(lockFile(), "utf8")).pid).toBe(process.pid);
  });

  test("release deletes the lock only if it still holds this run's pid", () => {
    const r = acquireLock("myskill", dir);
    if (r.status !== "acquired") throw new Error("expected acquired");
    writeLock({ pid: 999999, startTime: "42" });
    r.release();
    expect(existsSync(lockFile())).toBe(true);
  });

  test("release deletes the lock only if it still holds this run's start time", () => {
    const r = acquireLock("myskill", dir);
    if (r.status !== "acquired") throw new Error("expected acquired");
    writeLock({ pid: process.pid, startTime: "an-earlier-process-with-our-pid" });
    r.release();
    expect(existsSync(lockFile())).toBe(true);
  });

  test("release deletes the lock it created, and a second release is harmless", () => {
    const r = acquireLock("myskill", dir);
    if (r.status !== "acquired") throw new Error("expected acquired");
    r.release();
    expect(existsSync(lockFile())).toBe(false);
    r.release();
  });

  test("a lock directory we can't write is E-IO", () => {
    expect(() => acquireLock("myskill", join(dir, "missing"))).toThrow(LockError);
  });

  test("four real processes racing for the same lock: exactly one acquires, the rest see it held by the winner (P2-5)", async () => {
    const results = await race(dir, 4);
    const winners = results.filter((r) => r.status === "acquired");
    expect(winners).toHaveLength(1);
    const winner = winners[0] as RaceResult;
    for (const r of results.filter((x) => x !== winner)) expect(r).toMatchObject({ pid: r.pid, status: "locked", holderPid: winner.pid });
    expect(existsSync(lockFile())).toBe(false); // the winner released it on the way out
  });
});

describe("process start identity (SPEC §7 step 3, P2-6)", () => {
  test("a live process has a start identity that is stable across reads", async () => {
    const pid = await liveChild();
    const id = processStartId(pid);
    expect(typeof id).toBe("string");
    expect(processStartId(pid)).toBe(id);
    expect(processStartId(process.pid)).not.toBe(id);
  });

  test("a dead process has none", () => {
    expect(processStartId(deadPid())).toBeUndefined();
  });

  test.runIf(existsSync("/proc/self/stat"))("Linux: /proc gives the start time in clock ticks, field 22 of /proc/<pid>/stat", async () => {
    const pid = await liveChild();
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const field22 = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
    expect(startIdFromProc(pid)).toMatch(new RegExp(`:${field22}$`));
    expect(startIdFromProc(deadPid())).toBeUndefined();
  });

  const hasPs = (() => {
    try {
      execFileSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  test.runIf(hasPs)("ps (macOS and the portable path): lstart for a live process, none for a dead one", async () => {
    const pid = await liveChild();
    const id = startIdFromPs(pid);
    expect(id).toMatch(/\d{4}$/); // e.g. "Wed Sep 23 12:00:00 2026"
    expect(startIdFromPs(pid)).toBe(id);
    expect(startIdFromPs(deadPid())).toBeUndefined();
  });
});

describe("lockDir (SPEC §7 step 3, P1-4)", () => {
  const uid = process.getuid?.() as number;

  test("uses $XDG_RUNTIME_DIR/skop when XDG_RUNTIME_DIR is set", () => {
    process.env.XDG_RUNTIME_DIR = dir;
    expect(lockDir()).toBe(join(dir, "skop"));
    expect(statSync(join(dir, "skop")).isDirectory()).toBe(true);
  });

  test("without XDG_RUNTIME_DIR, or with a relative one, uses <tmpdir>/skop-<uid>, created with mode 0700", () => {
    delete process.env.XDG_RUNTIME_DIR;
    process.env.TMPDIR = dir;
    const d = lockDir();
    expect(d).toBe(join(dir, `skop-${uid}`));
    expect(statSync(d).mode & 0o777).toBe(0o700);
    expect(lockDir()).toBe(d); // an existing, valid directory is reused
    process.env.XDG_RUNTIME_DIR = "relative/run";
    expect(lockDir()).toBe(d);
  });

  test("the fallback directory is refused (E-IO) when it's a symlink", () => {
    delete process.env.XDG_RUNTIME_DIR;
    process.env.TMPDIR = dir;
    mkdirSync(join(dir, "elsewhere"), { mode: 0o700 });
    symlinkSync(join(dir, "elsewhere"), join(dir, `skop-${uid}`));
    expect(() => lockDir()).toThrow(LockError);
  });

  test("the fallback directory is refused (E-IO) when it isn't a directory", () => {
    delete process.env.XDG_RUNTIME_DIR;
    process.env.TMPDIR = dir;
    writeFileSync(join(dir, `skop-${uid}`), "");
    expect(() => lockDir()).toThrow(LockError);
  });

  test.each(["770", "707", "720", "702"])("the fallback directory is refused (E-IO) when it's writable by others: mode %s", (octal) => {
    const mode = Number.parseInt(octal, 8);
    delete process.env.XDG_RUNTIME_DIR;
    process.env.TMPDIR = dir;
    mkdirSync(join(dir, `skop-${uid}`));
    chmodSync(join(dir, `skop-${uid}`), mode);
    try {
      lockDir();
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(LockError);
      expect((e as LockError).code).toBe("E-IO");
    }
  });

  test.skipIf(uid !== 0)("the fallback directory is refused (E-IO) when another user owns it (needs root to set up)", () => {
    delete process.env.XDG_RUNTIME_DIR;
    process.env.TMPDIR = dir;
    mkdirSync(join(dir, `skop-${uid}`), { mode: 0o700 });
    chownSync(join(dir, `skop-${uid}`), 12345, 12345);
    expect(() => lockDir()).toThrow(LockError);
  });
});

interface RaceResult {
  pid: number;
  status: string;
  holderPid: number | null;
}

/**
 * Forks `n` racers and waits until all are ready, then sends "go" to all
 * at once (the barrier). The winner holds the lock until every result is
 * in. Node 20 can't import .ts, so the racers load a transpiled copy.
 */
async function race(lockDirPath: string, n: number): Promise<RaceResult[]> {
  const src = readFileSync(fileURLToPath(new URL("../../src/runner/lock.ts", import.meta.url)), "utf8");
  const modDir = mkdtempSync(join(tmpdir(), "skop-lockmod-"));
  const mod = join(modDir, "lock.mjs");
  writeFileSync(
    mod,
    ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText,
  );
  const helper = fileURLToPath(new URL("./fixtures/lock-holder.mjs", import.meta.url));
  try {
    const racers = Array.from({ length: n }, () => {
      const c = fork(helper, [mod, lockDirPath, "myskill"], { execArgv: [], stdio: ["ignore", "inherit", "inherit", "ipc"] });
      children.push(c);
      return c;
    });
    await Promise.all(
      racers.map(
        (c) =>
          new Promise((res, rej) => {
            c.once("message", res);
            c.once("exit", rej);
          }),
      ),
    );
    const results = racers.map((c) => new Promise<RaceResult>((res) => c.once("message", (m) => res(m as RaceResult))));
    for (const c of racers) c.send("go");
    const all = await Promise.all(results);
    await Promise.all(
      racers.map(
        (c) =>
          new Promise((res) => {
            c.once("exit", res);
            c.send("release");
          }),
      ),
    );
    return all;
  } finally {
    rmSync(modDir, { recursive: true, force: true });
  }
}
