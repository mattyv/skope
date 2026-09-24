// Answer validation and the gate (SPEC §6.1, §4.2, §12.2), question text
// by origin (SPEC §3.5, §6.3), and the rules the adapter enforces.

import { describe, expect, test } from "vitest";
import { Unsupported } from "../../src/core.js";
import { Interp, unsafeInputs } from "../../src/interp.js";
import type { Response } from "../../src/step.js";
import {
  actions,
  answer,
  askOneOf,
  askSections,
  askYesNo,
  bodies,
  cmd,
  config,
  doCmd,
  drive,
  forEach,
  handOff,
  last,
  lit,
  nexts,
  ok,
  page,
  program,
  run,
  section,
  skip,
  stop,
  to,
  v,
  values,
} from "./helpers.js";

const handoff = (reason: string, detail: string | null = null) => ({ kind: "done", outcome: { kind: "handoff", reason, detail } });

// Triage runs one command, then asks between two sections.
const triage = (sure: number, els: unknown = null) =>
  program({
    "s:triage": section(
      "Triage",
      [run(2, cmd("journalctl"), "errors"), askSections(3, [lit("Given "), v("errors"), lit(", what next?")], sure, ["s:a", "s:b"], els)],
      "Look at the errors.",
    ),
    "s:a": section("A", [stop(10)], "Clean up."),
    "s:b": section("B", [handOff(11)]),
    "s:c": section("C", [page(12, [lit("unsure")])]),
  });
const gate = (r: Response, sure = 85, els: unknown = null) => drive(triage(sure, els), config(), [ok("disk errors"), r]).turns;

describe("the ask request (SPEC §6.1)", () => {
  test("section options: id, display name and guidance; the asking section's guidance; run output as context", () => {
    const ask = last(drive(triage(85), config(), [ok("disk errors")]).turns);
    expect(ask).toEqual({
      kind: "ask",
      src: 3,
      request: {
        kind: "choice",
        question: "Given `errors`, what next?",
        guidance: "Look at the errors.",
        options: [
          { id: "s:a", label: "A", description: "Clean up." },
          { id: "s:b", label: "B", description: null },
        ],
        context: { errors: "disk errors" },
        timeout_ms: 0,
      },
    });
  });
});

describe("a valid, confident answer passes the gate", () => {
  test("chosen = the highest probability; confidence = that probability; transfer to it", () => {
    const turns = gate(answer({ "s:a": 0.9, "s:b": 0.1 }));
    expect(bodies(turns).slice(1, 3)).toEqual([
      {
        event: "ask",
        question: "Given `errors`, what next?",
        kind: "choice",
        probs: { "s:a": 0.9, "s:b": 0.1 },
        chosen: "s:a",
        confidence: 0.9,
        sure: 85,
        passed: true,
        after_would_do: false,
      },
      { event: "transfer", from: "Triage", to: "A" },
    ]);
    expect(last(turns)).toEqual({ kind: "done", outcome: { kind: "stopped" } });
  });

  test("the transfer goes to the chosen option, not the first", () => {
    const turns = gate(answer({ "s:a": 0.05, "s:b": 0.95 }));
    expect(bodies(turns)[2]).toEqual({ event: "transfer", from: "Triage", to: "B" });
    expect(last(turns)).toEqual(handoff("explicit"));
  });

  test("probabilities are normalised: 0.8995 of 0.999 clears 90%", () => {
    const turns = gate(answer({ "s:a": 0.8995, "s:b": 0.0995 }), 90);
    expect(bodies(turns)[1]).toMatchObject({ passed: true, confidence: 0.8995 / 0.999 });
  });

  test("confidence exactly at `sure` passes: 0.85 at 85%", () => {
    expect(bodies(gate(answer({ "s:a": 0.85, "s:b": 0.15 })))[1]).toMatchObject({ passed: true, confidence: 0.85 });
  });

  test("a sum within 1e-3 of 1 is valid", () => {
    expect(bodies(gate(answer({ "s:a": 0.9, "s:b": 0.1009 })))[1]).toMatchObject({ passed: true });
  });

  test("unassigned that can't change the winner doesn't fail it: A 0.51, B 0.2, unassigned 0.29 at 40%", () => {
    expect(bodies(gate(answer({ "s:a": 0.51, "s:b": 0.2 }, 0.29), 40))[1]).toMatchObject({ passed: true, confidence: 0.51 });
  });
});

