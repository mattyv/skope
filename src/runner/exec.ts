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

/**
 * Whether any process is left in the group. EPERM means one is, owned by
 * someone else (a setuid child).
 */
function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

const POLL_MS = 20;
/** After SIGKILL, anything still in the group is a zombie waiting to be reaped: it can't run, so stop waiting. */
const ZOMBIE_MS = 1000;

interface LiveCommand {
  /** SIGTERM to the group once, then SIGKILL after `graceMs`, or sooner if an earlier call asked for sooner. */
  stop(graceMs: number): void;
  /** Settles once the command has closed and, if it was stopped, its whole group is gone. */
  gone: Promise<void>;
}

/** Live commands by process group id. */
const live = new Map<number, LiveCommand>();

export function liveCommands(): number {
  return live.size;
}

/**
 * Stops every live command (SPEC §4.4, skope interrupted): SIGTERM to each
 * group, up to `graceMs` for them to exit, then SIGKILL to any left.
 * Resolves once every group is gone. The host's SIGINT/SIGTERM handler
 * calls this, then releases the lock and ends with E-INTERRUPTED.
 */
export async function stopAll(graceMs: number = DEFAULT_GRACE_MS): Promise<void> {
  for (const c of live.values()) c.stop(graceMs);
  await Promise.all([...live.values()].map((c) => c.gone));
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
    let killTimer: NodeJS.Timeout | undefined;
    let stopping = false;
    let killDue = Number.POSITIVE_INFINITY;
    let killedAt: number | undefined;
    const stop = (grace: number) => {
      if (pid === undefined || killedAt !== undefined) return;
      if (!stopping) killGroup(pid, "SIGTERM");
      stopping = true;
      // A later stop with a shorter grace (skope interrupted during a timeout's grace) brings SIGKILL forward.
      if (Date.now() + grace >= killDue) return;
      killDue = Date.now() + grace;
      clearTimeout(killTimer);
      killTimer = setTimeout(() => {
        killedAt = Date.now();
        killGroup(pid, "SIGKILL");
      }, grace);
    };
    if (pid !== undefined) live.set(pid, { stop, gone: new Promise<void>((res) => (closed = res)) });
    const done = () => {
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      if (pid !== undefined) live.delete(pid);
      closed();
    };
    // The shell can exit on SIGTERM while the rest of its group ignores it. A stopped command
    // stays live, with its SIGKILL still due, until the whole group is gone: nothing it started
    // may outlive the run's lock.
    const groupGone = async () => {
      while (pid !== undefined && groupAlive(pid) && (killedAt === undefined || Date.now() - killedAt < ZOMBIE_MS))
        await new Promise((res) => setTimeout(res, POLL_MS));
    };

    if (opts.input !== undefined) {
      // A pager that exits without reading its input makes this write fail
      // with EPIPE. That's the pager's failure, reported by its exit status.
      child.stdin?.on("error", () => {});
      child.stdin?.end(opts.input);
    }

    let timedOut = false;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      stop(graceMs);
    }, opts.timeoutMs);

    child.stdout?.on("data", (c: Buffer) => stdout.push(c));
    child.stderr?.on("data", (c: Buffer) => stderr.push(c));
    child.on("error", (err) => {
      done();
      reject(err);
    });
    child.on("close", async (code, signal) => {
      if (stopping) await groupGone();
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
