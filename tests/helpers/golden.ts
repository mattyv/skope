// Golden files for event streams (SPEC §12.3). Comparisons ignore the
// fields that differ between runs: `ts`, `ms`, `run_id`, `host`,
// `skill_hash` and file paths.
//
// Set UPDATE_GOLDENS=1 to rewrite a golden from the current output. A
// rewritten golden is a claim about the spec, so review the diff.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { expect } from "vitest";

const VARYING = new Set(["ts", "ms", "run_id", "host", "skill_hash", "run_dir", "request_path", "path"]);

export function normalise(events: object[]): object[] {
  return events.map((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !VARYING.has(k))));
}

export function toJsonl(events: object[]): string {
  return normalise(events)
    .map((e) => JSON.stringify(e))
    .join("\n")
    .concat("\n");
}

export function expectGolden(events: object[], file: URL): void {
  const actual = toJsonl(events);
  if (process.env.UPDATE_GOLDENS === "1") {
    mkdirSync(dirname(file.pathname), { recursive: true });
    writeFileSync(file, actual);
    return;
  }
  if (!existsSync(file))
    throw new Error(`no golden at ${file.pathname}: write one by hand from the spec, or run with UPDATE_GOLDENS=1 and review it`);
  expect(actual).toBe(readFileSync(file, "utf8"));
}