describe("invalid responses are handled as the backend being unavailable: ask_unavailable (SPEC §6.1, §12.2)", () => {
  const cases: [string, Response][] = [
    ["a missing option", answer({ "s:a": 1 })],
    ["an extra option", answer({ "s:a": 0.5, "s:b": 0.4, "s:x": 0.1 })],
    ["a value of 1.1", answer({ "s:a": 1.1, "s:b": 0 })],
    ["a value just over 1, though the sum is within 1e-3", answer({ "s:a": 1.0005, "s:b": 0 })],
    ["a negative value, though the sum is within 1e-3", answer({ "s:a": 1, "s:b": -0.0005 })],
    ["NaN", answer({ "s:a": Number.NaN, "s:b": 0.1 })],
    ["values summing to 0.9", answer({ "s:a": 0.5, "s:b": 0.4 })],
    ["values summing to 0.995", answer({ "s:a": 0.9, "s:b": 0.095 })],
    ["values summing to 1.0015 (the tolerance is 1e-3)", answer({ "s:a": 0.9, "s:b": 0.1015 })],
    ["an infinite unassigned", answer({ "s:a": 0.9, "s:b": 0.1 }, Number.POSITIVE_INFINITY)],
    ["a NaN unassigned", answer({ "s:a": 0.9, "s:b": 0.1 }, Number.NaN)],
    ["a negative unassigned", answer({ "s:a": 0.6, "s:b": 0.5 }, -0.1)],
  ];
  for (const [name, r] of cases) {
    test(name, () => {
      const turns = gate(r, 85, to("s:c"));
      expect(bodies(turns)[1]).toMatchObject({
        event: "ask",
        probs: null,
        chosen: null,
        confidence: null,
        passed: false,
        detail: "unavailable",
      });
      // Even with an else: unavailable hands off, unlike unsure (SPEC §5.4).
      expect(last(turns)).toEqual(handoff("ask_unavailable", "unavailable"));
    });
  }

  test("a backend failure: ask_unavailable, with request_too_large as the detail when that's why", () => {
    expect(last(gate({ kind: "ask_failed", error: "unavailable", backend: "jev" }))).toEqual(handoff("ask_unavailable", "unavailable"));
    const turns = gate({ kind: "ask_failed", error: "request_too_large", backend: "jev" });
    expect(bodies(turns)[1]).toMatchObject({ event: "ask", probs: null, detail: "request_too_large" });
    expect(last(turns)).toEqual(handoff("ask_unavailable", "request_too_large"));
  });
});

describe("the gate fails: gate_failed (SPEC §4.2)", () => {
  test("below `sure`", () => {
    const turns = gate(answer({ "s:a": 0.8, "s:b": 0.2 }));
    expect(bodies(turns)[1]).toMatchObject({ event: "ask", chosen: "s:a", confidence: 0.8, passed: false });
    expect(last(turns)).toEqual(handoff("gate_failed"));
  });

  test("just below `sure`: 0.8499 at 85%", () => {
    expect(last(gate(answer({ "s:a": 0.8499, "s:b": 0.1501 })))).toEqual(handoff("gate_failed"));
  });

  test("a tie for highest fails, whatever `sure` is", () => {
    expect(last(gate(answer({ "s:a": 0.5, "s:b": 0.5 }), 40))).toEqual(handoff("gate_failed"));
  });

  test("A 0.5, B 0.2, unassigned 0.3 at 40%: valid, A clears 40%, but B plus unassigned could tie A", () => {
    const turns = gate(answer({ "s:a": 0.5, "s:b": 0.2 }, 0.3), 40);
    expect(bodies(turns)[1]).toMatchObject({ event: "ask", chosen: "s:a", confidence: 0.5, passed: false });
    expect(last(turns)).toEqual(handoff("gate_failed"));
  });

  test("with `else [X]`, unsure transfers to X", () => {
    const turns = gate(answer({ "s:a": 0.6, "s:b": 0.4 }), 85, to("s:c"));
    expect(bodies(turns)[2]).toEqual({ event: "transfer", from: "Triage", to: "C" });
    expect(last(turns)).toEqual({ kind: "page", text: "unsure", src: 12 });
  });

  test("with `else skip` on a yes/no, it binds no and carries on", () => {
    const p = program({ "s:a": section("A", [askYesNo(2, [lit("Severe?")], 90, "severe", skip), page(3, [lit("severe="), v("severe")])]) });
    expect(last(drive(p, config(), [answer({ yes: 0.7, no: 0.3 })]).turns)).toEqual({ kind: "page", text: "severe=no", src: 3 });
  });
});

