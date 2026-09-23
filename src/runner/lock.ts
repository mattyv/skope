// The run lock (SPEC §7 step 3), with no native modules.
//
// - Where: `$XDG_RUNTIME_DIR/skop`, else a per-user `<tmpdir>/skop-<uid>`
//   created 0700. Either is refused (E-IO) unless it's a real directory,
//   not a symlink, owned by us and not writable by anyone else.
// - Created atomically: a temporary file holding our pid and start time is
//   hard-linked into place, which fails if the lock exists, so the lock is
//   never seen half-written.
// - Held → locked. A holder is alive only if its pid is running and it
//   started when the lock says, so a reused pid doesn't keep a dead run's
//   lock. Otherwise → stale_lock, and an unreadable or unparsable lock is
//   stale with an unknown holder. Skop never takes over or deletes a lock
//   it doesn't own, since two runs could race to do it.
// - On exit, the lock is deleted only if it still holds exactly what this
//   run wrote.
//
// This file imports only Node built-ins: lock.test.ts races real processes
// on a transpiled copy of it.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, linkSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

export class LockError extends Error {
  readonly code = "E-IO";
}

export type LockResult =
  | { status: "acquired"; release(): void }
  | { status: "locked"; holderPid: number }
  | { status: "stale"; path: string; holderPid: number | null };

/** What a lock file holds. `startTime` is `processStartId`, or null where it can't be found. */
interface LockInfo {
  pid: number;
  startTime: string | null;
}

/**
 * The lock directory, created if needed and checked (SPEC §7 step 3).
 * Throws LockError (E-IO) if it can't be made or isn't safe to use.
 */
export function lockDir(): string {
  const runtime = process.env.XDG_RUNTIME_DIR;
  // A relative XDG_RUNTIME_DIR is ignored, per the XDG spec.
  const dir = runtime && isAbsolute(runtime) ? join(runtime, "skop") : join(tmpdir(), `skop-${process.geteuid?.()}`);
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST")
      throw new LockError(`can't create lock directory ${dir}: ${(err as Error).message}`);
  }
  const st = lstatSync(dir);
  const why = !st.isDirectory()
    ? "isn't a directory (or is a symlink)"
    : st.uid !== process.geteuid?.()
      ? `is owned by uid ${st.uid}, not us`
      : st.mode & 0o022
        ? "is writable by others"
        : undefined;
  if (why) throw new LockError(`lock directory ${dir} ${why}`);
  return dir;
}

/**
 * When a process started, as an opaque string to compare for equality:
 * a string if it's running, undefined if it isn't, null if that can't be
 * told here. Linux reads /proc; elsewhere (macOS), `ps`.
 */
export function processStartId(pid: number): string | null | undefined {
  return existsSync("/proc/self/stat") ? startIdFromProc(pid) : startIdFromPs(pid);
}

/**
 * Linux: the boot id plus field 22 of /proc/<pid>/stat, the start time in
 * clock ticks since boot. Exact, and unlike wall-clock time (btime + ticks)
 * it can't jitter; the boot id tells a reboot apart. A zombie has exited.
 */
export function startIdFromProc(pid: number): string | null | undefined {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? undefined : null;
  }
  // The command name (field 2) is in parentheses and may hold spaces or
  // parentheses itself, so fields are counted from the last ')'.
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  if (fields[0] === "Z" || fields[0] === "X") return undefined;
  let boot = "";
  try {
    boot = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  } catch {
    // Not every kernel exposes it; the tick count alone still tells pids apart.
  }
  return fields[19] === undefined ? null : `${boot}:${fields[19]}`;
}

/** macOS and other systems without /proc: `ps -o lstart=`, the start time to the second. */
export function startIdFromPs(pid: number): string | null | undefined {
  try {
    const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out === "" ? undefined : out;
  } catch (err) {
    // ps exits 1 when there's no such process; anything else means we can't tell.
    return (err as { status?: number }).status === 1 ? undefined : null;
  }
}

function holderAlive(h: LockInfo): boolean {
  try {
    process.kill(h.pid, 0);
  } catch (err) {
    // EPERM means it exists but we can't signal it: still running.
    if ((err as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  const actual = processStartId(h.pid);
  // Where either side couldn't find a start time, the pid alone decides.
  return h.startTime === null || actual === null || actual === h.startTime;
}

function parseLock(text: string): LockInfo | null {
  try {
    const v = JSON.parse(text);
    if (Number.isInteger(v?.pid) && v.pid >= 1 && (typeof v.startTime === "string" || v.startTime === null)) return v;
  } catch {
    // Unparsable: stale, holder unknown.
  }
  return null;
}

const errno = (err: unknown) => (err as NodeJS.ErrnoException).code;

export function acquireLock(name: string, dir: string = lockDir()): LockResult {
  const file = join(dir, `${name}.lock`);
  const content = JSON.stringify({ pid: process.pid, startTime: processStartId(process.pid) ?? null } satisfies LockInfo);
  const tmp = join(dir, `.${name}.lock.${process.pid}.${randomUUID()}`);
  try {
    writeFileSync(tmp, content, { flag: "wx", mode: 0o600 });
  } catch (err) {
    throw new LockError(`can't write lock file in ${dir}: ${(err as Error).message}`);
  }
  try {
    // A lock can vanish between our failed link and our read (its holder
    // released it): try again, a few times.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        linkSync(tmp, file);
        return { status: "acquired", release: () => releaseLock(file, content) };
      } catch (err) {
        if (errno(err) !== "EEXIST") throw new LockError(`can't create lock file ${file}: ${(err as Error).message}`);
      }
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch (err) {
        if (errno(err) === "ENOENT") continue;
        return { status: "stale", path: file, holderPid: null };
      }
      const holder = parseLock(text);
      // Our own pid in the lock is an earlier process that had it.
      if (holder === null || holder.pid === process.pid) return { status: "stale", path: file, holderPid: holder?.pid ?? null };
      return holderAlive(holder) ? { status: "locked", holderPid: holder.pid } : { status: "stale", path: file, holderPid: holder.pid };
    }
    throw new LockError(`lock file ${file} keeps appearing and disappearing`);
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      // Already gone.
    }
  }
}

function releaseLock(file: string, content: string): void {
  try {
    if (readFileSync(file, "utf8") === content) unlinkSync(file);
  } catch {
    // Already gone; nothing to do.
  }
}
