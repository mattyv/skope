// `skope SKILL.md --test` (docs/design/skill-tests.md, SPEC §7.3): each
// scenario under tests/ runs as an --apply run with its fakes, nothing real
// runs, and the run is checked against expect.yaml.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runSkope } from "../acceptance/lib/cli.js";
import { allScenarios, ROOT } from "../acceptance/lib/scenarios.js";

const RESTART_COMMANDS = {
  "Triage.used": { exit: 0, stdout: " 93%\n" },
  "Triage.errors": { exit: 0, stdout: "myapp-worker OOM\n" },
  "Triage.biggest": { exit: 0, stdout: "40G\t/var\n" },
  "systemctl restart myapp-worker": { exit: 0 },
  "Restart.used": { exit: 0, stdout: " 91%\n" },
};
const RESTART_ANSWERS = {
  "Triage.ask": { "s:clean_up": 0.03125, "s:restart": 0.875, "s:page": 0.0625, "s:investigate": 0.03125 },
  "Restart.service": { nginx: 0.03125, rsyslog: 0.03125, "myapp-worker": 0.90625, "myapp-api": 0.03125 },
};
const RESTART_EXPECT = {
  outcome: "paged",
  path: ["Triage", "Restart", "Page"],
  asks: { Triage: { chosen: "Restart" }, "Restart.service": { chosen: "myapp-worker" } },
  page_contains: "at 91%",
  max_ask_calls: 2,
};

interface Files {
  commands?: unknown;
  answers?: unknown;
  expect?: unknown;
  "expected-exit"?: string;
}

/** A copy of disk-full, or the given skill, with the given scenarios under tests/. */
function skill(scenarios: Record<string, Files>, text?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "skope-skilltest-"));
  if (text === undefined) copyFileSync(`${ROOT}/fixtures/disk-full/SKILL.md`, join(dir, "SKILL.md"));
  else writeFileSync(join(dir, "SKILL.md"), text);
  for (const [name, files] of Object.entries(scenarios)) {
    const s = join(dir, "tests", name);
    mkdirSync(s, { recursive: true });
    for (const [f, v] of Object.entries(files))
      writeFileSync(join(s, f === "expected-exit" ? f : `${f}.yaml`), typeof v === "string" ? v : JSON.stringify(v));
  }
  return join(dir, "SKILL.md");
}

const restart = (over: Partial<Files> = {}): Files => ({
  commands: RESTART_COMMANDS,
  answers: RESTART_ANSWERS,
  expect: RESTART_EXPECT,
  ...over,
});

async function test_(path: string, ...args: string[]) {
  const r = await runSkope([path, "--test", ...args]);
  const lines = r.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  return { ...r, scenarios: lines.filter((l) => "scenario" in l), summary: lines.at(-1) };
}

