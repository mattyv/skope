// Step-by-step traces through the proven interpreter (SPEC §4, §5.2),
// driven through src/interp.ts with scripted responses.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  actions,
  answer,
  askOneOf,
  askScore,
  askYesNo,
  bodies,
  checkCmd,
  cmd,
  cmp,
  config,
  doCmd,
  doItem,
  drive,
  events,
  fail,
  forEach,
  handOff,
  ifYesDo,
  ifYesRun,
  last,
  lit,
  nexts,
  ok,
  page,
  program,
  request,
  run,
  section,
  skip,
  stop,
  thenTo,
  timeout,
  to,
  v,
  values,
} from "./helpers.js";

const done = (outcome: unknown) => ({ kind: "done", outcome });
const handoff = (reason: string, detail: string | null = null) => done({ kind: "handoff", reason, detail });
const STOPPED = done({ kind: "stopped" });
const PAGED = done({ kind: "paged" });

describe("run (SPEC §4.2, §4.3)", () => {
  const prog = program({ "s:a": section("A", [run(2, [lit("df "), v("mount"), lit(" | tail -1")], "used"), stop(3)]) }, { mount: "/" });

  test("hands out the command with its params pasted in, binds trimmed stdout, and stops", () => {
    const { turns, interp } = drive(prog, config({ mount: "/var" }), [ok(" 91%\n")]);
    expect(nexts(turns)).toEqual([{ kind: "exec", cmd: "df /var | tail -1", exec: "run", timeoutMs: 30000, src: 2 }, STOPPED]);
    expect(events(turns)).toEqual([
      { at: { section: "A", line: 2 }, event: "run", cmd: "df /var | tail -1", exit: 0, timed_out: false, after_would_do: false },
      { at: { section: "A", line: 3 }, event: "outcome", outcome: "stopped", reason: null, ask_calls: 0, effects: 0, dry_run: false },
    ]);
    // The handoff record's variables: what the run bound, not params or built-ins (SPEC §8.1).
    expect(interp.variables()).toEqual({ used: "91%" });
  });

  test("a param the run rebinds counts as bound in variables()", () => {
    const p = program({ "s:a": section("A", [run(2, cmd("pwd"), "mount"), stop(3)]) }, { mount: "/" });
    expect(drive(p, config({ mount: "/" }), [ok("/srv")]).interp.variables()).toEqual({ mount: "/srv" });
  });

  test("a non-zero exit with no else hands off: command_failed", () => {
    expect(last(drive(prog, config({ mount: "/" }), [fail(2)]).turns)).toEqual(handoff("command_failed"));
  });

  test("a failing run without `as` and without an else hands off: command_failed", () => {
    const p = program({ "s:a": section("A", [run(2, cmd("df")), stop(3)]) });
    expect(last(drive(p, config(), [fail()]).turns)).toEqual(handoff("command_failed"));
  });

  test("a param wins a clash with a built-in name", () => {
    const p = program({ "s:a": section("A", [page(2, [v("host")])]) }, { host: "from-param" });
    expect(last(drive(p, config({ host: "from-param" }), []).turns)).toEqual({ kind: "page", text: "from-param", src: 2 });
  });

  test("a timeout is a failure: command_failed", () => {
    expect(last(drive(prog, config({ mount: "/" }), [timeout]).turns)).toEqual(handoff("command_failed"));
  });

  test("`else skip` carries on and leaves the name unbound", () => {
    const p = program({ "s:a": section("A", [run(2, cmd("du"), "big", skip), page(3, [lit("big="), v("big")])]) });
    const { turns, interp } = drive(p, config(), [fail()]);
    expect(last(turns)).toEqual({ kind: "page", text: "big=(unavailable)", src: 3 });
    expect(interp.variables()).not.toHaveProperty("big");
  });

  test("`else [X]` transfers, and a transfer never returns", () => {
    const p = program({ "s:a": section("A", [run(2, cmd("false"), undefined, to("s:b")), stop(3)]), "s:b": section("B", [handOff(5)]) });
    const { turns } = drive(p, config(), [fail()]);
    expect(bodies(turns).map((e) => e.event)).toEqual(["run", "transfer", "outcome"]);
    expect(bodies(turns)[1]).toEqual({ event: "transfer", from: "A", to: "B" });
    expect(last(turns)).toEqual(handoff("explicit"));
  });
});

