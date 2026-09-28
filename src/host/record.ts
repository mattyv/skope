// Recording real plan approvals, for the replay tests (tests/e2e/README.md). With SKOPE_RECORD set
// to a directory, the approval hook and a plan's run each save what they saw: the hook's input and
// the agent tool's transcript as it was at that moment. `node scripts/import-recording.mjs` turns a
// recording into an anonymised test fixture. Off unless SKOPE_RECORD is set; never fails the caller.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { preprocess } from "../preprocess/index.js";
import { planChanges } from "./plan.js";

/** The text of each file `plan` changes, relative to `root`, as it is now (null: no such file). */
function touched(plan: string | undefined, root: string | undefined): Record<string, string | null> {
  if (!plan || !root) return {};
  try {
    const parsed = preprocess(readFileSync(plan, "utf8"));
    if ("errors" in parsed) return {};
    const out: Record<string, string | null> = {};
    for (const c of planChanges(parsed.program)) {
      try {
        out[c.path] = readFileSync(join(root, c.path), "utf8");
      } catch {
        out[c.path] = null;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function record(
  stage: "hook" | "apply",
  data: { input?: unknown; transcript?: string; plan?: string; cwd?: string; root?: string },
) {
  const dir = process.env.SKOPE_RECORD;
  if (!dir) return;
  try {
    const read = (p: string | undefined) => {
      try {
        return p ? readFileSync(p, "utf8") : null;
      } catch {
        return null;
      }
    };
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${stage}-${process.pid}.json`);
    const body = {
      stage,
      cwd: data.cwd ?? process.cwd(),
      home: process.env.HOME ?? null,
      input: data.input ?? null,
      transcript_path: data.transcript ?? null,
      transcript: read(data.transcript),
      plan_path: data.plan ?? null,
      plan: read(data.plan),
      root: data.root ?? null,
      files: touched(data.plan, data.root),
    };
    writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // A recording is a debugging aid; it never changes what the hook or the run does.
  }
}
