// Phase 0 spike (PLAN.md §3): one tiny program through lint, execution and
// a fake handler, and proof that dry run suppresses its effect.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { lint, type Program, type Stmt } from "../../src/core.js";
import { fakeExec, FakeUnmatched } from "../../src/fake.js";
import { run } from "../../src/host.js";

const program: Program = JSON.parse(readFileSync(new URL("../../contracts/examples/spike-program.json", import.meta.url), "utf8"));
const DF = "df --output=pcent / | tail -1";
const VACUUM = "journalctl --vacuum-size=500M";

describe("lint (SPEC §4.1)", () => {
  test("the example program is clean", () => {
    expect(lint(program)).toEqual([]);
  });

  test("E-FALLS-OFF when the last instruction isn't a stop", () => {
    expect(lint({ body: [{ src: 7, run: { cmd: [{ lit: "true" }] } }] })).toEqual([{ code: "E-FALLS-OFF", src: 7 }]);
  });

  test("E-FALLS-OFF for an empty section", () => {
    expect(lint({ body: [] })).toEqual([{ code: "E-FALLS-OFF", src: 0 }]);
  });

  test("E-UNREACHABLE for an instruction after a stop", () => {
    expect(lint({ body: [{ src: 1, stop: {} }, { src: 2, stop: {} }] })).toEqual([{ code: "E-UNREACHABLE", src: 2 }]);
  });
});

describe("execution with the fake handler", () => {
  test("runs each command in order and stops", async () => {
    const exec = fakeExec({ [DF]: { exit: 0 }, [VACUUM]: { exit: 0 } });
    const { events, outcome } = await run(program, { dry: false }, exec);
    expect(exec.calls).toEqual([DF, VACUUM]);
    expect(events).toEqual([
      { event: "ran", src: 3, kind: "run", cmd: DF, exit: 0 },
      { event: "effect_start", src: 4, cmd: VACUUM },
      { event: "ran", src: 4, kind: "do", cmd: VACUUM, exit: 0 },
      { event: "outcome", outcome: "stopped" },
    ]);
    expect(outcome).toEqual({ outcome: "stopped" });
  });

  test("a failing command hands off (SPEC §4.3)", async () => {
    const exec = fakeExec({ [DF]: { exit: 1 } });
    const { outcome } = await run(program, { dry: false }, exec);
    expect(outcome).toEqual({ outcome: "handoff", reason: "command_failed" });
    expect(exec.calls).toEqual([DF]);
  });

  test("an unmatched command is E-FAKE-UNMATCHED, never a real run", async () => {
    await expect(run(program, { dry: false }, fakeExec({}))).rejects.toBeInstanceOf(FakeUnmatched);
  });

  test("a program that fails lint can't be started", async () => {
    await expect(run({ body: [] }, { dry: false }, fakeExec({}))).rejects.toThrow(/E-FALLS-OFF/);
  });
});

describe("dry run suppresses effects (SPEC §4.5, P3)", () => {
  test("the do never reaches the handler; would_do is emitted instead", async () => {
    const exec = fakeExec({ [DF]: { exit: 0 } });
    const { events, outcome } = await run(program, { dry: true }, exec);
    expect(exec.calls).toEqual([DF]);
    expect(events).toEqual([
      { event: "ran", src: 3, kind: "run", cmd: DF, exit: 0 },
      { event: "would_do", src: 4, cmd: VACUUM },
      { event: "outcome", outcome: "stopped" },
    ]);
    expect(outcome).toEqual({ outcome: "stopped" });
  });

  // P3 is proven in Dafny; this checks the compiled code and the adapter
  // agree with it, over many random programs.
  test("no random program ever hands a do to the handler in dry run", async () => {
    let seed = 42;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    for (let i = 0; i < 300; i++) {
      const body: Stmt[] = Array.from({ length: rand(8) }, (_, j): Stmt =>
        rand(2) === 0 ? { src: j, run: { cmd: [{ lit: `run-${j}` }] } } : { src: j, do: { cmd: [{ lit: `do-${j}` }] } },
      );
      body.push({ src: body.length, stop: {} });
      const kinds: string[] = [];
      await run({ body }, { dry: true }, async (req) => {
        kinds.push(req.kind);
        return { exit: 0 };
      });
      expect(kinds).not.toContain("do");
    }
  });
});
