// The lock (SPEC §7 step 3): exclusive create, held → locked (exit 30),
// stale → stale_lock (exit 31), owner-only delete on exit. Raced with real
// processes, not just in-process calls.

import { execFileSync, fork } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { acquireLock } from "../../src/runner/lock.js";

let dir: string;
function freshDir() {
  dir = mkdtempSync(join(tmpdir(), "skop-lock-test-"));
  return dir;
}
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const helperPath = fileURLToPath(new URL("./fixtures/lock-holder.mjs", import.meta.url));

describe("acquireLock (SPEC §7 step 3)", () => {
  test("creates the lock file exclusively with pid and start time, and acquires it", () => {
    const d = freshDir();
    const r = acquireLock("myskill", d);
    expect(r.status).toBe("acquired");
    const file = join(d, "myskill.lock");
    expect(existsSync(file)).toBe(true);
    const info = JSON.parse(readFileSync(file, "utf8"));
    expect(info.pid).toBe(process.pid);
    expect(typeof info.startTime).toBe("number");
    if (r.status === "acquired") r.release();
  });

  test("an alive holder → status locked, and the file is left untouched", () => {
    const d = freshDir();
    const file = join(d, "myskill.lock");
    // process.pid is always alive (it's us).
    writeFileSync(file, JSON.stringify({ pid: process.pid, startTime: 123 }));
    const r = acquireLock("myskill", d);
    expect(r).toEqual({ status: "locked", holderPid: process.pid });
    expect(readFileSync(file, "utf8")).toBe(JSON.stringify({ pid: process.pid, startTime: 123 }));
  });

  test("a dead holder → status stale, and the lock file is left in place (never taken over)", () => {
    const d = freshDir();
    const file = join(d, "myskill.lock");
    // Find a pid that's certainly not running: fork a child, let it exit, reuse its pid number.
    const deadPid = Number(execFileSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]).toString());
    writeFileSync(file, JSON.stringify({ pid: deadPid, startTime: 1 }));
    const r = acquireLock("myskill", d);
    expect(r).toEqual({ status: "stale", path: file, holderPid: deadPid });
    expect(existsSync(file)).toBe(true); // never deleted or taken over
  });

  test("release deletes the lock only if it still holds this run's pid and start time", () => {
    const d = freshDir();
    const r = acquireLock("myskill", d);
    if (r.status !== "acquired") throw new Error("expected acquired");
    const file = join(d, "myskill.lock");
    // Someone else's lock now sits at the same path (simulating a race where
    // it was released and re-acquired by another run in between).
    writeFileSync(file, JSON.stringify({ pid: 999999, startTime: 42 }));
    r.release();
    // Not our lock any more, so release must not have deleted it.
    expect(existsSync(file)).toBe(true);
  });

  test("release deletes the lock it created", () => {
    const d = freshDir();
    const r = acquireLock("myskill", d);
    if (r.status !== "acquired") throw new Error("expected acquired");
    const file = join(d, "myskill.lock");
    expect(existsSync(file)).toBe(true);
    r.release();
    expect(existsSync(file)).toBe(false);
  });

  test("two real processes racing for the same lock: exactly one is acquired, the other is locked", async () => {
    const d = freshDir();
    const [a, b] = await Promise.all([raceForLock(d), raceForLock(d)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["acquired", "locked"]);
  });
});

function raceForLock(dir: string): Promise<{ status: string }> {
  return new Promise((resolve, reject) => {
    const child = fork(helperPath, [dir, "myskill"], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let out = "";
    child.stdout?.on("data", (c) => (out += c));
    child.on("exit", () => {
      try {
        resolve(JSON.parse(out.trim()));
      } catch (e) {
        reject(new Error(`bad helper output: ${JSON.stringify(out)}: ${e}`));
      }
    });
  });
}