describe("do (SPEC §4.2)", () => {
  const prog = program({ "s:a": section("A", [doCmd(2, cmd("systemctl restart nginx")), run(3, cmd("df")), stop(4)]) });

  test("logs effect_start before and effect_end after", () => {
    const { turns } = drive(prog, config(), [ok(), ok()]);
    expect(nexts(turns)[0]).toEqual({ kind: "exec", cmd: "systemctl restart nginx", exec: "do", timeoutMs: 600000, src: 2 });
    expect(bodies(turns)).toEqual([
      { event: "effect_start", cmd: "systemctl restart nginx" },
      { event: "effect_end", cmd: "systemctl restart nginx", exit: 0, timed_out: false },
      { event: "run", cmd: "df", exit: 0, timed_out: false, after_would_do: false },
      { event: "outcome", outcome: "stopped", reason: null, ask_calls: 0, effects: 1, dry_run: false },
    ]);
  });

  test("a do that times out goes to failure handling: command_failed", () => {
    const { turns } = drive(prog, config(), [timeout]);
    expect(bodies(turns)[1]).toEqual({ event: "effect_end", cmd: "systemctl restart nginx", exit: null, timed_out: true });
    expect(last(turns)).toEqual(handoff("command_failed"));
  });
});

describe("dry run (SPEC §4.5, P3)", () => {
  test("a do is never handed out: would_do, and later reads carry after_would_do", () => {
    const p = program({
      "s:a": section("A", [run(2, cmd("df")), doCmd(3, cmd("apt-get clean")), run(4, cmd("df")), page(5, [lit("done")])]),
    });
    const { turns } = drive(p, config({}, true), [ok(), ok()]);
    expect(
      nexts(turns)
        .filter((n) => n.kind === "exec")
        .map((n) => n.kind === "exec" && n.exec),
    ).toEqual(["run", "run"]);
    expect(bodies(turns)).toEqual([
      { event: "run", cmd: "df", exit: 0, timed_out: false, after_would_do: false },
      { event: "would_do", cmd: "apt-get clean" },
      { event: "run", cmd: "df", exit: 0, timed_out: false, after_would_do: true },
      { event: "would_page", text: "done" },
      { event: "outcome", outcome: "paged", reason: null, ask_calls: 0, effects: 1, dry_run: true },
    ]);
    expect(last(turns)).toEqual(PAGED);
  });

  test("with --apply the same page is handed to the pager, and a failed pager still ends paged", () => {
    const p = program({ "s:a": section("A", [page(5, [lit("disk full on "), v("host")])]) });
    const { turns } = drive(p, config(), [{ kind: "page", ok: false }]);
    expect(nexts(turns)).toEqual([{ kind: "page", text: "disk full on h1", src: 5 }, PAGED]);
    expect(bodies(turns)[0]).toEqual({ event: "page", text: "disk full on h1", ok: false });
  });
});