describe("question text by origin (SPEC §3.5, §6.3)", () => {
  const p = program(
    {
      "s:a": section("A", [
        run(2, cmd("tail log"), "log"),
        run(3, cmd("du"), "sizes", skip),
        forEach(4, "svc", "s:services", [
          askYesNo(
            5,
            [lit("Is "), v("svc"), lit(" on "), v("mount"), lit(" behind "), v("log"), lit(" and "), v("sizes"), lit("?")],
            90,
            "_yn",
            skip,
          ),
        ]),
        stop(6),
      ]),
      "s:services": values("Services", ["nginx"]),
    },
    { mount: "/var" },
  );

  test("trusted values are pasted in; run output is named in backticks and sent as context, (unavailable) when unbound", () => {
    const ask = last(
      drive(p, config({ mount: "/var" }), [ok("oom killer\n"), { kind: "exec", exit: 1, stdout: "", stderrTail: "", timedOut: false }])
        .turns,
    );
    expect(ask).toMatchObject({
      kind: "ask",
      request: { question: "Is nginx on /var behind `log` and `sizes`?", context: { log: "oom killer", sizes: "(unavailable)" } },
    });
  });

  test("a yes/no answer is a trusted value: pasted into a later question, not sent as context", () => {
    const q = program({
      "s:a": section("A", [
        askYesNo(2, [lit("Severe?")], 90, "severe"),
        askYesNo(3, [lit("Severe was "), v("severe"), lit(". Page?")], 90, "_yn", skip),
        stop(4),
      ]),
    });
    const ask = last(drive(q, config(), [answer({ yes: 0.99, no: 0.01 })]).turns);
    expect(ask).toMatchObject({ kind: "ask", request: { question: "Severe was yes. Page?", context: {} } });
  });

  test("the same name is pasted or named by where its current value came from", () => {
    const q = program(
      {
        "s:a": section("A", [
          askYesNo(2, [lit("Is "), v("x"), lit("?")], 90, "_yn", skip),
          run(3, cmd("echo"), "x"),
          askYesNo(4, [lit("Is "), v("x"), lit("?")], 90, "_yn", skip),
          stop(5),
        ]),
      },
      { x: "param" },
    );
    const { turns } = drive(q, config({ x: "param" }), [answer({ yes: 0.99, no: 0.01 }), ok("output")]);
    const asks = turns.map((t) => t.next).filter((n) => n.kind === "ask");
    expect(asks.map((n) => n.kind === "ask" && [n.request.question, n.request.context])).toEqual([
      ["Is param?", {}],
      ["Is `x`?", { x: "output" }],
    ]);
  });
});

