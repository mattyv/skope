// The fake command handler (SPEC §5.4): --fake-exec answers commands from
// commands.yaml (contracts/fakes.schema.json) keyed by command text (after
// interpolation) or `line:N`, which wins when both match. A list of
// results is used in order, with the last repeating. No real command ever
// runs. An unmatched command is E-FAKE-UNMATCHED. Output is capped at
// 1 MiB like a real capture (SPEC §4.4).

import type { FakesCommands, Result } from "../contracts.gen.js";
import { CAP_BYTES, type ExecResult } from "./exec.js";

// The commands.yaml the host hands to fakeExec is always already expanded (src/runner/fakes.ts
// expandCommands, called in src/host/run.ts before it reaches here), so every entry here is a
// full result object, never the string shorthand.
type FullResult = Exclude<Result, string>;

export class FakeUnmatchedCommand extends Error {
  readonly code = "E-FAKE-UNMATCHED";
}

/** An answer no real command could give: timed out, yet with an exit status. */
export class FakeInvalidResult extends Error {
  readonly code = "E-FAKE-UNMATCHED";
}

export interface FakeClock {
  elapsedMs: number;
  advance(ms: number): void;
}

export function createFakeClock(): FakeClock {
  return {
    elapsedMs: 0,
    advance(ms: number) {
      this.elapsedMs += ms;
    },
  };
}

export type FakeExecHandler = (req: { cmd: string; src: number }) => Promise<ExecResult>;

/** The last CAP_BYTES bytes, as the real capture keeps them. */
function capture(s: string): { text: string; truncated: boolean } {
  const b = Buffer.from(s, "utf8");
  return b.length > CAP_BYTES
    ? { text: b.subarray(b.length - CAP_BYTES).toString("utf8"), truncated: true }
    : { text: s, truncated: false };
}

/** Two keys answer the same command: only an error under `--test` (strict). */
export class FakeAmbiguous extends Error {
  readonly code = "E-FAKE-AMBIGUOUS";
}

export function fakeExec(commands: FakesCommands, clock?: FakeClock, strict = false): FakeExecHandler {
  const counts = new Map<string, number>();
  return async (req) => {
    const lineKey = `line:${req.src}`;
    if (strict && Object.hasOwn(commands, lineKey) && Object.hasOwn(commands, req.cmd))
      throw new FakeAmbiguous(`--fake-exec has two answers for line ${req.src}: ${lineKey} and its text, ${req.cmd}`);
    const key = Object.hasOwn(commands, lineKey) ? lineKey : Object.hasOwn(commands, req.cmd) ? req.cmd : undefined;
    if (key === undefined) throw new FakeUnmatchedCommand(`--fake-exec has no answer for: ${req.cmd} (line ${req.src})`);
    const entry = commands[key] as FullResult | FullResult[];
    const list = Array.isArray(entry) ? entry : [entry];
    const n = counts.get(key) ?? 0;
    counts.set(key, n + 1);
    const result = list[Math.min(n, list.length - 1)] as FullResult;
    const timedOut = result.timed_out ?? false;
    if (timedOut && result.exit !== null) {
      throw new FakeInvalidResult(`--fake-exec answer for ${key} has timed_out: true, so its exit must be null, not ${result.exit}`);
    }
    clock?.advance(result.ms ?? 0);
    const stdout = capture(result.stdout ?? "");
    const stderr = capture(result.stderr ?? "");
    return {
      exit: result.exit,
      signal: null,
      stdout: stdout.text,
      stderr: stderr.text,
      timedOut,
      truncated: stdout.truncated || stderr.truncated,
    };
  };
}