describe("check (SPEC §4.2)", () => {
  const withCmd = (els: unknown = null) =>
    program({ "s:a": section("A", [checkCmd(2, cmd("test -f /x"), { stop: {} }, els), handOff(3)]), "s:b": section("B", [stop(9)]) });

  test("a command check: exit 0 is true, so → stop", () => {
    const { turns } = drive(withCmd(), config(), [ok()]);
    expect(nexts(turns)[0]).toEqual({ kind: "exec", cmd: "test -f /x", exec: "check", timeoutMs: 30000, src: 2 });
    expect(bodies(turns)[0]).toEqual({ event: "check_cmd", cmd: "test -f /x", exit: 0, timed_out: false, after_would_do: false });
    expect(last(turns)).toEqual(STOPPED);
  });

  test("a non-zero exit is false and carries on", () => {
    expect(last(drive(withCmd(), config(), [fail()]).turns)).toEqual(handoff("explicit"));
  });

  test("a timeout isn't false but a failure: command_failed, or the else", () => {
    expect(last(drive(withCmd(), config(), [timeout]).turns)).toEqual(handoff("command_failed"));
    expect(last(drive(withCmd(skip), config(), [timeout]).turns)).toEqual(handoff("explicit"));
    // With `else [X]` the check never carries on, so it ends its section.
    const p = program({ "s:a": section("A", [checkCmd(2, cmd("test -f /x"), { stop: {} }, to("s:b"))]), "s:b": section("B", [stop(9)]) });
    expect(bodies(drive(p, config(), [timeout]).turns).map((e) => e.event)).toEqual(["check_cmd", "transfer", "outcome"]);
  });

  const compare = (els: unknown = null) =>
    program(
      { "s:a": section("A", [run(2, cmd("df"), "used"), cmp(3, "<", v("used"), v("threshold"), { stop: {} }, els), handOff(4)]) },
      { threshold: 85 },
    );

  test("comparisons coerce: trim, strip one %, parse", () => {
    const hi = drive(compare(), config({ threshold: 85 }), [ok(" 91%\n")]).turns;
    expect(bodies(hi)[1]).toEqual({
      event: "check",
      expr: "{used} < {threshold}",
      left: "91",
      right: "85",
      result: false,
      after_would_do: false,
    });
    expect(last(hi)).toEqual(handoff("explicit"));
    expect(last(drive(compare(), config({ threshold: 85 }), [ok("80%")]).turns)).toEqual(STOPPED);
    expect(last(drive(compare(), config({ threshold: 85 }), [ok("-2.5")]).turns)).toEqual(STOPPED);
  });

  test("a value that isn't a number goes to failure handling: command_failed, or else skip carries on", () => {
    const bad = drive(compare(), config({ threshold: 85 }), [ok("n/a")]).turns;
    expect(bodies(bad)[1]).toMatchObject({ event: "check", left: null, right: "85", result: null });
    expect(last(bad)).toEqual(handoff("command_failed"));
    expect(last(drive(compare(skip), config({ threshold: 85 }), [ok("n/a")]).turns)).toEqual(handoff("explicit"));
  });

  test("`check COND else [X]`: true carries on, false transfers", () => {
    const p = program({
      "s:a": section("A", [cmp(2, ">=", { num: "3" }, { num: "2" }, null, to("s:b")), stop(3)]),
      "s:b": section("B", [handOff(9)]),
    });
    expect(last(drive(p, config(), []).turns)).toEqual(STOPPED);
    const q = program({
      "s:a": section("A", [cmp(2, ">=", { num: "1" }, { num: "2" }, null, to("s:b")), stop(3)]),
      "s:b": section("B", [handOff(9)]),
    });
    expect(last(drive(q, config(), []).turns)).toEqual(handoff("explicit"));
  });

  test("explore mode: a comparison on run output asks Choose(3): true, false or not a number (SPEC §5.4)", () => {
    const cfg = config({ threshold: 85 }, false, "explore");
    const turns = drive(compare(), cfg, [ok()]).turns;
    expect(last(turns)).toEqual({ kind: "choose", n: 3 });
    expect(last(drive(compare(), cfg, [ok(), { kind: "picked", i: 0 }]).turns)).toEqual(STOPPED);
    expect(last(drive(compare(), cfg, [ok(), { kind: "picked", i: 1 }]).turns)).toEqual(handoff("explicit"));
    expect(last(drive(compare(), cfg, [ok(), { kind: "picked", i: 2 }]).turns)).toEqual(handoff("command_failed"));
  });

  test("explore mode decides comparisons on known values itself", () => {
    const p = program({ "s:a": section("A", [cmp(2, "<", v("threshold"), { num: "90" }, { stop: {} }), handOff(3)]) }, { threshold: 85 });
    expect(nexts(drive(p, config({ threshold: 85 }, false, "explore"), []).turns)).toEqual([STOPPED]);
  });
});

describe("transfers (SPEC §4.1)", () => {
  test("then [X] moves to X, logged by display name", () => {
    const p = program({ "s:a": section("A", [thenTo(2, "s:clean_up")]), "s:clean_up": section("Clean up", [stop(7)]) });
    const { turns } = drive(p, config(), []);
    expect(events(turns)).toEqual([
      { at: { section: "A", line: 2 }, event: "transfer", from: "A", to: "Clean up" },
      {
        at: { section: "Clean up", line: 7 },
        event: "outcome",
        outcome: "stopped",
        reason: null,
        ask_calls: 0,
        effects: 0,
        dry_run: false,
      },
    ]);
  });
});

describe("deadline (SPEC §7 step 5)", () => {
  test("hands off with reason deadline, at the instruction it didn't finish", () => {
    const p = program({ "s:a": section("A", [run(2, cmd("sleep 1")), run(3, cmd("df")), stop(4)]) });
    const { turns } = drive(p, config(), [ok(), { kind: "deadline" }]);
    expect(last(turns)).toEqual(handoff("deadline"));
    expect(events(turns).at(-1)).toMatchObject({ at: { section: "A", line: 3 }, event: "outcome", reason: "deadline" });
  });
});

