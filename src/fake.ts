// The fake command handler (SPEC §5.4): answers commands from a table and
// never runs a real one. An unmatched command is an error, E-FAKE-UNMATCHED.

import type { ExecHandler } from "./host.js";

export class FakeUnmatched extends Error {
  readonly code = "E-FAKE-UNMATCHED";
}

export function fakeExec(answers: Record<string, { exit: number }>): ExecHandler & { calls: string[] } {
  const calls: string[] = [];
  const handler = async (req: { cmd: string }) => {
    calls.push(req.cmd);
    const answer = answers[req.cmd];
    if (!answer) throw new FakeUnmatched(`--fake-exec has no answer for: ${req.cmd}`);
    return answer;
  };
  return Object.assign(handler, { calls });
}
