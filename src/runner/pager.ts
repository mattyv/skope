// The pager (SPEC §8): the message goes on stdin, unlike every other
// command. A pager failure is logged by the caller and never changes the
// run's outcome, so this never throws — it always resolves to a result.

import { execCommand } from "./exec.js";

export interface PagerConfig {
  command: string;
  timeout_ms: number;
}

export interface PageResult {
  ok: boolean;
}

/** `env` is the command environment (`commandEnv`, SPEC §4.4). */
export async function sendPage(cfg: PagerConfig, text: string, env: NodeJS.ProcessEnv): Promise<PageResult> {
  try {
    // A timed-out pager has exit null.
    return { ok: (await execCommand(cfg.command, { timeoutMs: cfg.timeout_ms, input: text, env })).exit === 0 };
  } catch {
    return { ok: false };
  }
}