describe("for each, yes/no and if yes (SPEC §4.2, §4.7)", () => {
  const cleanup = program({
    "s:a": section("A", [
      forEach(2, "step", "s:cleanups", [
        askYesNo(3, [lit('Worth running "'), v("step"), lit('"?')], 90, "_yn", skip),
        ifYesDo(4, "step", skip),
      ]),
      stop(5),
    ]),
    "s:cleanups": actions("Cleanups", [
      ["Vacuum the journal", "journalctl --vacuum-size=500M"],
      ["Clear the apt cache", "apt-get clean"],
    ]),
  });
  const yes = answer({ yes: 0.95, no: 0.05 });

  test("each item is asked about by its label, and `if yes do step` runs its command", () => {
    const { turns } = drive(cleanup, config(), [yes, ok()]);
    const ask = nexts(turns)[0];
    expect(ask).toMatchObject({ kind: "ask", request: { kind: "yesno", question: 'Worth running "Vacuum the journal"?', context: {} } });
    expect(request(ask).options).toEqual([
      { id: "yes", label: "yes", description: null },
      { id: "no", label: "no", description: null },
    ]);
    expect(nexts(turns)[1]).toEqual({ kind: "exec", cmd: "journalctl --vacuum-size=500M", exec: "do", timeoutMs: 600000, src: 4 });
  });

  test("a failed gate with `else skip` answers no, so `if yes` doesn't run", () => {
    const { turns, interp } = drive(cleanup, config(), [answer({ yes: 0.6, no: 0.4 }), answer({ yes: 0.02, no: 0.98 })]);
    expect(nexts(turns).map((n) => n.kind)).toEqual(["ask", "ask", "done"]);
    expect(last(turns)).toEqual(STOPPED);
    // The loop variable is unbound after the loop (SPEC §3.5); the answer stays.
    expect(interp.variables()).not.toHaveProperty("step");
    expect(interp.variables()._yn).toBe("no");
  });

  test("in a dry run every item's do is a would_do, never an Exec(do)", () => {
    const { turns } = drive(cleanup, config({}, true), [yes, yes]);
    expect(nexts(turns).some((n) => n.kind === "exec")).toBe(false);
    expect(bodies(turns).filter((e) => e.event === "would_do")).toEqual([
      { event: "would_do", cmd: "journalctl --vacuum-size=500M" },
      { event: "would_do", cmd: "apt-get clean" },
    ]);
    // The second ask comes after a would_do.
    expect(
      bodies(turns)
        .filter((e) => e.event === "ask")
        .map((e) => e.after_would_do),
    ).toEqual([false, true]);
  });

  test("`if yes run` runs only on yes, and its failure goes to its else", () => {
    const p = program({ "s:a": section("A", [askYesNo(2, [lit("Look?")], 90), ifYesRun(3, cmd("dmesg"), skip), stop(4)]) });
    const yesTurns = drive(p, config(), [yes, fail()]).turns;
    expect(nexts(yesTurns)[1]).toEqual({ kind: "exec", cmd: "dmesg", exec: "run", timeoutMs: 30000, src: 3 });
    expect(last(yesTurns)).toEqual(STOPPED);
    expect(nexts(drive(p, config(), [answer({ yes: 0.02, no: 0.98 })]).turns).map((n) => n.kind)).toEqual(["ask", "done"]);
  });

  test("a transfer out of a loop unbinds its variable; a loop whose body always ends can end its section", () => {
    const p = program({
      "s:a": section("A", [forEach(2, "svc", "s:services", [thenTo(3, "s:b")])]),
      "s:b": section("B", [page(8, [lit("svc="), v("svc")])]),
      "s:services": values("Services", ["nginx", "rsyslog"]),
    });
    expect(last(drive(p, config(), []).turns)).toEqual({ kind: "page", text: "svc=(unavailable)", src: 8 });
  });

  test("one of binds the chosen item, which may go in a command", () => {
    const p = program({
      "s:a": section("A", [
        askOneOf(2, [lit("Which service?")], 90, "s:services", "service"),
        doCmd(3, [lit("systemctl restart "), v("service")]),
        stop(4),
      ]),
      "s:services": values("Services", ["nginx", "rsyslog"]),
    });
    const { turns } = drive(p, config(), [answer({ nginx: 0.05, rsyslog: 0.95 })]);
    const ask = nexts(turns)[0];
    expect(request(ask).options.map((o) => o.id)).toEqual(["nginx", "rsyslog"]);
    expect(last(turns)).toMatchObject({ kind: "exec", cmd: "systemctl restart rsyslog", exec: "do" });
    expect(bodies(turns)[0]).toMatchObject({ event: "ask", chosen: "rsyslog", passed: true });
  });

  test("do item runs the loop item's own command", () => {
    const p = program({
      "s:a": section("A", [forEach(2, "c", "s:cleanups", [doItem(3, "c")]), stop(4)]),
      "s:cleanups": actions("Cleanups", [["Clear the apt cache", "apt-get clean"]]),
    });
    expect(nexts(drive(p, config(), []).turns)[0]).toEqual({ kind: "exec", cmd: "apt-get clean", exec: "do", timeoutMs: 600000, src: 3 });
  });

  test("an action item's command may name a param", () => {
    const p = program(
      {
        "s:a": section("A", [forEach(2, "c", "s:cleanups", [doItem(3, "c")]), stop(4)]),
        "s:cleanups": {
          name: "Cleanups",
          src: 80,
          lists: [{ src: 81, items: [{ src: 81, action: { label: "Trim", cmd: [lit("trim "), v("mount")] } }] }],
        },
      },
      { mount: "/" },
    );
    expect(nexts(drive(p, config({ mount: "/var" }), []).turns)[0]).toMatchObject({ kind: "exec", cmd: "trim /var", exec: "do" });
  });
});

