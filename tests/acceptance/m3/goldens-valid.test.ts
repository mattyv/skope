// Every line of every hand-written golden event stream (SPEC §12.3) is a
// valid event per contracts/event.schema.json, and the outcome line's exit
// mapping (SPEC §4.1) matches the scenario's expected-exit. PLAN.md §4 F:
// "every golden line must validate against contracts/event.schema.json —
// add a test for that which passes NOW, not as expected failure." These
// goldens are the ground truth for M3; a human review list is in
// tests/acceptance/REVIEW.md.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import { allScenarios, ROOT, readExpectedExit, readGolden } from "../lib/scenarios.js";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020").default;
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
ajv.addSchema(JSON.parse(readFileSync(`${ROOT}/contracts/event.schema.json`, "utf8")));
const validateEvent = ajv.getSchema("https://github.com/mattyv/skope/contracts/event.schema.json");
if (!validateEvent) throw new Error("couldn't load event.schema.json");

const EXIT_FOR_OUTCOME: Record<string, number> = {
  stopped: 0,
  paged: 10,
  handoff: 20,
  locked: 30,
  stale_lock: 31,
  invalid: 40,
  error: 50,
};

describe("golden event streams validate against contracts/event.schema.json (SPEC §10, §12.3)", () => {
  for (const s of allScenarios()) {
    describe(`${s.fixture}/${s.name}`, () => {
      const events = readGolden(s.goldenPath);

      test("every line is non-empty JSON", () => {
        expect(events.length).toBeGreaterThan(0);
      });

      test("every event validates against the event schema", () => {
        for (const [i, e] of events.entries()) {
          expect(validateEvent(e), `line ${i + 1}: ${JSON.stringify(validateEvent.errors)}\n${JSON.stringify(e)}`).toBe(true);
        }
      });

      test("run_start is first and outcome is last, exactly once each", () => {
        expect(events[0]).toMatchObject({ event: "run_start" });
        expect(events.at(-1)).toMatchObject({ event: "outcome" });
        expect(events.filter((e) => e.event === "outcome").length).toBe(1);
      });

      test("the outcome's exit code matches expected-exit", () => {
        const outcome = events.at(-1) as unknown as { outcome: string };
        expect(EXIT_FOR_OUTCOME[outcome.outcome]).toBe(readExpectedExit(s.expectedExitPath));
      });

      test("every skill/params field matches this fixture's name", () => {
        const start = events[0] as unknown as { skill: string };
        expect(start.skill).toBe(s.fixture);
      });
    });
  }
});
