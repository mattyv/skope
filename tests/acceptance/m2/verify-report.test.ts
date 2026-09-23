// M2 (SPEC §12.3): "--verify on both fixtures terminates, reports every
// path ending in an outcome, and reports max backend calls. (disk-full:
// Clean up loop is 5 items, bounded.)" See the note on the verify report's
// JSON shape in tests/acceptance/m2/differential.test.ts — the same
// assumption applies here. Expected failure until --verify exists.

import { describe, expect, test } from "vitest";
import { runSkop } from "../lib/cli.js";

const DISK_FULL = new URL("../../../fixtures/disk-full/SKILL.md", import.meta.url).pathname;
const CERT_EXPIRY = new URL("../../../fixtures/cert-expiry/SKILL.md", import.meta.url).pathname;

// Stream G: SPEC §7 has no --json flag, and SPEC §5.4 counts paths over the
// memoised graph rather than listing them ("not by listing paths"), so the
// report is one JSON line with `paths` as a count and `outcomes` as the
// reachable outcomes (`stopped`, `paged`, `handoff:<reason>`, SPEC §5.6).
interface VerifyReport {
  paths: number;
  outcomes: string[];
  max_ask_calls: number;
  max_effects: number;
  unreached_sections: string[];
  skop_version: string;
  skop_build: string;
}

async function verify(skill: string): Promise<VerifyReport> {
  const r = await runSkop([skill, "--verify"], { input: undefined });
  // The report is the last stdout line; warning events come before it (SPEC §7).
  return JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "") as VerifyReport;
}

describe("M2: --verify (SPEC §5.4, §5.6)", () => {
  test.fails("terminates on disk-full and reports a finite, non-empty set of paths", async () => {
    const report = await verify(DISK_FULL);
    expect(report.paths).toBeGreaterThan(0);
  });

  test.fails("terminates on cert-expiry and reports a finite, non-empty set of paths", async () => {
    const report = await verify(CERT_EXPIRY);
    expect(report.paths).toBeGreaterThan(0);
  });

  test.fails("every path ends in a real outcome (stopped, paged or handoff) — never falls through, never 'error' (P6)", async () => {
    const report = await verify(DISK_FULL);
    expect(report.outcomes.length).toBeGreaterThan(0);
    for (const o of report.outcomes) expect(o).toMatch(/^(stopped|paged|handoff:(explicit|gate_failed|command_failed|ask_unavailable))$/);
  });

  test.fails("reports max backend (ask) calls on any path", async () => {
    const report = await verify(DISK_FULL);
    expect(report.max_ask_calls).toBeGreaterThan(0);
  });

  test.fails("disk-full's Clean up loop is 5 items, bounded: reflected in a finite max_effects", async () => {
    const report = await verify(DISK_FULL);
    // 5 Cleanups items in Clean up, each up to one `do`, plus at most one Restart `do`
    // and the two Renew `do`s don't apply to disk-full: the ceiling here is generous on
    // purpose (this pins "finite and small", not an exact author-facing number).
    expect(report.max_effects).toBeGreaterThan(0);
    expect(report.max_effects).toBeLessThanOrEqual(5);
  });

  test.fails("the report stamps the same build identity `skop --version` prints (SPEC §7.2)", async () => {
    const version = await runSkop(["--version"]);
    const report = await verify(DISK_FULL);
    const m = version.stdout.match(/build identity ([0-9a-f]{64})/);
    expect(m).not.toBeNull();
    expect(report.skop_build).toBe(m?.[1]);
  });
});
