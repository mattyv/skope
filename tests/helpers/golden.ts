// Golden files for event streams (SPEC §12.3). Comparisons ignore the
// fields that differ between runs or builds, and only where SPEC §10 puts
// them: an event's own `ts`, `ms`, `run_id`, `host`, `skill_hash`, paths,
// request hash and skop version and build; and inside a handoff record,
// `run_id`, `host`, `skill_hash` and `skop`. Anything else is compared,
// including a skill variable that happens to be called `path` or `host`.
// Keys are sorted at every depth, so emit order doesn't matter.
//
// Set UPDATE_GOLDENS=1 to rewrite a golden from the current output. A
// rewritten golden is a claim about the spec, so review the diff. CI refuses
// to rewrite goldens.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

// An event's own fields that vary between runs or builds (SPEC §12.3 M3).
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
// The same, inside a handoff record (SPEC §8.1).
const RECORD_VARYING = new Set(["run_id", "host", "skill_hash", "skop"]);

const byKey = ([a]: [string, unknown], [b]: [string, unknown]) => (a < b ? -1 : a > b ? 1 : 0);

function sorted(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sorted);
  if (v === null || typeof v !== "object") return v;
  return Object.fromEntries(
    Object.entries(v)
      .sort(byKey)
      .map(([k, x]) => [k, sorted(x)]),
  );
}

const without = (o: object, drop: Set<string>) => Object.fromEntries(Object.entries(o).filter(([k]) => !drop.has(k)));

function normaliseEvent(e: object): object {
  const out = without(e, VARYING);
  const record = (e as { event?: string; record?: unknown }).record;
  if ((e as { event?: string }).event === "handoff_record" && record && typeof record === "object") {
    out.record = without(record, RECORD_VARYING);
  }
  return sorted(out) as object;
}

export function normalise(events: object[]): object[] {
  return events.map(normaliseEvent);
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
