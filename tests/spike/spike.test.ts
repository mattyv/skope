// Phase 0 spike (PLAN.md §3): one tiny program through lint, execution and
// a fake handler, and evidence that dry run suppresses its effect.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { lint, Run, type Section, Unsupported } from "../../src/core.js";
import { FakeUnmatched, fakeExec } from "../../src/fake.js";
import { run } from "../../src/host.js";

const program: Section = JSON.parse(readFileSync(new URL("../../contracts/examples/spike-program.json", import.meta.url), "utf8"));
const DF = "df --output=pcent / | tail -1";
const VACUUM = "journalctl --vacuum-size=500M";
// Some tests build deliberately malformed sections, so the body is cast.
const section = (body: unknown[], src = 10): Section => ({ name: "Main", src, guidance: null, body: body as Section["body"] });
const runStmt = (src: number, cmd: string) => ({ src, run: { cmd: [{ lit: cmd }] }, else: null });
const doStmt = (src: number, cmd: string) => ({ src, do: { cmd: [{ lit: cmd }] }, else: null });
const stop = (src: number) => ({ src, stop: {} });

describe("lint (SPEC §4.1)", () => {
  test("the example program is clean", () => {
    expect(lint(program)).toEqual([]);
  });

  test("E-FALLS-OFF when the last instruction isn't a stop", () => {
    expect(lint(section([runStmt(7, "true")]))).toEqual([{ code: "E-FALLS-OFF", src: 7 }]);
  });

  test("E-FALLS-OFF for an empty section is reported at its heading", () => {
    expect(lint(section([], 12))).toEqual([{ code: "E-FALLS-OFF", src: 12 }]);
  });

  test("E-UNREACHABLE for an instruction after a stop", () => {
    expect(lint(section([stop(1), stop(2)]))).toEqual([{ code: "E-UNREACHABLE", src: 2 }]);
  });
});

describe("execution with the fake handler", () => {
  test("runs each command in order and stops, with SPEC §10 event names", async () => {
    const exec = fakeExec({ [DF]: { exit: 0 }, [VACUUM]: { exit: 0 } });
    const { events, outcome } = await run(program, { dry: false }, exec);
    expect(exec.calls).toEqual([DF, VACUUM]);
    expect(events).toEqual([
      { event: "run", src: 3, cmd: DF, exit: 0, after_would_do: false },
      { event: "effect_start", src: 4, cmd: VACUUM },
      { event: "effect_end", src: 4, cmd: VACUUM, exit: 0 },
      { event: "outcome", outcome: "stopped" },
    ]);
    expect(outcome).toEqual({ outcome: "stopped" });
  });

  test("a failing command hands off and nothing after it runs (SPEC §4.3)", async () => {
    const exec = fakeExec({ [DF]: { exit: 1 } });
    const { events, outcome } = await run(program, { dry: false }, exec);
    expect(exec.calls).toEqual([DF]);
    expect(events).toEqual([
      { event: "run", src: 3, cmd: DF, exit: 1, after_would_do: false },
      { event: "outcome", outcome: "handoff", reason: "command_failed" },
    ]);
    expect(outcome).toEqual({ outcome: "handoff", reason: "command_failed" });
  });

  test("an unmatched command is E-FAKE-UNMATCHED", async () => {
    await expect(run(program, { dry: false }, fakeExec({}))).rejects.toBeInstanceOf(FakeUnmatched);
  });

  test("a command named after an inherited property is still unmatched", async () => {
    const p = section([runStmt(3, "toString"), stop(4)]);
    await expect(run(p, { dry: false }, fakeExec({}))).rejects.toBeInstanceOf(FakeUnmatched);
  });
});

