// M7 (SPEC §12.3, v1.1): "the Appendix D fixture passes M1-M3 with fakes
// for each level, unsure, and backend unavailable." This file checks the
// scenario set is complete, and that --verify reports the Score ask's
// branches (SPEC §12.2). The exec-and-compare-to-golden runs of these
// scenarios are in tests/acceptance/m3/exec.test.ts, with the other fixtures.

import { describe, expect, test } from "vitest";
import { runSkope } from "../lib/cli.js";
import { allScenarios, readExpectedExit, readYaml } from "../lib/scenarios.js";

// M1's slice of error-triage's --lint coverage lives here, not in
// tests/acceptance/m1/lint-cli.test.ts: error-triage is the Appendix D fixture, which SPEC
// §12.3 scopes to M7 ("Score asks (v1.1)"), not the M1 v1 fixture pair (disk-full,
// cert-expiry).
const ERROR_TRIAGE = new URL("../../../fixtures/error-triage/SKILL.md", import.meta.url).pathname;

describe("M1 (v1.1 slice): --lint on error-triage (SPEC §7, §12.3)", () => {
  test("error-triage/SKILL.md lints clean and exits 0", async () => {
    const r = await runSkope([ERROR_TRIAGE, "--lint"]);
    expect(r.code).toBe(0);
    expect(r.events.some((e: { event: string }) => e.event === "error")).toBe(false);
  });
});

describe("M7: --verify on error-triage (SPEC §12.2)", () => {
  test("reports 4 level branches, 1 unsure and 1 unavailable at the Score ask", async () => {
    const r = await runSkope([ERROR_TRIAGE, "--verify"]);
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout.trim().split("\n").at(-1) as string);
    expect(report.asks).toEqual([{ section: "Triage", line: 19, kind: "score", branches: { options: 4, unsure: 1, unavailable: 1 } }]);
  });
});

describe("M7: error-triage fake scenarios cover every level, unsure and unavailable (SPEC §12.1 v1.1)", () => {
  const scenarios = allScenarios().filter((s) => s.fixture === "error-triage");

  test("a scenario exists for every Score level (1-4) reaching each of the skill's outcomes", () => {
    expect(scenarios.map((s) => s.name)).toEqual(
      expect.arrayContaining(["severity-1-stop", "severity-2-investigate", "severity-3-page", "severity-4-page"]),
    );
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

  // The backend being unavailable is never routed through the ask's own `else [Unsure]`: SPEC
  // §8.1 lists `ask_unavailable` as its own handoff reason, distinct from `gate_failed`
  // (§4.2/§5.4). The scenario's expected-exit (20, handoff) pins that, independent of the
  // event-stream golden checked in tests/acceptance/m3/exec.test.ts.
  test("the 'unavailable' scenario hands off (exit 20), not the ask's else (paged, exit 10)", () => {
    const s = scenarios.find((s) => s.name === "unavailable") as (typeof scenarios)[number];
    expect(readExpectedExit(s.expectedExitPath)).toBe(20);
  });
});

// Note (for the human review in tests/acceptance/REVIEW.md): SPEC §4.2's `ask` gate fails on
// a genuine tie for top probability; the fakes.schema.json `unsure` literal is documented as
// "a uniform answer, so the gate always fails" — a simpler, always-failing shortcut for
// authors who don't care which levels are involved. This fixture's "unsure" scenario instead
// hand-picks a realistic near-tie (0.45 at level 3, sub-75% sure) to exercise the ordinary
// gate-failure arithmetic; a second scenario using the literal `unsure` fake value would also
// be a reasonable M7 addition and is left to the reviewer's judgement.
