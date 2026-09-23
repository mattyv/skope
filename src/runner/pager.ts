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

export async function sendPage(cfg: PagerConfig, text: string): Promise<PageResult> {
  try {
    const r = await execCommand(cfg.command, { timeoutMs: cfg.timeout_ms, input: text });
    return { ok: r.exit === 0 && !r.timedOut };
  } catch {
    return { ok: false };
  }
}