describe("the adapter refuses what it can't represent exactly", () => {
  const refuse: [string, Section][] = [
    [
      "a variable part, which would otherwise drop out of the command",
      section([{ src: 3, do: { cmd: [{ lit: "rm -rf /" }, { var: "dir" }] }, else: null }, stop(4)]),
    ],
    ["an unsupported statement, which would otherwise become a stop", section([{ src: 3, check: {} }, stop(4)])],
    ["an else", section([{ src: 3, run: { cmd: [{ lit: "x" }] }, else: { skip: {} } }, stop(4)])],
    ["a run binding", section([{ src: 3, run: { cmd: [{ lit: "x" }], as: "x" }, else: null }, stop(4)])],
    ["a negative src", section([stop(-1)])],
    ["a fractional src", section([stop(1.5)])],
  ];
  for (const [what, p] of refuse) {
    test(what, () => {
      expect(() => lint(p)).toThrow(Unsupported);
    });
  }

  test("a lone surrogate in a command", () => {
    expect(() => lint(section([runStmt(3, "echo \ud800x"), stop(4)]))).toThrow(Unsupported);
  });

  test("a null run body, and a stop with fields", () => {
    expect(() => lint(section([{ src: 3, run: null, else: null }, stop(4)]))).toThrow(Unsupported);
    expect(() => lint(section([{ src: 3, stop: { x: 1 } }]))).toThrow(Unsupported);
  });

  test("a dry-run flag that isn't a boolean, which would otherwise run the effect", () => {
    expect(() => new Run(program, { dry: undefined as unknown as boolean })).toThrow(Unsupported);
    expect(() => new Run(program, { dry: "yes" as unknown as boolean })).toThrow(Unsupported);
  });

  test("a program that fails lint can't be started", () => {
    expect(() => new Run(section([]), { dry: false })).toThrow(/E-FALLS-OFF/);
  });

  test("a fractional exit code", () => {
    const r = new Run(program, { dry: false });
    r.step(null);
    expect(() => r.step({ exit: 1.5 })).toThrow(Unsupported);
  });

  test("a step that skips the command's result, or sends one nobody asked for", () => {
    const r = new Run(program, { dry: false });
    expect(() => r.step({ exit: 0 })).toThrow(/nothing asked for/);
    r.step(null);
    expect(() => r.step(null)).toThrow(/needs the command's result/);
  });

  test("a step after the run is done", () => {
    const r = new Run(section([stop(1)]), { dry: false });
    expect(r.step(null).next).toEqual({ done: { outcome: "stopped" } });
    expect(() => r.step(null)).toThrow(/after the run is done/);
  });
});

describe("dry run suppresses effects (SPEC §4.5, P3)", () => {
  test("the do never reaches the handler; would_do is emitted and later reads are marked", async () => {
    const p = section([runStmt(3, DF), doStmt(4, VACUUM), runStmt(5, DF), stop(6)]);
    const exec = fakeExec({ [DF]: { exit: 0 } });
    const { events, outcome } = await run(p, { dry: true }, exec);
    expect(exec.calls).toEqual([DF, DF]);
    expect(events).toEqual([
      { event: "run", src: 3, cmd: DF, exit: 0, after_would_do: false },
      { event: "would_do", src: 4, cmd: VACUUM },
      { event: "run", src: 5, cmd: DF, exit: 0, after_would_do: true },
      { event: "outcome", outcome: "stopped" },
    ]);
    expect(outcome).toEqual({ outcome: "stopped" });
  });

  test("every read after a would_do is marked, not just the first", async () => {
    const p = section([doStmt(3, VACUUM), runStmt(4, DF), runStmt(5, DF), stop(6)]);
    const { events } = await run(p, { dry: true }, fakeExec({ [DF]: { exit: 0 } }));
    expect(events.filter((e) => e.event === "run").map((e) => (e as { after_would_do: boolean }).after_would_do)).toEqual([true, true]);
  });

  // DryRunNeverDoes proves this in Dafny. This checks the compiled code and
  // the adapter agree, over every run/do sequence up to six long.
  test("no program of up to six commands hands a do to the handler", async () => {
    let withDo = 0;
    for (let n = 1; n < 128; n++) {
      const bits = n.toString(2).slice(1); // length 0..6; each bit picks run or do
      const body = [...bits].map((b, i) => (b === "1" ? doStmt(i + 1, `do-${i}`) : runStmt(i + 1, `run-${i}`)));
      const dos = body.filter((s) => "do" in s).length;
      if (dos > 0) withDo++;
      const handed: string[] = [];
      const { events } = await run(section([...body, stop(bits.length + 1)]), { dry: true }, async (req) => {
        handed.push(`${req.kind}:${req.cmd}`);
        return { exit: 0 };
      });
      // Exactly the run commands, in order: a do can't get out under any label.
      expect(handed).toEqual(
        body.filter((s) => "run" in s).map((s) => `run:${(s as { run: { cmd: { lit: string }[] } }).run.cmd[0]?.lit}`),
      );
      expect(events.filter((e) => e.event === "would_do")).toHaveLength(dos);
    }
    expect(withDo).toBe(120); // every sequence except the seven all-run ones
  });
});
