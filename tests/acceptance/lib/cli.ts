// Spawns the built CLI (PLAN.md §4 F: "end-to-end CLI tests ... spawn `node
// dist/cli.js` with args"). Every acceptance test that needs a live process
// goes through this, so there's one place that knows how skop is invoked.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../../../dist/cli.js", import.meta.url));

/** A parsed line of skop's JSON Lines output (SPEC §10); shape varies by `event`. */
export type SkopEvent = { event: string } & Record<string, unknown>;

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
  events: SkopEvent[];
}

export function runSkop(args: string[], opts: { env?: Record<string, string>; input?: string } = {}): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, ...opts.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      const events: SkopEvent[] = stdout
        .split("\n")
        .filter(Boolean)
        .flatMap((l) => {
          try {
            return [JSON.parse(l) as SkopEvent];
          } catch {
            return []; // stdout isn't JSON Lines yet (pre-M2): ignore for event-shaped assertions
          }
        });
      resolve({ code, stdout, stderr, events });
    });
    if (opts.input !== undefined) child.stdin.write(opts.input);
    child.stdin.end();
  });
}
