// The run lock (SPEC §7 step 3): exclusive create at
// `$XDG_RUNTIME_DIR/skop/<name>.lock` (falling back to the OS temp dir), no
// native modules. Held → locked. Dead holder → stale_lock; skop never takes
// over or deletes a lock it doesn't own, since two runs could race to do
// it. On exit, the lock is deleted only if it still holds this run's pid
// and start time.

import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface LockInfo {
  pid: number;
  startTime: number;
}

export type LockResult =
  | { status: "acquired"; release(): void }
  | { status: "locked"; holderPid: number }
  | { status: "stale"; path: string; holderPid: number };

/** `$XDG_RUNTIME_DIR/skop`, falling back to the OS temp dir. */
export function lockDir(): string {
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  return join(runtimeDir && runtimeDir.length > 0 ? runtimeDir : tmpdir(), "skop");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists but we can't signal it: still alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function acquireLock(name: string, dir: string = lockDir()): LockResult {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.lock`);
  const info: LockInfo = { pid: process.pid, startTime: Date.now() };
  try {
    writeFileSync(file, JSON.stringify(info), { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const existing: LockInfo = JSON.parse(readFileSync(file, "utf8"));
    return isAlive(existing.pid) ? { status: "locked", holderPid: existing.pid } : { status: "stale", path: file, holderPid: existing.pid };
  }
  return {
    status: "acquired",
    release() {
      try {
        const current: LockInfo = JSON.parse(readFileSync(file, "utf8"));
        if (current.pid === info.pid && current.startTime === info.startTime) unlinkSync(file);
      } catch {
        // Already gone; nothing to do.
      }
    },
  };
}