describe("the adapter enforces Start's and Step's rules", () => {
  const p = program({ "s:a": section("A", [run(2, cmd("df")), stop(3)]) });

  test("the first step takes no response, then only an answer to the last request", () => {
    const i = new Interp(p, config());
    expect(() => i.step(ok())).toThrow(/doesn't answer the start/);
    i.step({ kind: "none" });
    expect(() => i.step({ kind: "page", ok: true })).toThrow(/doesn't answer a exec request/);
    expect(i.step(ok()).next).toEqual({ kind: "done", outcome: { kind: "stopped" } });
  });

  test("no step after the run is done (P2)", () => {
    const i = new Interp(p, config());
    i.step({ kind: "none" });
    i.step(ok());
    expect(() => i.step({ kind: "deadline" })).toThrow(/after the run is done/);
  });

  test("a picked answer must be in range", () => {
    const c = program({
      "s:a": section("A", [
        run(2, cmd("df"), "u"),
        { src: 3, check: { cond: { cmp: { op: "<", l: v("u"), r: { num: "1" } } }, then: { stop: {} }, else: null } },
        handOff(4),
      ]),
    });
    const i = new Interp(c, config({}, false, "explore"));
    i.step({ kind: "none" });
    expect(i.step(ok()).next).toEqual({ kind: "choose", n: 3 });
    expect(() => i.step({ kind: "picked", i: 3 })).toThrow(/out of range/);
  });

  test("dry must be a real boolean, so a missing flag can't run effects", () => {
    expect(() => new Interp(p, { ...config(), dry: undefined as unknown as boolean })).toThrow(Unsupported);
  });

  test("E-PARAM-UNSAFE: a param override that reaches a command must pass the safe-value check", () => {
    const q = program({ "s:a": section("A", [doCmd(2, [lit("df "), v("mount")]), page(3, [v("note")])]) }, { mount: "/", note: "x" });
    const cfg = config({ mount: "/; rm -rf /", note: "free text is fine here" });
    expect(unsafeInputs(q, cfg)).toEqual(["mount"]);
    expect(() => new Interp(q, cfg)).toThrow(/mount/);
    expect(() => new Interp(q, config({ mount: "/var", note: "free text is fine here" }))).not.toThrow();
  });

  test("fork() gives an independent run: each copy answers its own way", () => {
    const i = new Interp(triage(85), config());
    i.step({ kind: "none" });
    i.step(ok("disk errors"));
    const j = i.fork();
    expect(i.step(answer({ "s:a": 0.9, "s:b": 0.1 })).next).toEqual({ kind: "done", outcome: { kind: "stopped" } });
    expect(j.step(answer({ "s:a": 0.1, "s:b": 0.9 })).next).toEqual(handoff("explicit"));
    expect(() => i.step({ kind: "deadline" })).toThrow(/after the run is done/);
  });

  test("key() is the abstract state: equal for equal states, different when a value or the position differs", () => {
    const at = (stdout: string) => {
      const i = new Interp(triage(85), config());
      i.step({ kind: "none" });
      i.step(ok(stdout));
      return i;
    };
    const a = at("x");
    expect(a.key()).toBe(at("x").key());
    expect(a.key()).not.toBe(at("y").key());
    const b = a.fork();
    b.step(answer({ "s:a": 0.9, "s:b": 0.1 }));
    expect(b.key()).not.toBe(a.key());
  });

  test("key() tells apart two states that differ only in after_would_do", () => {
    // Two cleanups: answering yes then no leaves a would_do behind; no then no doesn't.
    const q = program({
      "s:a": section("A", [
        forEach(2, "step", "s:cleanups", [
          askYesNo(3, [lit("Run "), v("step"), lit("?")], 90, "_yn", skip),
          { src: 4, if_yes: { do: { item: "step" }, else: skip } },
        ]),
        run(5, cmd("df")),
        stop(6),
      ]),
      "s:cleanups": actions("Cleanups", [
        ["Clear the apt cache", "apt-get clean"],
        ["Vacuum the journal", "journalctl --vacuum-size=500M"],
      ]),
    });
    const yes = answer({ yes: 0.99, no: 0.01 });
    const no = answer({ yes: 0.01, no: 0.99 });
    const at = (a: Response) => {
      const i = new Interp(q, config({}, true));
      i.step({ kind: "none" });
      i.step(a);
      expect(i.step(no).next).toMatchObject({ kind: "exec", cmd: "df" });
      return i;
    };
    expect(at(yes).key()).not.toBe(at(no).key());
    expect(at(no).key()).toBe(at(no).key());
  });

  test("variables() holds what the run bound: loop items and one-of answers included", () => {
    const q = program({
      "s:a": section("A", [
        askOneOf(2, [lit("Which?")], 90, "s:services", "service"),
        forEach(3, "svc", "s:services", [page(4, [v("svc")])]),
      ]),
      "s:services": values("Services", ["nginx", "rsyslog"]),
    });
    const i = new Interp(q, config());
    i.step({ kind: "none" });
    expect(i.step(answer({ nginx: 0.05, rsyslog: 0.95 })).next).toMatchObject({ kind: "page", text: "nginx" });
    expect(i.variables()).toEqual({ service: "rsyslog", svc: "nginx" });
  });

  test("context values are passed exactly as the core has them, not trimmed further", () => {
    const ask = last(drive(triage(85), config(), [ok("disk errors\v")]).turns);
    expect(ask?.kind === "ask" && ask.request.context).toEqual({ errors: "disk errors\v" });
  });

  test("the program must lint clean (so it's WellFormed): E-CYCLE is refused", () => {
    const q = program({
      "s:a": section("A", [{ src: 2, then: { section: "s:b" } }]),
      "s:b": section("B", [{ src: 5, then: { section: "s:a" } }]),
    });
    expect(() => new Interp(q, config())).toThrow(/E-CYCLE/);
  });

  test("params must be exactly the program's", () => {
    expect(() => new Interp(p, config({ extra: "x" }))).toThrow(Unsupported);
  });

  test("a non-finite probability is an invalid answer: ask_unavailable", () => {
    const turns = gate(answer({ "s:a": Number.POSITIVE_INFINITY, "s:b": 0 }));
    expect(last(turns)).toEqual(handoff("ask_unavailable", "unavailable"));
    expect(nexts(turns).length).toBe(3);
  });
});
