// The fake command handler (SPEC §5.4): --fake-exec answers commands from
// commands.yaml (contracts/fakes.schema.json) keyed by command text (after
// interpolation) or `line:N`, which wins when both match. A list of
// results is used in order, with the last repeating. No real command ever
// runs. An unmatched command is E-FAKE-UNMATCHED.

import type { FakesCommands, Result } from "../contracts.gen.js";

export class FakeUnmatchedCommand extends Error {
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

export interface FakeExecResult {
  exit: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type FakeExecHandler = (req: { cmd: string; src: number }) => Promise<FakeExecResult>;

export function fakeExec(commands: FakesCommands, clock?: FakeClock): FakeExecHandler {
  const counts = new Map<string, number>();
  return async (req) => {
    const lineKey = `line:${req.src}`;
    const key = Object.hasOwn(commands, lineKey) ? lineKey : Object.hasOwn(commands, req.cmd) ? req.cmd : undefined;
    if (key === undefined) throw new FakeUnmatchedCommand(`--fake-exec has no answer for: ${req.cmd} (line ${req.src})`);
    const entry = commands[key] as Result | Result[];
    const list = Array.isArray(entry) ? entry : [entry];
    const n = counts.get(key) ?? 0;
    counts.set(key, n + 1);
    const result = list[Math.min(n, list.length - 1)] as Result;
    clock?.advance(result.ms ?? 0);
    return {
      exit: result.exit,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      timedOut: result.timed_out ?? false,
    };
  };
}
