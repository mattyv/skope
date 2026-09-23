// The fake command handler (SPEC §5.4, §6.2; contracts/fakes.schema.json):
// commands.yaml keyed by command text or `line:N`, ordered results with the
// last repeating, `ms` advancing a clock, E-FAKE-UNMATCHED for no match.

import { describe, expect, test } from "vitest";
import type { FakesCommands } from "../../src/contracts.gen.js";
import { createFakeClock, FakeUnmatchedCommand, fakeExec } from "../../src/runner/fakeExec.js";

describe("fakeExec (SPEC §5.4, contracts/fakes.schema.json)", () => {
  test("matches a command by its text after interpolation", async () => {
    const commands: FakesCommands = { "df -h /": { exit: 0, stdout: "91%\n" } };
    const handler = fakeExec(commands);
    const r = await handler({ cmd: "df -h /", src: 5 });
    expect(r).toEqual({ exit: 0, stdout: "91%\n", stderr: "", timedOut: false });
  });

  test("matches by line:N when the text isn't a key", async () => {
    const commands: FakesCommands = { "line:12": { exit: 1, stderr: "boom\n" } };
    const handler = fakeExec(commands);
    const r = await handler({ cmd: "anything", src: 12 });
    expect(r.exit).toBe(1);
    expect(r.stderr).toBe("boom\n");
  });

  test("line:N wins over a matching text key", async () => {
    const commands: FakesCommands = {
      "df -h /": { exit: 0, stdout: "by text\n" },
      "line:7": { exit: 0, stdout: "by line\n" },
    };
    const handler = fakeExec(commands);
    const r = await handler({ cmd: "df -h /", src: 7 });
    expect(r.stdout).toBe("by line\n");
  });

  test("an unmatched command throws FakeUnmatchedCommand with code E-FAKE-UNMATCHED", async () => {
    const handler = fakeExec({});
    await expect(handler({ cmd: "nope", src: 1 })).rejects.toThrow(FakeUnmatchedCommand);
    try {
      await handler({ cmd: "nope", src: 1 });
      expect.unreachable();
    } catch (e) {
      expect((e as FakeUnmatchedCommand).code).toBe("E-FAKE-UNMATCHED");
    }
  });

  test("a list of results is used in order, with the last repeating", async () => {
    const commands: FakesCommands = {
      "du -sh": [
        { exit: 0, stdout: "95%\n" },
        { exit: 0, stdout: "70%\n" },
        { exit: 0, stdout: "40%\n" },
      ],
    };
    const handler = fakeExec(commands);
    const seen = [];
    for (let i = 0; i < 5; i++) seen.push((await handler({ cmd: "du -sh", src: 1 })).stdout);
    expect(seen).toEqual(["95%\n", "70%\n", "40%\n", "40%\n", "40%\n"]);
  });

  test("each key tracks its own call sequence independently", async () => {
    const commands: FakesCommands = {
      a: [
        { exit: 0, stdout: "a1\n" },
        { exit: 0, stdout: "a2\n" },
      ],
      b: { exit: 0, stdout: "b\n" },
    };
    const handler = fakeExec(commands);
    expect((await handler({ cmd: "a", src: 1 })).stdout).toBe("a1\n");
    expect((await handler({ cmd: "b", src: 2 })).stdout).toBe("b\n");
    expect((await handler({ cmd: "a", src: 1 })).stdout).toBe("a2\n");
  });

  test("timed_out is carried through, with exit null", async () => {
    const commands: FakesCommands = { slow: { exit: null, timed_out: true } };
    const handler = fakeExec(commands);
    const r = await handler({ cmd: "slow", src: 1 });
    expect(r.exit).toBeNull();
    expect(r.timedOut).toBe(true);
  });

  test("ms advances the given clock, so deadline scenarios can be written", async () => {
    const clock = createFakeClock();
    const commands: FakesCommands = { slow: { exit: 0, ms: 4000 } };
    const handler = fakeExec(commands, clock);
    expect(clock.elapsedMs).toBe(0);
    await handler({ cmd: "slow", src: 1 });
    expect(clock.elapsedMs).toBe(4000);
    await handler({ cmd: "slow", src: 1 });
    expect(clock.elapsedMs).toBe(8000);
  });

  test("no real command ever runs under --fake-exec", async () => {
    const commands: FakesCommands = { "rm -rf /tmp/should-not-run": { exit: 0 } };
    const handler = fakeExec(commands);
    // If this ever shelled out, it would try to remove a path; instead it
    // must just return the table's answer with no process spawned.
    const r = await handler({ cmd: "rm -rf /tmp/should-not-run", src: 1 });
    expect(r.exit).toBe(0);
  });
});
