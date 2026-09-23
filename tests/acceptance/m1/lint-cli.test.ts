// M1 (SPEC §12.3): "both fixtures produce the expected core JSON (golden
// files) with source maps; all parse-level negative tests fail with correct
// lines." The core-JSON goldens and their negative-parse coverage are owned
// by stream A (tests/examples.test.ts, tests/contracts.test.ts at the repo
// root — not tests/acceptance/, so not duplicated here). This file is F's
// M1 slice: the CLI's own `--lint` entry point, read-only, over all three
// example skills. Expected failure until the CLI does more than --version.

import { describe, expect, test } from "vitest";
import { runSkop } from "../lib/cli.js";

const SKILLS = [
  new URL("../../../fixtures/disk-full/SKILL.md", import.meta.url).pathname,
  new URL("../../../fixtures/cert-expiry/SKILL.md", import.meta.url).pathname,
  new URL("../../../fixtures-next/error-triage/SKILL.md", import.meta.url).pathname,
];

describe("M1: --lint on every example skill (SPEC §7)", () => {
  for (const skill of SKILLS) {
    test.fails(`${skill.split("/").slice(-2).join("/")} lints clean and exits 0`, async () => {
      const r = await runSkop([skill, "--lint"]);
      expect(r.code).toBe(0);
      expect(r.events.some((e: { event: string }) => e.event === "error")).toBe(false);
    });
  }

  test.fails("--lint runs nothing: no run, do, would_do, check_cmd, ask or page event", async () => {
    const r = await runSkop([SKILLS[0] as string, "--lint"]);
    expect(r.code).toBe(0); // pins real behaviour, not just the absence of events below
    const ran = new Set(["run", "check_cmd", "do", "would_do", "ask", "page", "would_page", "effect_start"]);
    expect(r.events.some((e: { event: string }) => ran.has(e.event))).toBe(false);
  });
});
