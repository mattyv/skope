// The explore handler (SPEC §5.4) and trace replay (SPEC §12.4) against toy
// cores: every branch taken, memoised, maxima as longest paths.

import { describe, expect, test } from "vitest";
import { askMs, branches, type Explorable, explore, signature, traceFits, traceOf } from "../../src/host/explore.js";
import type { AskRequest, CoreEvent, Next, Response } from "../../src/step.js";

const costs = { graceMs: 5000, askMs: 100, pagerMs: 10 };
const at = (line: number) => ({ section: "Main", line });
const request = {
  kind: "choice",
  question: "q?",
  guidance: null,
  options: [
    { id: "s:a", label: "A", description: null },
    { id: "s:b", label: "B", description: null },
  ],
  context: {},
  timeout_ms: 1,
} as AskRequest;

type Out = { events: CoreEvent[]; next: Next };
const outcome = (line: number, o: "stopped" | "paged" | "handoff", reason: string | null = null): CoreEvent =>
  ({ at: at(line), event: "outcome", outcome: o, reason, ask_calls: 0, effects: 0, dry_run: false }) as CoreEvent;
const done = (o: "stopped" | "paged" | "handoff", reason: string | null = null): Next =>
  ({ kind: "done", outcome: o === "handoff" ? { kind: o, reason, detail: null } : { kind: o } }) as Next;

/** A core as a pure function of (pc, response): run → ask → stop or page, failures hand off. */
function toy(start = 0): Explorable {
  let pc = start;
  const step = (r: Response): Out => {
    if (pc === 0) {
      pc = 1;
      return {
        events: [{ at: at(1), event: "effect_start", cmd: "x" }],
        next: { kind: "exec", cmd: "x", exec: "do", timeoutMs: 1000, src: 1 },
      };
    }
    if (pc === 1 && r.kind === "exec") {
      const end: CoreEvent = { at: at(1), event: "effect_end", cmd: "x", exit: r.exit, timed_out: r.timedOut };
      if (r.exit !== 0) return { events: [end, outcome(1, "handoff", "command_failed")], next: done("handoff", "command_failed") };
      pc = 2;
      return { events: [end], next: { kind: "ask", request, src: 2 } };
    }
    if (pc === 2) {
      const base = { at: at(2), event: "ask", question: "q?", kind: "choice", sure: 80, after_would_do: false } as const;
      if (r.kind === "ask_failed") {
        const e = { ...base, probs: null, chosen: null, confidence: null, passed: false, detail: "unavailable" } as CoreEvent;
        return { events: [e, outcome(2, "handoff", "ask_unavailable")], next: done("handoff", "ask_unavailable") };
      }
      if (r.kind !== "answer") throw new Error("bad response");
      const top = Object.entries(r.probs).sort((x, y) => y[1] - x[1])[0] as [string, number];
      const passed = top[1] >= 0.8;
      const e = { ...base, probs: r.probs, chosen: top[0], confidence: top[1], passed } as CoreEvent;
      if (!passed) return { events: [e, outcome(2, "handoff", "gate_failed")], next: done("handoff", "gate_failed") };
      if (top[0] === "s:a") return { events: [e, outcome(2, "stopped")], next: done("stopped") };
      pc = 3;
      return { events: [e, { at: at(2), event: "transfer", from: "Main", to: "Page" }], next: { kind: "page", text: "hi", src: 5 } };
    }
    return {
      events: [{ at: { section: "Page", line: 5 }, event: "page", text: "hi", ok: true }, outcome(5, "paged")],
      next: done("paged"),
    };
  };
  return { step, fork: () => toy(pc), key: () => String(pc) };
}

