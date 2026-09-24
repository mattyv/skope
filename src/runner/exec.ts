// Real process execution (SPEC §4.4): `/bin/sh -c`, /dev/null stdin
// (except the pager, which gets its message on stdin), the environment the
// caller built with `commandEnv`, its own process group,
// SIGTERM+grace+SIGKILL on timeout, output capped at 1 MiB at capture
// time keeping the tail. Timeouts are implemented here, in Node, never
// with `timeout(1)`. Live process groups are tracked so the host's
// SIGINT/SIGTERM handler can stop them all (`stopAll`, E-INTERRUPTED).

import { spawn } from "node:child_process";

export interface ExecResult {
  /** null when the command timed out or was killed by a signal. */
  exit: number | null;
  /** The signal that ended the command, if one did. */
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

export interface ExecOptions {
  /** 1 to 2^31-1 ms (SPEC §4.4). */
  timeoutMs: number;
  /** Grace period between SIGTERM and SIGKILL. Default 5000ms (SPEC §4.4). */
  graceMs?: number;
  cwd?: string;
  /** The complete environment, used as is: build it with `commandEnv`. */
  env: NodeJS.ProcessEnv;
  /** The pager's message. Everything else gets /dev/null on stdin. */
  input?: string;
  /** Default 1 MiB (SPEC §4.4). */
  capBytes?: number;
}

export const DEFAULT_GRACE_MS = 5000;
export const CAP_BYTES = 1024 * 1024;
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * The environment for every command (SPEC §4.4): skope's own, minus the
 * backend key variables, plus `LC_ALL=C`, which wins over an inherited one.
 */
export function commandEnv(base: NodeJS.ProcessEnv, keyVars: readonly string[]): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const k of keyVars) delete env[k];
  env.LC_ALL = "C";
  return env;
}

/** Accumulates chunks, capped at `cap` bytes, keeping the tail. */
class CappedBuffer {
  private chunks: Buffer[] = [];
  private size = 0;
  truncated = false;
  constructor(private readonly cap: number) {}
  push(chunk: Buffer) {
    this.chunks.push(chunk);
    this.size += chunk.length;
    // Drop whole chunks that lie entirely before the last `cap` bytes.
    while (this.size - (this.chunks[0] as Buffer).length >= this.cap) {
      this.size -= (this.chunks.shift() as Buffer).length;
      this.truncated = true;
    }
  }
  toString() {
    const all = Buffer.concat(this.chunks, this.size);
    if (all.length > this.cap) this.truncated = true;
    return all.subarray(Math.max(0, all.length - this.cap)).toString("utf8");
  }
}

function killGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch {
    // Already gone.
  }
}

/** Live commands: process group id → a promise that settles when the command closes. */
const live = new Map<number, Promise<void>>();

export function liveCommands(): number {
  return live.size;
}

/**
 * Stops every live command (SPEC §4.4, skope interrupted): SIGTERM to each
 * group, up to `graceMs` for them to exit, then SIGKILL to any left.
 * Resolves once every command has closed. The host's SIGINT/SIGTERM
 * handler calls this, then releases the lock and ends with E-INTERRUPTED.
 */
export async function stopAll(graceMs: number = DEFAULT_GRACE_MS): Promise<void> {
  if (live.size === 0) return;
  for (const pid of live.keys()) killGroup(pid, "SIGTERM");
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([Promise.all(live.values()), new Promise((res) => (timer = setTimeout(res, graceMs)))]);
  clearTimeout(timer);
  for (const pid of live.keys()) killGroup(pid, "SIGKILL");
  await Promise.all(live.values());
}

const validMs = (ms: number, min: number) => Number.isInteger(ms) && ms >= min && ms <= MAX_TIMER_MS;

export function execCommand(cmd: string, opts: ExecOptions): Promise<ExecResult> {
  const graceMs = opts.graceMs ?? DEFAULT_GRACE_MS;
  // Node fires a timer longer than 2^31-1 ms at once, so bound it here.
  if (!validMs(opts.timeoutMs, 1)) return Promise.reject(new RangeError(`timeout must be 1 to ${MAX_TIMER_MS} ms, got ${opts.timeoutMs}`));
  if (!validMs(graceMs, 0)) return Promise.reject(new RangeError(`grace must be 0 to ${MAX_TIMER_MS} ms, got ${graceMs}`));
  const stdout = new CappedBuffer(opts.capBytes ?? CAP_BYTES);
  const stderr = new CappedBuffer(opts.capBytes ?? CAP_BYTES);

  return new Promise((resolve, reject) => {
    const child = spawn("/bin/sh", ["-c", cmd], {
      // stdin: /dev/null unless the caller supplies input (the pager).
      stdio: [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      cwd: opts.cwd,
      env: opts.env,
      // A new process group (POSIX), so a timeout can kill the whole
      // group, not just the direct child.
      detached: true,
    });
    const pid = child.pid;
    let closed = () => {};
    if (pid !== undefined) live.set(pid, new Promise<void>((res) => (closed = res)));
    const done = () => {
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      if (pid !== undefined) live.delete(pid);
      closed();
    };

    if (opts.input !== undefined) {
      // A pager that exits without reading its input makes this write fail
      // with EPIPE. That's the pager's failure, reported by its exit status.
      child.stdin?.on("error", () => {});
      child.stdin?.end(opts.input);
    }

    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      if (pid === undefined) return;
      killGroup(pid, "SIGTERM");
      killTimer = setTimeout(() => killGroup(pid, "SIGKILL"), graceMs);
    }, opts.timeoutMs);

    child.stdout?.on("data", (c: Buffer) => stdout.push(c));
    child.stderr?.on("data", (c: Buffer) => stderr.push(c));
    child.on("error", (err) => {
      done();
      reject(err);
    });
    child.on("close", (code, signal) => {
      done();
      const out = stdout.toString();
      const err = stderr.toString();
      resolve({
        exit: timedOut ? null : code,
        signal,
        stdout: out,
        stderr: err,
        timedOut,
        truncated: stdout.truncated || stderr.truncated,
      });
    });
  });
}
