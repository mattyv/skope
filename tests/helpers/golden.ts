// Golden files for event streams (SPEC §12.3). Comparisons ignore the
// fields that differ between runs or builds: `ts`, `ms`, `run_id`, `host`,
// `skill_hash`, file paths, and skop's own version and build identity
// (which changes on every source edit, SPEC §7.2). They're dropped at every
// depth, so a handoff record inside an event is normalised too, and keys
// are sorted, so goldens don't depend on the order fields are emitted in.
//
// Set UPDATE_GOLDENS=1 to rewrite a golden from the current output. A
// rewritten golden is a claim about the spec, so review the diff. CI refuses
// to rewrite goldens.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

const VARYING = new Set([
  "ts",
  "ms",
  "run_id",
  "host",
  "skill_hash",
  "run_dir",
  "request_path",
  "request_sha256",
  "path",
  "file",
  "skop_version",
  "skop_build",
]);

function normaliseValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normaliseValue);
  if (v === null || typeof v !== "object") return v;
  return Object.fromEntries(
    Object.entries(v)
      .filter(([k]) => !VARYING.has(k))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, x]) => [k, normaliseValue(x)]),
  );
}

export function normalise(events: object[]): object[] {
  return events.map((e) => normaliseValue(e) as object);
}

export function toJsonl(events: object[]): string {
  return normalise(events)
    .map((e) => JSON.stringify(e))
    .join("\n")
    .concat("\n");
}

export function expectGolden(events: object[], file: URL): void {
  const actual = toJsonl(events);
  const path = fileURLToPath(file);
  if (process.env.UPDATE_GOLDENS === "1") {
    if (process.env.CI) throw new Error("UPDATE_GOLDENS is set in CI; goldens are only rewritten by hand, locally");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, actual);
    return;
  }
  if (!existsSync(path))
    throw new Error(`no golden at ${path}: write one by hand from the spec, or run with UPDATE_GOLDENS=1 and review it`);
  expect(actual).toBe(readFileSync(path, "utf8"));
}