describe("explore", () => {
  test("takes every branch: exec ok/fail/timeout, each option, unsure, unavailable (SPEC §5.4)", () => {
    const s = explore(toy(), costs);
    // exec fail and timeout (2) + ask A, B, unsure, unavailable (4).
    expect(s.paths).toBe(6n);
    expect([...s.outcomes].sort()).toEqual([
      "handoff:ask_unavailable",
      "handoff:command_failed",
      "handoff:gate_failed",
      "paged",
      "stopped",
    ]);
    expect(s.maxAsks).toBe(1);
    expect(s.maxEffects).toBe(1);
    expect(s.maxMs).toBe(1000 + 5000 + 100 + 10);
    expect([...s.sections].sort()).toEqual(["Main", "Page"]);
    expect([...s.transfers]).toEqual(["Main → Page"]);
  });

  test("memoises on the abstract state: 3^30 paths explored in 30 visits", () => {
    let steps = 0;
    const chain = (pc: number): Explorable => ({
      key: () => String(pc),
      fork: () => chain(pc),
      step() {
        steps++;
        pc++;
        return pc > 30
          ? { events: [outcome(pc, "stopped")], next: done("stopped") }
          : {
              events: [{ at: at(pc), event: "effect_start", cmd: "x" }],
              next: { kind: "exec", cmd: "x", exec: "do", timeoutMs: 1, src: pc },
            };
      },
    });
    const s = explore(chain(0), costs);
    expect(s.paths).toBe(3n ** 30n);
    expect(s.maxEffects).toBe(30);
    expect(steps).toBeLessThan(100);
  });

  test("an ask gets one confident branch per option, one unsure (a tie) and one unavailable", () => {
    const b = branches({ kind: "ask", request, src: 2 }, costs).map((x) => x.response);
    expect(b).toEqual([
      expect.objectContaining({ kind: "answer", probs: { "s:a": 1, "s:b": 0 } }),
      expect.objectContaining({ kind: "answer", probs: { "s:a": 0, "s:b": 1 } }),
      expect.objectContaining({ kind: "answer", probs: { "s:a": 0.5, "s:b": 0.5 } }),
      expect.objectContaining({ kind: "ask_failed", error: "unavailable" }),
    ]);
    expect(branches({ kind: "choose", n: 3 }, costs).map((x) => x.response)).toEqual([0, 1, 2].map((i) => ({ kind: "picked", i })));
  });

  test("worst-case ask time counts every attempt and each retry's longest wait (SPEC §5.6, §6.2)", () => {
    expect(askMs(2000, 0)).toBe(2000);
    expect(askMs(2000, 1)).toBe(4000 + 2000);
    expect(askMs(100, 3)).toBe(400 + 500 + 1000 + 2000);
  });
});

describe("trace replay (SPEC §12.4)", () => {
  // A concrete run's events.jsonl for: do ok, ask chose B, page.
  const run = [
    { event: "run_start" },
    { event: "effect_start", section: "Main", line: 1, cmd: "x" },
    { event: "effect_end", section: "Main", line: 1, cmd: "x", exit: 0, timed_out: false, ms: 3 },
    { event: "ask", section: "Main", line: 2, chosen: "s:b", passed: true, probs: { "s:a": 0.1, "s:b": 0.9 } },
    { event: "transfer", section: "Main", line: 2, from: "Main", to: "Page" },
    { event: "page", section: "Page", line: 5, text: "hi", ok: true },
    { event: "outcome", outcome: "paged", reason: null },
  ];

  test("a real run's path is one the explorer can take", () => {
    expect(traceFits(toy(), traceOf(run), costs)).toBe(true);
  });

  test("a failed gate matches the unsure branch, whichever option led", () => {
    const gate = [
      ...run.slice(0, 3),
      { event: "ask", section: "Main", line: 2, chosen: "s:b", passed: false },
      { event: "outcome", outcome: "handoff", reason: "gate_failed" },
    ];
    expect(traceFits(toy(), traceOf(gate), costs)).toBe(true);
  });

  test("a truncated, reordered or altered trace isn't", () => {
    expect(traceFits(toy(), traceOf(run.slice(0, -1)), costs)).toBe(false);
    expect(traceFits(toy(), traceOf([...run, run[1]] as Record<string, unknown>[]), costs)).toBe(false);
    const altered = run.map((e) => (e.event === "ask" ? { ...e, chosen: "s:a" } : e));
    expect(traceFits(toy(), traceOf(altered), costs)).toBe(false);
    const deadline = [...run.slice(0, 3), { event: "outcome", outcome: "handoff", reason: "deadline" }];
    expect(traceFits(toy(), traceOf(deadline), costs)).toBe(false);
  });

  test("signatures keep where and how, not values the explorer doesn't know", () => {
    expect(signature({ event: "run", section: "T", line: 3, exit: 0, timed_out: false, stdout_tail: "91%" })).toBe("run T:3 ok");
    expect(signature({ event: "run", section: "T", line: 3, exit: 2, timed_out: false })).toBe("run T:3 fail");
    expect(signature({ event: "check_cmd", section: "T", line: 3, exit: null, timed_out: true })).toBe("check_cmd T:3 timeout");
    expect(signature({ event: "check", section: "T", line: 4, result: null })).toBe("check T:4 null");
    expect(signature({ event: "ask", section: "T", line: 5, passed: false, detail: "unavailable" })).toBe("ask T:5 unavailable");
  });
});
