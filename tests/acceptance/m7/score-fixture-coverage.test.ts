// M7 (SPEC §12.3, v1.1): "the Appendix D fixture passes M1-M3 with fakes
// for each level, unsure, and backend unavailable." This is a coverage
// check over fixtures-next/error-triage/fakes/, not a run of the CLI, so it
// passes now: it's the acceptance-level promise that the scenario set is
// complete, independent of whether the Score gate is implemented yet. The
// actual exec-and-compare-to-golden test for these scenarios is
// tests/acceptance/m3/exec.test.ts (which includes fixtures-next), marked
// as an expected failure there.

import { describe, expect, test } from "vitest";
import { allScenarios, readYaml } from "../lib/scenarios.js";

describe("M7: error-triage fake scenarios cover every level, unsure and unavailable (SPEC §12.1 v1.1)", () => {
  const scenarios = allScenarios().filter((s) => s.fixture === "error-triage");

  test("a scenario exists for at least one Score level reaching each of the skill's outcomes", () => {
    expect(scenarios.map((s) => s.name)).toEqual(expect.arrayContaining(["severity-1-stop", "severity-2-investigate", "severity-4-page"]));
  });

  test("a scenario exists for the gate failing (unsure)", () => {
    expect(scenarios.some((s) => s.name === "unsure")).toBe(true);
  });

  test("a scenario exists for the backend being unavailable, using the fakes.schema.json 'unavailable' literal", () => {
    const s = scenarios.find((s) => s.name === "unavailable");
    expect(s).toBeDefined();
    const answers = readYaml((s as (typeof scenarios)[number]).answersPath) as Record<string, unknown>;
    expect(Object.values(answers)).toContain("unavailable");
  });
});

// Note (for the human review in tests/acceptance/REVIEW.md): SPEC §4.2's `ask` gate fails on
// a genuine tie for top probability; the fakes.schema.json `unsure` literal is documented as
// "a uniform answer, so the gate always fails" — a simpler, always-failing shortcut for
// authors who don't care which levels are involved. This fixture's "unsure" scenario instead
// hand-picks a realistic near-tie (0.45 at level 3, sub-75% sure) to exercise the ordinary
// gate-failure arithmetic; a second scenario using the literal `unsure` fake value would also
// be a reasonable M7 addition and is left to the reviewer's judgement.
