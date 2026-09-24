// M4 (SPEC §12.3): "Runner features: lock ..., process rules, timeouts,
// deadline, redaction defaults, exit codes, config." This file covers the
// CLI argument-validation slice of that: SPEC §7 step 0 (mode), step 2
// (param types and the safe-value check) and config loading (§7.1
// E-CONFIG). PLAN.md §4 F: "end-to-end CLI tests ... for exit codes,
// E-MODE, param errors ... and dry run." Expected failures: the CLI only
// supports --version today and exits 50 for everything else, so these
// currently fail on "wrong exit code" (50, not 40), not a crash.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runSkope } from "../lib/cli.js";

const SKILL = new URL("../../../fixtures/disk-full/SKILL.md", import.meta.url).pathname;
const ANSWERS = new URL("../../../fixtures/disk-full/fakes/page-direct/answers.yaml", import.meta.url).pathname;
const COMMANDS = new URL("../../../fixtures/disk-full/fakes/page-direct/commands.yaml", import.meta.url).pathname;

function errorEvent(events: object[], code: string) {
  return events.find((e) => (e as { event?: string; code?: string }).event === "error" && (e as { code?: string }).code === code);
}

describe("M4: CLI argument validation exits 40 before anything runs (SPEC §7 step 0/2, §7.1)", () => {
  test("neither --apply nor --dry-run: E-MODE, exit 40, nothing runs", async () => {
    const r = await runSkope([SKILL, "--fake", ANSWERS, "--fake-exec", COMMANDS]);
    expect(r.code).toBe(40);
    expect(errorEvent(r.events, "E-MODE")).toBeDefined();
    expect(r.events.some((e: { event: string }) => e.event === "run" || e.event === "would_do")).toBe(false);
  });

  test("both --apply and --dry-run: E-MODE, exit 40", async () => {
    const r = await runSkope([SKILL, "--apply", "--dry-run", "--fake", ANSWERS, "--fake-exec", COMMANDS]);
    expect(r.code).toBe(40);
    expect(errorEvent(r.events, "E-MODE")).toBeDefined();
  });

  test("read-only modes need neither --apply nor --dry-run: --lint alone exits 0, not 40", async () => {
    const r = await runSkope([SKILL, "--lint"]);
    expect(r.code).toBe(0); // pins real behaviour, not just the absence of E-MODE below
    expect(errorEvent(r.events, "E-MODE")).toBeUndefined();
  });

  test("an E-MODE error event has no file/line (there's no source line, SPEC §7.1)", async () => {
    const r = await runSkope([SKILL]);
    const e = errorEvent(r.events, "E-MODE") as { file?: string; line?: number } | undefined;
    expect(e).toBeDefined();
    expect(e?.file).toBeUndefined();
    expect(e?.line).toBeUndefined();
  });

  test("--param naming an unknown param: E-PARAM-UNKNOWN, exit 40", async () => {
    const r = await runSkope([SKILL, "--apply", "--param", "bogus=1", "--fake", ANSWERS, "--fake-exec", COMMANDS]);
    expect(r.code).toBe(40);
    expect(errorEvent(r.events, "E-PARAM-UNKNOWN")).toBeDefined();
  });

  test("--param with the wrong type: E-PARAM-TYPE, exit 40", async () => {
    const r = await runSkope([SKILL, "--apply", "--param", "threshold=high", "--fake", ANSWERS, "--fake-exec", COMMANDS]);
    expect(r.code).toBe(40);
    expect(errorEvent(r.events, "E-PARAM-TYPE")).toBeDefined();
  });

  test("--param failing the safe-value check: E-PARAM-UNSAFE, exit 40, before anything runs (SPEC §12.2)", async () => {
    const r = await runSkope([SKILL, "--apply", "--param", "mount=/; rm -rf /", "--fake", ANSWERS, "--fake-exec", COMMANDS]);
    expect(r.code).toBe(40);
    expect(errorEvent(r.events, "E-PARAM-UNSAFE")).toBeDefined();
    expect(r.events.some((e: { event: string }) => e.event === "run" || e.event === "would_do" || e.event === "effect_start")).toBe(false);
  });

  test("--param applies whoever the caller is, agents included (SPEC §7 step 2)", async () => {
    const r = await runSkope([SKILL, "--apply", "--param", "mount=/; rm -rf /", "--fake", ANSWERS, "--fake-exec", COMMANDS], {
      env: { SKOPE_CALLER: "agent" },
    });
    expect(r.code).toBe(40);
    expect(errorEvent(r.events, "E-PARAM-UNSAFE")).toBeDefined();
  });

  test("an unreadable --config file: E-CONFIG, exit 40", async () => {
    const r = await runSkope([SKILL, "--apply", "--config", "/nonexistent/skope-config.yaml", "--fake", ANSWERS, "--fake-exec", COMMANDS]);
    expect(r.code).toBe(40);
    expect(errorEvent(r.events, "E-CONFIG")).toBeDefined();
  });

  test("an invalid --config file (not valid YAML / wrong shape): E-CONFIG, exit 40", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skope-config-"));
    const path = join(dir, "config.yaml");
    writeFileSync(path, "ask:\n  backend: [not, a, string]\n");
    const r = await runSkope([SKILL, "--apply", "--config", path, "--fake", ANSWERS, "--fake-exec", COMMANDS]);
    expect(r.code).toBe(40);
    expect(errorEvent(r.events, "E-CONFIG")).toBeDefined();
  });

  test("every mode/param/config error is reported both on stdout (as an event) and stderr (as a readable line, SPEC §7.1)", async () => {
    const r = await runSkope([SKILL]);
    expect(errorEvent(r.events, "E-MODE")).toBeDefined();
    expect(r.stderr).toContain("E-MODE");
  });

  test("a preprocess/lint error also exits 40, before the mode is even relevant to the outcome", async () => {
    // fixtures/disk-full/SKILL.md is valid, so point at a file with no `format: 1`.
    const notRunnable = new URL("../../../fixtures/disk-full/fakes/page-direct/answers.yaml", import.meta.url).pathname;
    const r = await runSkope([notRunnable, "--apply", "--fake", ANSWERS, "--fake-exec", COMMANDS]);
    expect(r.code).toBe(40);
  });
});

