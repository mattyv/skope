// M5 (SPEC §8, §12.3): "record written and printed with the preamble; no
// agent launched. A handoff under --apply pages; --no-page, SKOPE_CALLER=agent
// and on_handoff: none each stop it; dry run logs would_page. The result
// doesn't depend on whether a terminal is attached." All expected failures
// until stream G's handoff paging lands (PLAN.md §4 F, §7).

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runSkope } from "../lib/cli.js";

const SKILL = new URL("../../../fixtures/disk-full/SKILL.md", import.meta.url).pathname;
const ANSWERS = new URL("../../../fixtures/disk-full/fakes/investigate-handoff/answers.yaml", import.meta.url).pathname;
const COMMANDS = new URL("../../../fixtures/disk-full/fakes/investigate-handoff/commands.yaml", import.meta.url).pathname;

const STANDARD_PREAMBLE_OPENING = "You are taking over a run of a runnable skill.";

function tempConfig(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "skope-config-"));
  const path = join(dir, "config.yaml");
  writeFileSync(path, contents);
  return path;
}

describe("M5: handoff (SPEC §8)", () => {
  test("a handoff run exits 20", async () => {
    const r = await runSkope([SKILL, "--apply", "--no-page", "--fake", ANSWERS, "--fake-exec", COMMANDS]);
    expect(r.code).toBe(20);
  });

  test("the handoff_record event carries path and record, and the outcome is 'handoff'", async () => {
    const r = await runSkope([SKILL, "--apply", "--no-page", "--fake", ANSWERS, "--fake-exec", COMMANDS]);
    const record = r.events.find((e: { event: string }) => e.event === "handoff_record") as unknown as
      | { record: Record<string, unknown> }
      | undefined;
    expect(record).toBeDefined();
    expect((r.events.at(-1) as unknown as { outcome: string }).outcome).toBe("handoff");
  });

  test("the handoff record carries the standard preamble verbatim (SPEC §8.2)", async () => {
    const r = await runSkope([SKILL, "--apply", "--no-page", "--fake", ANSWERS, "--fake-exec", COMMANDS]);
    const record = r.events.find((e: { event: string }) => e.event === "handoff_record") as unknown as { record: { preamble: string } };
    expect(record.record.preamble.startsWith(STANDARD_PREAMBLE_OPENING)).toBe(true);
    expect(record.record.preamble).toContain("Never edit the skill file yourself.");
  });

  test("--apply with no opt-out pages a human on handoff", async () => {
    const r = await runSkope([SKILL, "--apply", "--fake", ANSWERS, "--fake-exec", COMMANDS]);
    expect(r.events.some((e: { event: string }) => e.event === "handoff_page")).toBe(true);
  });

  test("--no-page stops the handoff page", async () => {
    const r = await runSkope([SKILL, "--apply", "--no-page", "--fake", ANSWERS, "--fake-exec", COMMANDS]);
    expect(r.events.some((e: { event: string }) => e.event === "handoff_page")).toBe(false);
    // Still a real handoff, just silent.
    expect((r.events.at(-1) as unknown as { outcome: string }).outcome).toBe("handoff");
  });

  test("SKOPE_CALLER=agent stops the handoff page", async () => {
    const r = await runSkope([SKILL, "--apply", "--fake", ANSWERS, "--fake-exec", COMMANDS], { env: { SKOPE_CALLER: "agent" } });
    expect(r.code).toBe(20); // pins a real handoff run, not just the absence of handoff_page below
    expect(r.events.some((e: { event: string }) => e.event === "handoff_page")).toBe(false);
  });

  test("caller in run_start is 'agent' when SKOPE_CALLER=agent, 'person' otherwise", async () => {
    const asAgent = await runSkope([SKILL, "--apply", "--no-page", "--fake", ANSWERS, "--fake-exec", COMMANDS], {
      env: { SKOPE_CALLER: "agent" },
    });
    const asPerson = await runSkope([SKILL, "--apply", "--no-page", "--fake", ANSWERS, "--fake-exec", COMMANDS]);
    expect((asAgent.events[0] as unknown as { caller: string }).caller).toBe("agent");
    expect((asPerson.events[0] as unknown as { caller: string }).caller).toBe("person");
  });

  test("on_handoff: none in config stops the handoff page", async () => {
    const config = tempConfig("on_handoff: none\nask:\n  backend: fake\n");
    const r = await runSkope([SKILL, "--apply", "--config", config, "--fake", ANSWERS, "--fake-exec", COMMANDS]);
    expect(r.code).toBe(20); // pins a real handoff run, not just the absence of handoff_page below
    expect(r.events.some((e: { event: string }) => e.event === "handoff_page")).toBe(false);
  });

  test("dry run logs would_page instead of paging, and the outcome is still handoff", async () => {
    const r = await runSkope([SKILL, "--dry-run", "--fake", ANSWERS, "--fake-exec", COMMANDS]);
    expect(r.events.some((e: { event: string }) => e.event === "page")).toBe(false);
    expect(r.events.some((e: { event: string }) => e.event === "handoff_page")).toBe(false);
    const wouldPage = r.events.find((e: { event: string }) => e.event === "would_page");
    expect(wouldPage).toBeDefined();
    expect((r.events.at(-1) as unknown as { outcome: string; dry_run: boolean }).outcome).toBe("handoff");
    expect((r.events.at(-1) as unknown as { dry_run: boolean }).dry_run).toBe(true);
  });

  test("a pager failure is logged but doesn't change the outcome (still handoff, exit 20)", async () => {
    // A pager command that always fails, configured explicitly, so the page attempt fails
    // without needing a real notification channel.
    const config = tempConfig("pager:\n  command: 'exit 1'\nask:\n  backend: fake\n");
    const r = await runSkope([SKILL, "--apply", "--config", config, "--fake", ANSWERS, "--fake-exec", COMMANDS]);
    const page = r.events.find((e: { event: string }) => e.event === "handoff_page") as unknown as { ok: boolean } | undefined;
    expect(page?.ok).toBe(false);
    expect(r.code).toBe(20);
  });

  test("handoff never happens by guessing whether a terminal is attached (piped stdio, no flags, still pages)", async () => {
    // runSkope always pipes stdio (never a tty); the page still fires because nothing said not
    // to. This is the "doesn't depend on whether a terminal is attached" clause.
    const r = await runSkope([SKILL, "--apply", "--fake", ANSWERS, "--fake-exec", COMMANDS]);
    expect(r.events.some((e: { event: string }) => e.event === "handoff_page")).toBe(true);
  });
});
