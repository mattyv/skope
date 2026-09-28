// `ask each` end to end through the built CLI (SPEC §4.8): parsing, lint,
// per-item asks gated by the core, the report, the cap, stopping early,
// dry runs, --effects, --verify and tests.yaml `sweeps`.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { Section } from "../../src/contracts.gen.js";
import { preprocess } from "../../src/preprocess/index.js";
import { runSkope, type SkopeEvent } from "../acceptance/lib/cli.js";
import { skillMd } from "../preprocess/helpers.js";

const Ajv2020 = createRequire(import.meta.url)("ajv/dist/2020").default;
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const validEvent = ajv.compile(JSON.parse(readFileSync(new URL("../../contracts/event.schema.json", import.meta.url), "utf8")));

const SWEEP = "- **ask each** line of `grep -n {word} notes.txt`: Is {line} a revision-history entry? → yes | no · sure 80%";
const GREP = "grep -n Score notes.txt";

function dir() {
  return mkdtempSync(join(tmpdir(), "skope-sweep-"));
}

function skill(d: string, body: string, block = "params:\n  word: Score\n"): string {
  const path = join(d, "SKILL.md");
  writeFileSync(
    path,
    `---\nname: sweep\ndescription: a test skill\n---\nA skope skill.\n\`\`\`skope\nformat: 1\n${block}\`\`\`\n\n## Main\nHistory entries record an earlier revision.\n\n${body}\n`,
  );
  return path;
}

function yaml(d: string, name: string, doc: unknown): string {
  const path = join(d, name);
  writeFileSync(path, JSON.stringify(doc));
  return path;
}

const of = (events: SkopeEvent[], event: string) => events.filter((e) => e.event === event);

async function sweep(stdout: string | Record<string, unknown>, answers: unknown, extra: string[] = [], body = `${SWEEP}\n- **stop**`) {
  const d = dir();
  const r = await runSkope([
    skill(d, body),
    ...(extra.includes("--dry-run") ? [] : ["--apply"]),
    "--fake-exec",
    yaml(d, "c.yaml", { [GREP]: stdout }),
    "--fake",
    yaml(d, "a.yaml", { "Main.ask": answers }),
    ...extra,
  ]);
  for (const e of r.events) expect(validEvent(e), JSON.stringify(validEvent.errors)).toBe(true);
  return r;
}

describe("parsing", () => {
  test("ask each becomes an ask_each statement with its item, command, question and sure", () => {
    const r = preprocess(skillMd("## Main", SWEEP, "- **stop**"));
    if ("errors" in r) throw new Error(JSON.stringify(r.errors));
    const body = (r.program.sections["s:main"] as Section).body;
    expect(body[0]).toMatchObject({
      ask_each: {
        item: "line",
        cmd: [{ lit: "grep -n " }, { var: "word" }, { lit: " notes.txt" }],
        question: [{ lit: "Is " }, { var: "line" }, { lit: " a revision-history entry?" }],
        sure: 80,
      },
    });
  });

  test.each([
    ["no sure", "- **ask each** line of `ls`: Is {line} old? → yes | no"],
    ["sure over 100", "- **ask each** line of `ls`: Is {line} old? → yes | no · sure 101%"],
    ["no of", "- **ask each** line `ls`: Is {line} old? → yes | no · sure 80%"],
    ["not yes | no", "- **ask each** line of `ls`: Is {line} old? → one of [L] as x · sure 80%"],
    ["an else", "- **ask each** line of `ls`: Is {line} old? → yes | no · sure 80% · else skip"],
    ["no question", "- **ask each** line of `ls`:  → yes | no · sure 80%"],
  ])("E-GRAMMAR: %s", (_, line) => {
    const r = preprocess(skillMd("## Main", line, "- **stop**"));
    expect("errors" in r && r.errors.map((e) => e.code)).toEqual(["E-GRAMMAR"]);
  });
});