describe("Score asks (SPEC §4.2, v1.1)", () => {
  const p = program({
    "s:a": section("A", [
      askScore(2, [lit("How severe?")], 75, 1, 4, "severity"),
      cmp(8, "==", v("severity"), { num: "3" }, { stop: {} }),
      handOff(9),
    ]),
  });

  test("options are the levels with their rubric; a pass binds the level as an integer", () => {
    const { turns } = drive(p, config(), [answer({ "1": 0.05, "2": 0.05, "3": 0.85, "4": 0.05 })]);
    const ask = nexts(turns)[0];
    expect(request(ask).kind).toBe("score");
    expect(request(ask).options.map((o) => [o.id, o.description])).toEqual([
      ["1", "level 1"],
      ["2", "level 2"],
      ["3", "level 3"],
      ["4", "level 4"],
    ]);
    expect(bodies(turns)[0]).toMatchObject({ event: "ask", kind: "score", chosen: 3, range: [1, 4], passed: true });
    expect(bodies(turns)[1]).toMatchObject({ event: "check", left: "3", right: "3", result: true });
    expect(last(turns)).toEqual(STOPPED);
  });

  test("0.45 / 0.45 / 0.1 fails a 75% gate: gate_failed", () => {
    expect(last(drive(p, config(), [answer({ "1": 0, "2": 0.1, "3": 0.45, "4": 0.45 })]).turns)).toEqual(handoff("gate_failed"));
  });

  test("an extra level `5` is invalid: ask_unavailable", () => {
    expect(last(drive(p, config(), [answer({ "1": 0.1, "2": 0.1, "3": 0.6, "4": 0.1, "5": 0.1 })]).turns)).toEqual(
      handoff("ask_unavailable", "unavailable"),
    );
  });
});

describe("disk-full (SPEC Appendix A)", () => {
  const disk = JSON.parse(readFileSync(new URL("../../contracts/examples/disk-full.core.json", import.meta.url), "utf8"));
  const cfg = config({ mount: "/", threshold: 85, target: 80 });

  test("the first ask is the request in SPEC §6.1", () => {
    const { turns } = drive(disk, cfg, [ok("91%"), ok("disk errors"), ok("4.0G /var/log")]);
    const ask = last(turns);
    expect(ask).toMatchObject({
      kind: "ask",
      request: {
        kind: "choice",
        question: "Given `used`, `errors` and `biggest`, what's the best next step?",
        guidance: "Look at usage, recent errors and what's biggest on disk.",
        context: { used: "91%", errors: "disk errors", biggest: "4.0G /var/log" },
      },
    });
    expect(request(ask).options.map((o) => o.label)).toEqual(["Clean up", "Restart", "Page", "Investigate"]);
  });

  test("under the threshold it stops straight away", () => {
    expect(last(drive(disk, cfg, [ok("42%")]).turns)).toEqual(STOPPED);
  });

  test("a gate failure at triage hands off: gate_failed", () => {
    const probs = { "s:clean_up": 0.55, "s:restart": 0.4, "s:page": 0.03, "s:investigate": 0.02 };
    expect(last(drive(disk, cfg, [ok("91%"), ok("e"), ok("b"), answer(probs)]).turns)).toEqual(handoff("gate_failed"));
  });
});
