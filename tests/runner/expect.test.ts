// The hand check of expect.yaml (src/runner/expect.ts) against
// contracts/expect.schema.json, with ajv as the oracle.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import { expectError } from "../../src/runner/expect.js";
import { ROOT } from "../acceptance/lib/scenarios.js";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020").default;
const schema = JSON.parse(readFileSync(`${ROOT}/contracts/expect.schema.json`, "utf8"));
const validate = new Ajv2020({ strict: false }).compile(schema) as (v: unknown) => boolean;

const DOCS: unknown[] = [
  { outcome: "paged" },
  { exit: 10 },
  { path: ["Triage", "Page"] },
  { path_prefix: ["Triage"] },
  { outcome: "handoff", handoff_reason: "gate_failed", max_ask_calls: 0 },
  { outcome: "paged", asks: { Triage: { chosen: "Restart" }, "Clean up.x": { chosen: 3 } }, page_contains: "full" },
  { outcome: "paged", live: { runs: 10, min_hit_rate: 0.8, min_margin: 5 } },
  { outcome: "paged", live: {} },
  { exit: 255 },
  { outcome: "paged", live: { runs: 999999 } },
  // Invalid:
  null,
  [],
  "paged",
  {},
  { page_contains: "x" },
  { outcome: "done" },
  { exit: 1.5 },
  { exit: "10" },
  { path: [] },
  { path: ["Triage", ""] },
  { path: "Triage" },
  { path: ["A"], path_prefix: ["A"] },
  { outcome: "paged", colour: "red" },
  { outcome: "paged", asks: [] },
  { outcome: "paged", asks: { "": { chosen: "x" } } },
  { outcome: "paged", asks: { T: {} } },
  { outcome: "paged", asks: { T: { chosen: "x", extra: 1 } } },
  { outcome: "paged", asks: { T: { chosen: 1.5 } } },
  { outcome: "paged", asks: { T: { chosen: null } } },
  { outcome: "paged", page_contains: "" },
  { outcome: "paged", handoff_reason: "because" },
  { outcome: "paged", max_ask_calls: -1 },
  { outcome: "paged", live: { runs: 0 } },
  { outcome: "paged", live: { min_hit_rate: 1.5 } },
  { outcome: "paged", live: { min_margin: "5" } },
  { outcome: "paged", live: { runz: 3 } },
  { outcome: "paged", live: [] },
  // ajv counts Infinity (YAML .inf) as an integer, so only an upper bound keeps it out.
  { exit: -1 },
  { exit: 256 },
  { exit: Number.POSITIVE_INFINITY },
  { outcome: "paged", live: { runs: 1000000 } },
  { outcome: "paged", live: { runs: Number.POSITIVE_INFINITY } },
];

describe("expectError agrees with contracts/expect.schema.json", () => {
  test.each(DOCS.map((d) => [JSON.stringify(d), d]))("%s", (_, doc) => {
    expect(expectError(doc) === null, `${expectError(doc)}`).toBe(validate(doc));
  });
});

describe("expect.yaml bounds", () => {
  // An unbounded live.runs repeats real backend calls without end; exit codes stop at 255.
  test.each([
    ["exit -1", { exit: -1 }],
    ["exit 256", { exit: 256 }],
    ["exit .inf", { exit: Number.POSITIVE_INFINITY }],
    ["live.runs over --runs' cap", { outcome: "paged", live: { runs: 1000000 } }],
    ["live.runs .inf", { outcome: "paged", live: { runs: Number.POSITIVE_INFINITY } }],
  ])("%s is invalid", (_, doc) => {
    expect(expectError(doc)).not.toBeNull();
    expect(validate(doc)).toBe(false);
  });
});