describe("lint", () => {
  test("E-TAINT: command output can't reach a sweep's command", async () => {
    const d = dir();
    const r = await runSkope([
      skill(d, "- **run** `ls` as out\n- **ask each** f of `cat {out}`: Is {f} old? → yes | no · sure 80%\n- **stop**"),
      "--lint",
    ]);
    expect(r.code).toBe(40);
    expect(of(r.events, "error").map((e) => e.code)).toContain("E-TAINT");
  });

  test("the item is bound only in the question: using it later is an error", async () => {
    const d = dir();
    const r = await runSkope([skill(d, `${SWEEP}\n- **check** {line} > 3 → stop\n- **stop**`), "--lint"]);
    expect(r.code).toBe(40);
  });

  test("--effects lists the sweep's command as a run", async () => {
    const d = dir();
    const r = await runSkope([skill(d, `${SWEEP}\n- **stop**`), "--effects"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("grep -n {word} notes.txt");
  });

  test("--verify counts a sweep as its 200-line cap", async () => {
    const d = dir();
    const r = await runSkope([skill(d, `${SWEEP}\n- **stop**`), "--verify"]);
    expect(r.code).toBe(0);
    expect(r.events.at(-1) ?? JSON.parse(r.stdout.trim().split("\n").at(-1) as string)).toMatchObject({ max_ask_calls: 200 });
  });

  test("a sweep-only skill requires the configured backend", async () => {
    const d = dir();
    const config = yaml(d, "config.yaml", { ask: { backend: "jev" } });
    const commands = yaml(d, "commands.yaml", { [GREP]: "one\n" });
    const r = await runSkope([skill(d, `${SWEEP}\n- **stop**`), "--dry-run", "--config", config, "--fake-exec", commands]);
    expect(r.code).toBe(40);
    expect(r.events.find((e) => e.event === "error")).toMatchObject({ code: "E-CONFIG" });
    expect(r.stderr).toContain("has no jev block");
  });
});

describe("runs", () => {
  test("one gated answer per line, reported after the run event, in the report file and the ask count", async () => {
    const r = await sweep("12: Score removed in beta.2\n40: a Score ask picks\n\n77: Score\n", [
      { yes: 0.95, no: 0.05 },
      { yes: 0.1, no: 0.9 },
      "unsure",
    ]);
    expect(r.code).toBe(0);
    expect(r.events.map((e) => e.event)).toEqual(["run_start", "run", "sweep_item", "sweep_item", "sweep_item", "sweep", "outcome"]);
    expect(of(r.events, "sweep_item").map((e) => [e.item, e.answer])).toEqual([
      ["12: Score removed in beta.2", "yes"],
      ["40: a Score ask picks", "no"],
      ["77: Score", "unsure"],
    ]);
    const item = of(r.events, "sweep_item")[0] as SkopeEvent;
    expect(item).toMatchObject({ section: "Main", question: "Is `line` a revision-history entry?", sure: 80, confidence: 0.95 });
    // The item is run output: named in backticks, sent as context.
    const request = JSON.parse(readFileSync(item.request_path as string, "utf8"));
    expect(request).toMatchObject({ kind: "yesno", context: { line: "12: Score removed in beta.2" } });
    const summary = of(r.events, "sweep")[0] as SkopeEvent;
    expect(summary).toMatchObject({ yes: 1, no: 1, unsure: 1, skipped: 0, stopped: null });
    expect(JSON.parse(readFileSync(summary.path as string, "utf8"))).toMatchObject({ yes: 1, no: 1, unsure: 1, items: [{}, {}, {}] });
    expect(r.events.at(-1)).toMatchObject({ outcome: "stopped", ask_calls: 3 });
    expect(r.stderr).toContain("ask each on line 15: 1 yes, 1 no, 1 unsure");
  });

  test("below sure is unsure, whichever option is on top", async () => {
    const r = await sweep("a\n", { yes: 0.7, no: 0.3 });
    expect(of(r.events, "sweep_item")[0]).toMatchObject({ answer: "unsure" });
  });

  test("at most 200 lines are asked about; the rest are counted as skipped", async () => {
    const lines = Array.from({ length: 250 }, (_, i) => `line ${i}`).join("\n");
    const r = await sweep(`${lines}\n`, { yes: 0.9, no: 0.1 });
    expect(of(r.events, "sweep_item")).toHaveLength(200);
    expect(of(r.events, "sweep")[0]).toMatchObject({ yes: 200, skipped: 50, stopped: null });
  });

  test("a failed backend stops the sweep, and the run goes on", async () => {
    const r = await sweep("a\nb\nc\n", [{ yes: 0.9, no: 0.1 }, "unavailable"]);
    expect(r.code).toBe(0);
    expect(of(r.events, "sweep_item").map((e) => e.answer)).toEqual(["yes", null]);
    expect(of(r.events, "sweep")[0]).toMatchObject({ yes: 1, skipped: 2, stopped: "ask_unavailable" });
  });

  test("an invalid answer counts as the backend being unavailable", async () => {
    const r = await sweep("a\n", { yes: 0.9 });
    expect(of(r.events, "sweep_item")[0]).toMatchObject({ answer: null, detail: "unavailable" });
    expect(of(r.events, "sweep")[0]).toMatchObject({ stopped: "ask_unavailable" });
  });

  test("a failing command hands off as a run does, and asks nothing", async () => {
    const r = await sweep({ exit: 2 }, { yes: 0.9, no: 0.1 });
    expect(r.code).toBe(20);
    expect(of(r.events, "sweep_item")).toHaveLength(0);
    expect(r.events.at(-1)).toMatchObject({ outcome: "handoff", reason: "command_failed" });
  });

  test("past the deadline no item is asked, and the run's next request hands off with deadline", async () => {
    const d = dir();
    const r = await runSkope([
      skill(d, `${SWEEP}\n- **run** \`true\`\n- **stop**`, "params:\n  word: Score\nlimits:\n  deadline: 1s\n"),
      "--apply",
      "--fake-exec",
      yaml(d, "c.yaml", { [GREP]: { exit: 0, stdout: "a\nb\n", ms: 5000 } }),
      "--fake",
      yaml(d, "a.yaml", { "Main.ask": { yes: 0.9, no: 0.1 } }),
    ]);
    expect(of(r.events, "sweep")[0]).toMatchObject({ yes: 0, skipped: 2, stopped: "deadline" });
    expect(r.events.at(-1)).toMatchObject({ outcome: "handoff", reason: "deadline" });
    // The handoff record lists the sweep.
    const record = of(r.events, "handoff_record")[0]?.record as Record<string, unknown>;
    expect(record.sweeps).toEqual([expect.objectContaining({ stopped: "deadline", skipped: 2 })]);
  });

  test("a dry run sweeps too: it only asks", async () => {
    const r = await sweep("a\n", { yes: 0.9, no: 0.1 }, ["--dry-run"]);
    expect(r.code).toBe(0);
    expect(of(r.events, "sweep")[0]).toMatchObject({ yes: 1 });
  });

  test("an answer list shorter than the items is E-FAKE-UNMATCHED", async () => {
    const r = await sweep("a\nb\n", [{ yes: 0.9, no: 0.1 }]);
    expect(r.code).toBe(50);
    expect(of(r.events, "error")[0]).toMatchObject({ code: "E-FAKE-UNMATCHED" });
  });
});

describe("tests.yaml sweeps", () => {
  test("counts pass when they match and fail with the difference when they don't", async () => {
    const d = dir();
    const path = skill(d, `${SWEEP}\n- **stop**`);
    writeFileSync(
      join(d, "tests.yaml"),
      JSON.stringify({
        defaults: { commands: { [GREP]: "a\nb\n" } },
        scenarios: {
          right: {
            answers: { "Main.ask": [{ yes: 0.9, no: 0.1 }, "unsure"] },
            outcome: "stopped",
            sweeps: { Main: { yes: 1, unsure: 1 } },
          },
          wrong: { answers: { "Main.ask": { yes: 0.9, no: 0.1 } }, outcome: "stopped", sweeps: { Main: { no: 2 } } },
        },
      }),
    );
    const r = await runSkope([path, "--test"]);
    expect(r.stderr).toContain("PASS    right");
    expect(r.stderr).toContain("FAIL    wrong: sweeps.Main.no: expected 2, got 0");
  });
});