describe("M4: exit codes match the outcome table (SPEC §4.1)", () => {
  test("stopped -> 0", async () => {
    const r = await runSkope([
      new URL("../../../fixtures/cert-expiry/SKILL.md", import.meta.url).pathname,
      "--apply",
      "--fake",
      new URL("../../../fixtures/cert-expiry/fakes/stop-happy/answers.yaml", import.meta.url).pathname,
      "--fake-exec",
      new URL("../../../fixtures/cert-expiry/fakes/stop-happy/commands.yaml", import.meta.url).pathname,
    ]);
    expect(r.code).toBe(0);
  });

  test("paged -> 10", async () => {
    const r = await runSkope([SKILL, "--apply", "--fake", ANSWERS, "--fake-exec", COMMANDS]);
    expect(r.code).toBe(10);
  });

  test("handoff -> 20", async () => {
    const r = await runSkope([
      SKILL,
      "--apply",
      "--no-page",
      "--fake",
      new URL("../../../fixtures/disk-full/fakes/investigate-handoff/answers.yaml", import.meta.url).pathname,
      "--fake-exec",
      new URL("../../../fixtures/disk-full/fakes/investigate-handoff/commands.yaml", import.meta.url).pathname,
    ]);
    expect(r.code).toBe(20);
  });

  test("bare skope prints the options to stderr and exits 40, with no events (SPEC §7)", async () => {
    const r = await runSkope([]);
    expect(r.code).toBe(40);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("--dry-run");
    expect(r.stderr).not.toContain("E-USAGE");
  });

  test("--version still works and exits 0 (Phase 0 baseline, not an expected failure)", async () => {
    const r = await runSkope(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^skope \d+\.\d+\.\d+(-[\w.]+)? \(build identity [0-9a-f]{64}\)/);
  });
});
