// Real process execution (SPEC §4.4): `/bin/sh -c`, /dev/null stdin
// (except the pager, which gets its message on stdin), LC_ALL=C, its own
// process group, SIGTERM+grace+SIGKILL on timeout, output capped at 1 MiB
// at capture time keeping the tail. Timeouts are implemented here, in
// Node, never with `timeout(1)`.

import { spawn } from "node:child_process";
import { openSync } from "node:fs";

export interface ExecResult {
  exit: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

export interface ExecOptions {
  timeoutMs: number;
  /** Grace period between SIGTERM and SIGKILL. Default 5000ms (SPEC §4.4). */
  graceMs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** The pager's message. Everything else gets /dev/null on stdin. */
  input?: string;
  /** Default 1 MiB (SPEC §4.4). */
  capBytes?: number;
}

const DEFAULT_GRACE_MS = 5000;
const DEFAULT_CAP_BYTES = 1024 * 1024;

/** Accumulates chunks, capped at `capBytes`, keeping the tail. */
class CappedBuffer {
  private buf = Buffer.alloc(0);
  truncated = false;
  constructor(private readonly cap: number) {}
  push(chunk: Buffer) {
    this.buf = Buffer.concat([this.buf, chunk]);
    if (this.buf.length > this.cap) {
      this.buf = this.buf.subarray(this.buf.length - this.cap);
      this.truncated = true;
    }
  }
  toString() {
    return this.buf.toString("utf8");
  }
}

export function execCommand(cmd: string, opts: ExecOptions): Promise<ExecResult> {
  const graceMs = opts.graceMs ?? DEFAULT_GRACE_MS;
  const capBytes = opts.capBytes ?? DEFAULT_CAP_BYTES;
  const stdout = new CappedBuffer(capBytes);
  const stderr = new CappedBuffer(capBytes);

  return new Promise((resolve, reject) => {
    // stdin: /dev/null unless the caller supplies input (the pager).
    const devNullFd = opts.input === undefined ? openSync("/dev/null", "r") : undefined;
    const child = spawn("/bin/sh", ["-c", cmd], {
      stdio: [devNullFd ?? "pipe", "pipe", "pipe"],
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env, LC_ALL: "C" },
      // A new process group (POSIX), so a timeout can kill the whole
      // group, not just the direct child.
      detached: true,
    });

    if (opts.input !== undefined) {
      child.stdin?.end(opts.input);
    }

    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          // Already gone.
        }
      }
      killTimer = setTimeout(() => {
        if (child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            // Already gone.
          }
        }
      }, graceMs);
    }, opts.timeoutMs);

    child.stdout?.on("data", (c: Buffer) => stdout.push(c));
    child.stderr?.on("data", (c: Buffer) => stderr.push(c));
    child.on("error", (err) => {
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      resolve({
        exit: timedOut ? null : code,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        timedOut,
        truncated: stdout.truncated || stderr.truncated,
      });
    });
  });
}