describe("skope --test", () => {
  test("a scenario that does what expect.yaml says passes: exit 0", async () => {
    const r = await test_(skill({ restart: restart() }));
    expect(r.code).toBe(0);
    expect(r.scenarios).toMatchObject([{ scenario: "restart", pass: true, mismatch: null }]);
    expect(r.summary).toMatchObject({ scenarios: 1, passed: 1, failed: 0, invalid: 0 });
    expect(r.stderr).toContain("PASS    restart");
    // The run's own events are kept for reading, not printed.
    expect(readFileSync(r.scenarios[0].events, "utf8")).toContain('"event":"run_start"');
  });

  test.each([
    ["outcome", { outcome: "handoff" }, "outcome: expected handoff, got paged"],
    ["exit", { exit: 20 }, "exit: expected 20, got 10"],
    ["path", { path: ["Triage", "Page"] }, "path: expected Triage → Page, got Triage → Restart → Page"],
    ["path_prefix", { path_prefix: ["Triage", "Clean up"] }, "path_prefix: expected Triage → Clean up"],
    ["a section option", { outcome: "paged", asks: { Triage: { chosen: "Page" } } }, "asks.Triage: expected Page, got Restart"],
    ["a list item", { outcome: "paged", asks: { "Restart.service": { chosen: "nginx" } } }, "expected nginx, got myapp-worker"],
    ["an ask never reached", { outcome: "paged", asks: { "Clean up": { chosen: "yes" } } }, "never reached that ask"],
    ["page_contains", { outcome: "paged", page_contains: "at 99%" }, 'page_contains: no page contains "at 99%"'],
    ["handoff_reason", { outcome: "paged", handoff_reason: "gate_failed" }, "handoff_reason: expected gate_failed"],
    ["max_ask_calls", { outcome: "paged", max_ask_calls: 1 }, "max_ask_calls: expected at most 1, got 2"],
  ])("a mismatch in %s fails the scenario: exit 60", async (_, expectDoc, mismatch) => {
    const r = await test_(skill({ restart: restart({ expect: expectDoc }) }));
    expect(r.code).toBe(60);
    expect(r.scenarios[0]).toMatchObject({ pass: false });
    expect(r.scenarios[0].mismatch).toContain(mismatch);
    expect(r.stderr).toContain("FAIL    restart");
  });

  test("an answer below sure fails asks.chosen even when it's the top option", async () => {
    const answers = { ...RESTART_ANSWERS, "Restart.service": { nginx: 0.1, rsyslog: 0.1, "myapp-worker": 0.7, "myapp-api": 0.1 } };
    const r = await test_(
      skill({ restart: restart({ answers, expect: { outcome: "handoff", asks: { "Restart.service": { chosen: "myapp-worker" } } } }) }),
    );
    expect(r.code).toBe(60);
    expect(r.scenarios[0].mismatch).toContain("below sure");
  });

  test("a command with no fake fails the scenario, with E-FAKE-UNMATCHED; nothing real runs", async () => {
    const { "Triage.errors": _, ...commands } = RESTART_COMMANDS;
    const r = await test_(skill({ restart: restart({ commands }) }));
    expect(r.code).toBe(60);
    expect(r.scenarios[0].mismatch).toContain("E-FAKE-UNMATCHED");
  });

  test.each([
    ["path", { path: ["Triage", "Restart", "Page"] }],
    ["path_prefix", { path_prefix: ["Triage"] }],
  ])("a run that breaks fails even when %s alone would match", async (_, expectDoc) => {
    const { "Restart.used": _used, ...commands } = RESTART_COMMANDS;
    const r = await test_(skill({ restart: restart({ commands, expect: expectDoc }) }));
    expect(r.code).toBe(60);
    expect(r.scenarios[0].mismatch).toContain("the run failed: E-FAKE-UNMATCHED");
  });

  test("a param that fails the safe-value check makes the scenario invalid, even with only a path to check", async () => {
    const r = await test_(skill({ restart: restart({ expect: { path: ["Triage"] } }) }), "--param", "mount=has space");
    expect(r.code).toBe(40);
    expect(r.scenarios[0].invalid).toContain("E-PARAM-UNSAFE");
  });

  test("a scenario can expect the run to break by saying exit: 50", async () => {
    const { "Restart.used": _used, ...commands } = RESTART_COMMANDS;
    const r = await test_(skill({ restart: restart({ commands, expect: { exit: 50 } }) }));
    expect(r.code).toBe(0);
  });

  test("a list item that looks like a section id is compared as the item it is", async () => {
    const text =
      "---\nname: envs\ndescription: t\nformat: 1\n---\n\n## Main\nPick one.\n\n- **ask** Which env? → one of [Envs] as env · sure 80%\n- **stop**\n\n## Envs\n- s:prod\n- dev\n";
    const r = await test_(
      skill(
        {
          pick: {
            commands: {},
            answers: { "Main.env": { "s:prod": 0.9, dev: 0.1 } },
            expect: { outcome: "stopped", asks: { "Main.env": { chosen: "s:prod" } } },
          },
        },
        text,
      ),
    );
    expect(r.scenarios[0], r.stderr).toMatchObject({ pass: true });
    expect(r.code).toBe(0);
  });

  test("do statements run through the fakes, so a failing do can be tested", async () => {
    const commands = { ...RESTART_COMMANDS, "systemctl restart myapp-worker": { exit: null, timed_out: true } };
    const r = await test_(skill({ restart: restart({ commands, expect: { outcome: "handoff", handoff_reason: "command_failed" } }) }));
    expect(r.code).toBe(0);
  });

  test("expected-exit alone still works", async () => {
    const r = await test_(skill({ restart: { commands: RESTART_COMMANDS, answers: RESTART_ANSWERS, "expected-exit": "10\n" } }));
    expect(r.code).toBe(0);
  });

  test("--scenario runs one scenario", async () => {
    const path = skill({ a: restart(), b: restart({ expect: { outcome: "stopped" } }) });
    const r = await test_(path, "--scenario", join(path, "..", "tests", "a"));
    expect(r.code).toBe(0);
    expect(r.scenarios.map((s: { scenario: string }) => s.scenario)).toEqual(["a"]);
  });

  test("every scenario runs, and one failure makes the whole run fail", async () => {
    const r = await test_(skill({ a: restart(), b: restart({ expect: { outcome: "stopped" } }) }));
    expect(r.code).toBe(60);
    expect(r.summary).toMatchObject({ scenarios: 2, passed: 1, failed: 1 });
  });

  describe("invalid scenarios: exit 40", () => {
    test.each([
      ["an unknown expect key", { expect: { outcome: "paged", colour: "red" } }, "unknown key colour"],
      ["nothing to check", { expect: { page_contains: "x" } }, "set at least one of"],
      ["path and path_prefix", { expect: { path: ["Triage"], path_prefix: ["Triage"] } }, "not both"],
      ["no expectations", { expect: undefined }, "neither expect.yaml nor expected-exit"],
      [
        "an asks key that names no ask",
        { expect: { outcome: "paged", asks: { Page: { chosen: "x" } } } },
        "asks.Page doesn't name exactly one ask",
      ],
      ["E-FAKE-UNUSED: an unused key", { commands: { ...RESTART_COMMANDS, "line:21": { exit: 0 } } }, "E-FAKE-UNUSED"],
      ["E-FAKE-AMBIGUOUS: a stable and a line key", { commands: { ...RESTART_COMMANDS, "line:23": { exit: 0 } } }, "E-FAKE-AMBIGUOUS"],
      ["E-FAKE-AMBIGUOUS: a line key and the text", { commands: { ...RESTART_COMMANDS, "line:47": { exit: 0 } } }, "E-FAKE-AMBIGUOUS"],
    ])("%s", async (_, over, why) => {
      const files = restart(over as Partial<Files>);
      if ("expect" in over && over.expect === undefined) delete files.expect;
      const r = await test_(skill({ restart: files }));
      expect(r.code).toBe(40);
      expect(r.scenarios[0].invalid).toContain(why);
      expect(r.stderr).toContain("INVALID restart");
    });

    test("a skill with no tests/ directory", async () => {
      const r = await test_(skill({}));
      expect(r.code).toBe(40);
      expect(r.summary).toMatchObject({ scenarios: 0 });
    });
  });

  test("--test takes no lock, so two test runs of one skill can run at once", async () => {
    // Two tests at once would collide on the skill's lock if --test took it.
    const path = skill({ restart: restart() });
    const [a, b] = await Promise.all([test_(path), test_(path)]);
    expect([a.code, b.code]).toEqual([0, 0]);
  });

  test.each([
    [["--apply"], "don't combine"],
    [["--fake", "a.yaml"], "--test takes its fakes from each scenario"],
  ])("--test %j is E-USAGE", async (args, why) => {
    const r = await runSkope([skill({}), "--test", ...args]);
    expect(r.code).toBe(40);
    expect(r.stderr).toContain(why);
  });

  test("--scenario without --test is E-USAGE", async () => {
    const r = await runSkope([skill({}), "--apply", "--scenario", "x"]);
    expect(r.code).toBe(40);
    expect(r.stderr).toContain("--scenario goes with --test");
  });
});

describe("the fixtures' scenarios pass under --test", () => {
  // Dry-run scenarios stay with the golden tests: --test runs as --apply.
  const scenarios = allScenarios().filter((s) => {
    const first = existsSync(s.goldenPath) ? JSON.parse(readFileSync(s.goldenPath, "utf8").split("\n")[0] as string) : {};
    return first.dry_run !== true;
  });
  test.each(scenarios.map((s) => [`${s.fixture}/${s.name}`, s]))("%s", async (_, s) => {
    const r = await test_(s.skillPath, "--scenario", s.dir);
    expect(r.scenarios[0], r.stderr).toMatchObject({ pass: true });
    expect(r.code).toBe(0);
  });
});
