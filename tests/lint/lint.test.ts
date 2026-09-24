// Semantic lint (SPEC §7.1, §12.2): every lint-stage code and lint-time
// warning, from hand-written core JSON, with the line it points at.
//
// Lines: an error about a statement points at the statement; about a
// section option or rubric line, at that line; about a param default or
// list item, at the default or item; about the entry, at its frontmatter
// line; about a section as a whole, at its heading.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { _dafny, BigNumber, gen } from "../../src/core.js";
import { lint } from "../../src/lint.js";

type J = any;
const example = (name: string) => JSON.parse(readFileSync(new URL(`../../contracts/examples/${name}.core.json`, import.meta.url), "utf8"));

// ---- core JSON builders ----
const lit = (s: string) => ({ lit: s });
const v = (name: string) => ({ var: name });
const cmd = (...ps: (string | { var: string })[]) => ps.map((p) => (typeof p === "string" ? lit(p) : p));
const ref = (id: string) => ({ section: id });
const skip = { skip: {} };
const STOP = { stop: {} };

const run = (src: number, c: J[], as?: string, els: J = null) => ({ src, run: as === undefined ? { cmd: c } : { cmd: c, as }, else: els });
const doCmd = (src: number, c: J[], els: J = null) => ({ src, do: { cmd: c }, else: els });
const doItem = (src: number, item: string, els: J = null) => ({ src, do: { item }, else: els });
const cmp = (src: number, l: J, op: string, r: J, then: J = STOP, els: J = null) => ({
  src,
  check: { cond: { cmp: { op, l, r } }, then, else: els },
});
const succeeds = (src: number, c: J[], then: J, els: J = null) => ({ src, check: { cond: { succeeds: c }, then, else: els } });
const ask = (src: number, question: J[], form: J, els: J = null) => ({ src, ask: { question, sure: 80, else: els, ...form } });
const options = (...opts: [number, string][]) => ({ sections: opts.map(([src, id]) => ({ src, section: id })) });
const yesno = (as = "_yn") => ({ yesno: { as } });
const oneOf = (list: string, as: string) => ({ one_of: { list: ref(list), as } });
const score = (low: number, high: number, rubric: [number, number][], as = "sev") => ({
  score: { low, high, rubric: rubric.map(([src, level]) => ({ src, level, text: `level ${level}` })), as },
});
const forEach = (src: number, name: string, list: string, body: J[]) => ({ src, for_each: { var: name, list: ref(list), body } });
const ifYesRun = (src: number, c: J[], els: J = null) => ({ src, if_yes: { run: { cmd: c }, else: els } });
const ifYesDo = (src: number, item: string, els: J = null) => ({ src, if_yes: { do: { item }, else: els } });
const then = (src: number, id: string) => ({ src, then: ref(id) });
const page = (src: number, text: J[]) => ({ src, page: text });
const handOff = (src: number) => ({ src, hand_off: {} });
const stop = (src: number) => ({ src, stop: {} });

const section = (src: number, body: J[], guidance: string | null = "Do it.") => ({ name: `S${src}`, src, guidance, body });
const value = (src: number, text: string) => ({ src, value: text });
const action = (src: number, label: string, c = "true") => ({ src, action: { label, cmd: [lit(c)] } });
const data = (src: number, ...lists: J[][]) => ({ name: `L${src}`, src, lists: lists.map((items, i) => ({ src: src + 1 + i, items })) });

// A program whose entry, `s:main`, is at line 10; its frontmatter entry line is 2.
function prog(main: J[], more: Record<string, J> = {}, params: J = {}, entry = "s:main") {
  return {
    skill: "t",
    format: 1,
    entry: { section: entry, src: 2 },
    params,
    limits: { run_timeout_ms: 1, do_timeout_ms: 1, deadline_ms: 1, ask_context_tokens: 1 },
    sections: { "s:main": section(10, main), ...more },
  };
}

const errors = (p: J) => lint(p).errors;
const warnings = (p: J) => lint(p).warnings;
const E = (code: string, line: number) => ({ code, line });

// Data sections used below.
const CLEANUPS = { "s:cleanups": data(60, [action(61, "Vacuum"), action(62, "Clean apt")]) };
const SERVICES = { "s:services": data(70, [value(71, "nginx"), value(72, "rsyslog")]) };
const DF = cmd("df");

describe("the examples lint clean (SPEC §3.7)", () => {
  for (const name of ["disk-full", "cert-expiry", "error-triage"]) {
    test(name, () => {
      expect(lint(example(name))).toEqual({ errors: [], warnings: [] });
    });
  }
});

describe("references (SPEC §3.4, §5.1)", () => {
  test("E-UNRESOLVED: a target that names no section", () => {
    expect(errors(prog([then(11, "s:nonexistent")]))).toEqual([E("E-UNRESOLVED", 11)]);
  });

  test("E-UNRESOLVED: [Clean up](#cleanup) where the slug is #clean-up", () => {
    const link = { section: "s:clean_up", anchor: { given: "cleanup", expected: "clean-up" } };
    expect(errors(prog([{ src: 11, then: link }], { "s:clean_up": section(20, [stop(21)]) }))).toEqual([E("E-UNRESOLVED", 11)]);
  });

  test("a link whose anchor is the slug resolves", () => {
    const link = { section: "s:clean_up", anchor: { given: "clean-up", expected: "clean-up" } };
    expect(errors(prog([{ src: 11, then: link }], { "s:clean_up": section(20, [stop(21)]) }))).toEqual([]);
  });

  test("E-UNRESOLVED: a list that names no section", () => {
    expect(errors(prog([forEach(11, "x", "s:nonexistent", [run(12, DF)]), stop(13)]))).toEqual([E("E-UNRESOLVED", 11)]);
  });

  test("E-UNRESOLVED: a section option that names no section, at the option's line", () => {
    const p = prog([ask(11, [lit("Which?")], options([12, "s:page"], [13, "s:nope"]))], { "s:page": section(20, [stop(21)]) });
    expect(errors(p)).toEqual([E("E-UNRESOLVED", 13)]);
  });

  test("E-UNRESOLVED: an entry that names no section, at its frontmatter line", () => {
    expect(errors(prog([stop(11)], {}, {}, "s:nope"))).toEqual([E("E-UNRESOLVED", 2)]);
  });

  test("E-UNRESOLVED: a skill with no instruction section gets entry s:_entry", () => {
    const p = { ...prog([]), entry: { section: "s:_entry", src: 1 }, sections: { "s:notes": data(60, [value(61, "a")]) } };
    expect(lint(p)).toEqual({ errors: [E("E-UNRESOLVED", 1)], warnings: [] });
  });

  test("an unreferenced prose section with odd lists isn't checked", () => {
    const odd = data(60, [], [value(62, "a"), action(63, "A")], [value(64, "x"), value(65, "X")]);
    expect(lint(prog([stop(11)], { "s:notes": odd }))).toEqual({ errors: [], warnings: [] });
  });

  test("E-REF-KIND: then [Cleanups], a data section as a target", () => {
    expect(errors(prog([then(11, "s:cleanups")], CLEANUPS))).toEqual([E("E-REF-KIND", 11)]);
  });

  test("E-REF-KIND: an else target that's a data section", () => {
    expect(errors(prog([run(11, DF, undefined, ref("s:cleanups")), stop(12)], CLEANUPS))).toEqual([E("E-REF-KIND", 11)]);
  });

  test("E-REF-KIND: an instruction section used as a list", () => {
    const p = prog([forEach(11, "x", "s:other", [run(12, DF)]), stop(13)], { "s:other": section(20, [stop(21)]) });
    expect(errors(p)).toEqual([E("E-REF-KIND", 11)]);
  });

  test("E-REF-KIND: an entry that's a data section", () => {
    expect(errors(prog([stop(11)], CLEANUPS, {}, "s:cleanups"))).toEqual([E("E-REF-KIND", 2)]);
  });

  test("E-SECTION-KIND: for each over a section with two lists", () => {
    const p = prog([forEach(11, "x", "s:notes", [run(12, DF)]), stop(13)], { "s:notes": data(60, [value(61, "a")], [value(63, "b")]) });
    expect(errors(p)).toEqual([E("E-SECTION-KIND", 11)]);
  });

  test("E-SECTION-KIND: one of over a prose section with no list", () => {
    const p = prog([ask(11, [lit("Which?")], oneOf("s:background", "x")), stop(12)], { "s:background": data(60) });
    expect(errors(p)).toEqual([E("E-SECTION-KIND", 11)]);
  });

  test("a prose-only section lints", () => {
    expect(errors(prog([stop(11)], { "s:background": data(60) }))).toEqual([]);
  });
});

describe("data lists (SPEC §3.6)", () => {
  const over = (list: J) => prog([forEach(11, "x", "s:list", [run(12, DF)]), stop(13)], { "s:list": list });

  test("E-LIST-EMPTY: a data list with no items, at the list's line", () => {
    expect(errors(over(data(60, [])))).toEqual([E("E-LIST-EMPTY", 61)]);
  });

  test("E-LIST-MIXED: a list mixing action and value items, at the item that differs", () => {
    expect(errors(over(data(60, [value(61, "nginx"), action(62, "Vacuum")])))).toEqual([E("E-LIST-MIXED", 62)]);
  });

  test("E-LIST-MIXED: at the items of the minority kind", () => {
    expect(errors(over(data(60, [value(61, "nginx"), action(62, "Vacuum"), action(63, "Clean")])))).toEqual([E("E-LIST-MIXED", 61)]);
  });

  test("E-LIST-DUP: two nginx items, ignoring case, at the second", () => {
    expect(errors(over(data(60, [value(61, "nginx"), value(62, "a"), value(63, "NGINX")])))).toEqual([E("E-LIST-DUP", 63)]);
  });

  test("E-LIST-DUP: two action items with the same label", () => {
    expect(errors(over(data(60, [action(61, "Vacuum", "a"), action(62, "vacuum", "b")])))).toEqual([E("E-LIST-DUP", 62)]);
  });

  test("an unused list isn't checked: it's prose", () => {
    expect(errors(prog([stop(11)], { "s:notes": data(60, []) }))).toEqual([]);
  });

  test("a list's errors are reported once, however often it's used", () => {
    const p = prog([forEach(11, "x", "s:list", [run(12, DF)]), forEach(13, "y", "s:list", [run(14, DF)]), stop(15)], {
      "s:list": data(60, []),
    });
    expect(errors(p)).toEqual([E("E-LIST-EMPTY", 61)]);
  });

  test("E-LIST-KIND: one of over action items", () => {
    expect(errors(prog([ask(11, [lit("Which?")], oneOf("s:cleanups", "x")), stop(12)], CLEANUPS))).toEqual([E("E-LIST-KIND", 11)]);
  });

  test("E-LIST-KIND: do item over value items", () => {
    expect(errors(prog([forEach(11, "svc", "s:services", [doItem(12, "svc")]), stop(13)], SERVICES))).toEqual([E("E-LIST-KIND", 12)]);
  });

  test("E-LIST-KIND: if yes do item over value items", () => {
    const body = [ask(12, [lit("Restart "), v("svc"), lit("?")], yesno()), ifYesDo(13, "svc")];
    expect(errors(prog([forEach(11, "svc", "s:services", body), stop(14)], SERVICES))).toEqual([E("E-LIST-KIND", 13)]);
  });

  test("do item over action items, and a nested for each, lint", () => {
    const inner = forEach(13, "svc", "s:services", [run(14, cmd("systemctl status ", v("svc")))]);
    expect(errors(prog([forEach(11, "step", "s:cleanups", [doItem(12, "step"), inner]), stop(15)], { ...CLEANUPS, ...SERVICES }))).toEqual(
      [],
    );
  });

  test("a numbered or bulleted list is the same list: a data list works", () => {
    expect(
      errors(prog([ask(11, [lit("Which?")], oneOf("s:services", "svc")), doCmd(12, cmd("restart ", v("svc"))), stop(13)], SERVICES)),
    ).toEqual([]);
  });
});

describe("the transfer graph (SPEC §4.6)", () => {
  test("E-CYCLE: A → B → A, at each transfer on the cycle", () => {
    expect(errors(prog([then(11, "s:b")], { "s:b": section(20, [then(21, "s:main")]) }))).toEqual([E("E-CYCLE", 11), E("E-CYCLE", 21)]);
  });

  test("E-CYCLE: a section that transfers to itself", () => {
    expect(errors(prog([run(11, DF, undefined, ref("s:main")), stop(12)]))).toEqual([E("E-CYCLE", 11)]);
  });

  test("E-CYCLE: a transfer into a cycle, but not on it, isn't reported", () => {
    const p = prog([then(11, "s:a")], { "s:a": section(20, [then(21, "s:b")]), "s:b": section(30, [then(31, "s:a")]) });
    expect(errors(p)).toEqual([E("E-CYCLE", 21), E("E-CYCLE", 31)]);
  });

  test("E-CYCLE: through a section option and a nested transfer", () => {
    const p = prog([ask(11, [lit("Which?")], options([12, "s:b"], [13, "s:c"]))], {
      "s:b": section(20, [forEach(21, "x", "s:services", [run(22, DF, undefined, ref("s:main"))]), stop(23)]),
      "s:c": section(30, [stop(31)]),
      ...SERVICES,
    });
    expect(errors(p)).toEqual([E("E-CYCLE", 12), E("E-CYCLE", 22)]);
  });

  test("two paths to one section aren't a cycle", () => {
    const p = prog([ask(11, [lit("Which?")], options([12, "s:b"], [13, "s:c"]))], {
      "s:b": section(20, [then(21, "s:c")]),
      "s:c": section(30, [stop(31)]),
    });
    expect(errors(p)).toEqual([]);
  });
});

describe("every path ends, every instruction runs (SPEC §4.1)", () => {
  test("E-FALLS-OFF: a section ending in run", () => {
    expect(errors(prog([run(11, DF)]))).toEqual([E("E-FALLS-OFF", 11)]);
  });

  test("E-FALLS-OFF: an empty section, at its heading", () => {
    expect(errors(prog([]))).toEqual([E("E-FALLS-OFF", 10)]);
  });

  test("E-FALLS-OFF: a section ending in check … → stop, since a false check carries on", () => {
    expect(errors(prog([cmp(11, { num: "1" }, "<", { num: "2" })]))).toEqual([E("E-FALLS-OFF", 11)]);
  });

  test("E-FALLS-OFF: a section ending in a for each whose body can finish", () => {
    expect(errors(prog([forEach(11, "x", "s:services", [run(12, DF)])], SERVICES))).toEqual([E("E-FALLS-OFF", 11)]);
  });

  test("a section ending in a for each whose body always ends lints: lists are never empty", () => {
    expect(errors(prog([forEach(11, "x", "s:services", [run(12, DF), stop(13)])], SERVICES))).toEqual([]);
  });

  test("E-UNREACHABLE: an instruction after a for each whose body always transfers", () => {
    const p = prog([forEach(11, "x", "s:services", [then(12, "s:b")]), stop(13)], { ...SERVICES, "s:b": section(20, [stop(21)]) });
    expect(errors(p)).toEqual([E("E-UNREACHABLE", 13)]);
  });

  test("a section ending in check … → stop · else [X] lints: every way out ends", () => {
    expect(errors(prog([cmp(11, { num: "1" }, "<", { num: "2" }, STOP, ref("s:b"))], { "s:b": section(20, [stop(21)]) }))).toEqual([]);
  });

  for (const [name, last] of [
    ["stop", stop(11)],
    ["page", page(11, [lit("help")])],
    ["hand off", handOff(11)],
  ] as const) {
    test(`a section ending in ${name} lints`, () => {
      expect(errors(prog([last]))).toEqual([]);
    });
  }

  test("E-UNREACHABLE: anything after then [X]", () => {
    expect(errors(prog([then(11, "s:b"), stop(12)], { "s:b": section(20, [stop(21)]) }))).toEqual([E("E-UNREACHABLE", 12)]);
  });

  for (const [name, first] of [
    ["stop", stop(11)],
    ["page", page(11, [lit("help")])],
    ["hand off", handOff(11)],
    ["a section-option ask", ask(11, [lit("Which?")], options([20, "s:b"], [21, "s:c"]))],
    ["check … → stop · else [X]", cmp(11, { num: "1" }, "<", { num: "2" }, STOP, ref("s:b"))],
  ] as const) {
    test(`E-UNREACHABLE: an instruction after ${name}`, () => {
      const p = prog([first, stop(22)], { "s:b": section(30, [stop(31)]), "s:c": section(40, [stop(41)]) });
      expect(errors(p)).toEqual([E("E-UNREACHABLE", 22)]);
    });
  }

  test("E-UNREACHABLE: inside a for each body", () => {
    expect(errors(prog([forEach(11, "x", "s:services", [stop(12), run(13, DF)]), stop(14)], SERVICES))).toEqual([E("E-UNREACHABLE", 13)]);
  });

  test("an instruction after check … → stop is reachable", () => {
    expect(errors(prog([cmp(11, { num: "1" }, "<", { num: "2" }), stop(12)]))).toEqual([]);
  });

  test("instructions after check … → [X] and after run … · else [X] are reachable", () => {
    const p = prog([succeeds(11, DF, ref("s:b")), run(12, DF, undefined, ref("s:b")), stop(13)], { "s:b": section(20, [stop(21)]) });
    expect(errors(p)).toEqual([]);
  });
});

describe("ask forms (SPEC §3.4, §4.2)", () => {
  const targets = { "s:b": section(30, [stop(31)]), "s:c": section(40, [stop(41)]) };

  test("E-OPTION-COUNT: an ask with 1 option", () => {
    expect(errors(prog([ask(11, [lit("Which?")], options([12, "s:b"]))], targets))).toEqual([E("E-OPTION-COUNT", 11)]);
  });

  // n distinct options, each a section of its own.
  const distinct = (n: number) => {
    const more: Record<string, J> = {};
    const opts: [number, string][] = [];
    for (let i = 0; i < n; i++) {
      more[`s:o${i}`] = section(1000 + 2 * i, [stop(1001 + 2 * i)]);
      opts.push([12 + i, `s:o${i}`]);
    }
    return prog([run(11, DF, "x"), ask(11, [v("x")], options(...opts))], more);
  };

  test("E-OPTION-COUNT: an ask with 256 distinct options", () => {
    expect(errors(distinct(256))).toEqual([E("E-OPTION-COUNT", 11)]);
  }, 60_000);

  test("an ask with 255 distinct options lints, within 5 s", () => {
    const t = Date.now();
    expect(lint(distinct(255))).toEqual({ errors: [], warnings: [] });
    expect(Date.now() - t).toBeLessThan(5000);
  }, 60_000);

  test("a chain of 100 sections lints, within 5 s", () => {
    const more: Record<string, J> = {};
    for (let i = 1; i < 100; i++) more[`s:c${i}`] = section(100 + 2 * i, [i < 99 ? then(101 + 2 * i, `s:c${i + 1}`) : stop(101 + 2 * i)]);
    const t = Date.now();
    expect(lint(prog([then(11, "s:c1")], more))).toEqual({ errors: [], warnings: [] });
    expect(Date.now() - t).toBeLessThan(5000);
  }, 60_000);

  test("E-OPTION-COUNT: the same section offered twice, at the repeat", () => {
    const p = prog([ask(11, [lit("Which?")], options([12, "s:b"], [13, "s:c"], [14, "s:b"]))], targets);
    expect(errors(p)).toEqual([E("E-OPTION-COUNT", 14)]);
  });

  test("E-ELSE-SKIP: else skip on a section-option ask", () => {
    expect(errors(prog([ask(11, [lit("Which?")], options([12, "s:b"], [13, "s:c"]), skip)], targets))).toEqual([E("E-ELSE-SKIP", 11)]);
  });

  test("E-ELSE-SKIP: else skip on a one of ask", () => {
    expect(errors(prog([ask(11, [lit("Which?")], oneOf("s:services", "svc"), skip), stop(12)], SERVICES))).toEqual([E("E-ELSE-SKIP", 11)]);
  });

  test("E-ELSE-SKIP: else skip on a Score ask", () => {
    const s = score(1, 2, [
      [12, 1],
      [13, 2],
    ]);
    expect(errors(prog([ask(11, [lit("How bad?")], s, skip), stop(14)]))).toEqual([E("E-ELSE-SKIP", 11)]);
  });

  test("else skip on a yes | no ask lints", () => {
    expect(errors(prog([ask(11, [lit("Ok?")], yesno(), skip), stop(12)]))).toEqual([]);
  });
});

describe("Score asks (SPEC §3.4, v1.1)", () => {
  const scoreAsk = (low: number, high: number, rubric: [number, number][]) =>
    prog([ask(11, [lit("How bad?")], score(low, high, rubric)), cmp(30, v("sev"), "==", { num: "2" }), stop(31)]);
  const full = (low: number, high: number) => Array.from({ length: high - low + 1 }, (_, i) => [12 + i, low + i] as [number, number]);

  test("E-SCORE-RANGE: → 5 to 1", () => {
    expect(errors(scoreAsk(5, 1, []))).toEqual([E("E-SCORE-RANGE", 11)]);
  });

  test("E-SCORE-RANGE: → 1 to 1, one level", () => {
    expect(errors(scoreAsk(1, 1, full(1, 1)))).toEqual([E("E-SCORE-RANGE", 11)]);
  });

  test("E-SCORE-RANGE: → 1 to 11, too many levels", () => {
    expect(errors(scoreAsk(1, 11, full(1, 11)))).toEqual([E("E-SCORE-RANGE", 11)]);
  });

  test("→ 0 to 9, ten levels, lints", () => {
    expect(errors(scoreAsk(0, 9, full(0, 9)))).toEqual([]);
  });

  test("E-SCORE-RUBRIC: rubric item 6 on a 1 to 5 ask, at the item", () => {
    expect(errors(scoreAsk(1, 5, [...full(1, 5), [17, 6]]))).toEqual([E("E-SCORE-RUBRIC", 17)]);
  });

  test("E-SCORE-RUBRIC: two rubric items for level 3, at the second", () => {
    expect(errors(scoreAsk(1, 4, [...full(1, 4), [16, 3]]))).toEqual([E("E-SCORE-RUBRIC", 16)]);
  });

  test("E-SCORE-RUBRIC: a 1 to 4 ask with no rubric, at the ask", () => {
    expect(errors(scoreAsk(1, 4, []))).toEqual([E("E-SCORE-RUBRIC", 11)]);
  });

  test("E-SCORE-RUBRIC: a 1 to 4 ask with no line for level 2, at the ask", () => {
    expect(
      errors(
        scoreAsk(1, 4, [
          [12, 1],
          [13, 3],
          [14, 4],
        ]),
      ),
    ).toEqual([E("E-SCORE-RUBRIC", 11)]);
  });

  test("check {severity} == 2 after a Score ask lints, and a Score answer can go in a command", () => {
    const p = prog([
      ask(11, [lit("How bad?")], score(1, 2, full(1, 2))),
      run(14, cmd("notify --level ", v("sev"))),
      cmp(15, v("sev"), "==", { num: "2" }),
      stop(16),
    ]);
    expect(errors(p)).toEqual([]);
  });

  test("a Score answer is unbound on the path where its gate failed", () => {
    const p = prog([ask(11, [lit("How bad?")], score(1, 2, full(1, 2)), ref("s:b")), stop(14)], {
      "s:b": section(20, [run(21, cmd("notify ", v("sev"))), stop(22)]),
    });
    expect(errors(p)).toEqual([E("E-UNBOUND", 21)]);
  });
});

describe("taint (SPEC §3.5)", () => {
  test("E-TAINT: do `rm -rf {errors}` where errors came from run", () => {
    const p = prog([run(11, cmd("journalctl"), "errors"), doCmd(12, cmd("rm -rf ", v("errors"))), stop(13)]);
    expect(errors(p)).toEqual([E("E-TAINT", 12)]);
  });

  test("E-TAINT: run output bound in one section, used in another's check command", () => {
    const p = prog([run(11, DF, "used"), then(12, "s:b")], { "s:b": section(20, [succeeds(21, cmd("test ", v("used")), STOP), stop(22)]) });
    expect(errors(p)).toEqual([E("E-TAINT", 21)]);
  });

  test("E-TAINT: a name that's a param on one path and run output on another", () => {
    const p = prog(
      [ask(11, [lit("Which?")], options([12, "s:a"], [13, "s:b"]))],
      {
        "s:a": section(20, [then(21, "s:c")]),
        "s:b": section(30, [run(31, DF, "mount"), then(32, "s:c")]),
        "s:c": section(40, [run(41, cmd("df ", v("mount"))), stop(42)]),
      },
      { mount: { str: "/", src: 3 } },
    );
    expect(errors(p)).toEqual([E("E-TAINT", 41)]);
  });

  test("E-TAINT: run output in an if yes command", () => {
    const p = prog([
      run(11, DF, "used"),
      ask(12, [lit("Clean "), v("used"), lit("?")], yesno()),
      ifYesRun(13, cmd("rm ", v("used"))),
      stop(14),
    ]);
    expect(errors(p)).toEqual([E("E-TAINT", 13)]);
  });

  test("a yes | no answer may go in a command: it's trusted", () => {
    expect(errors(prog([ask(11, [lit("Ok?")], yesno("ok")), run(12, cmd("echo ", v("ok"))), stop(13)]))).toEqual([]);
  });

  test("run output may go in question and page text", () => {
    const p = prog([run(11, DF, "used"), ask(12, [lit("Is "), v("used"), lit(" bad?")], yesno()), page(13, [v("used")])]);
    expect(errors(p)).toEqual([]);
  });

  test("a rebound name is judged by its latest value", () => {
    const p = prog(
      [run(11, DF, "x"), ask(12, [lit("Which? "), v("x")], oneOf("s:services", "x")), doCmd(13, cmd("restart ", v("x"))), stop(14)],
      SERVICES,
    );
    expect(errors(p)).toEqual([]);
  });

  test("E-ACTION-IN-CMD: run `echo {step}` inside for each step in [Cleanups]", () => {
    const p = prog([forEach(11, "step", "s:cleanups", [run(12, cmd("echo ", v("step")))]), stop(13)], CLEANUPS);
    expect(errors(p)).toEqual([E("E-ACTION-IN-CMD", 12)]);
  });

  test("an action item may go in question text", () => {
    const body = [ask(12, [lit("Run "), v("step"), lit("?")], yesno()), ifYesDo(13, "step", skip)];
    expect(errors(prog([forEach(11, "step", "s:cleanups", body), stop(14)], CLEANUPS))).toEqual([]);
  });
});

describe("action-item commands (SPEC §3.5)", () => {
  const tidy = (c: J[], main: J[] = []) =>
    prog(
      [...main, forEach(20, "step", "s:cleanups", [doItem(21, "step")]), stop(22)],
      {
        "s:cleanups": data(60, [{ src: 61, action: { label: "Tidy up", cmd: c } }]),
      },
      { mount: { str: "/", src: 3 }, bad: { str: "a b", src: 4 } },
    );

  test("E-TAINT: an action item's command naming run output, at the item", () => {
    expect(errors(tidy(cmd("sh -c ", v("payload")), [run(11, cmd("curl x"), "payload")]))).toEqual([E("E-TAINT", 61)]);
  });

  test("E-UNBOUND: an action item's command naming something bound nowhere, at the item", () => {
    expect(errors(tidy(cmd("rm -rf ", v("nope"))))).toEqual([E("E-UNBOUND", 61)]);
  });

  test("E-TAINT: an action item's command naming a param something rebinds", () => {
    expect(errors(tidy(cmd("df ", v("mount")), [run(11, DF, "mount")]))).toEqual([E("E-TAINT", 61)]);
  });

  test("E-TAINT: an action item's command naming a loop variable", () => {
    expect(errors(tidy(cmd("echo ", v("step"))))).toEqual([E("E-TAINT", 61)]);
  });

  test("E-UNSAFE-VALUE: an action item's command naming an unsafe param default, at the default", () => {
    expect(errors(tidy(cmd("df ", v("bad"))))).toEqual([E("E-UNSAFE-VALUE", 4)]);
  });

  test("an action item's command may name params and built-ins nothing rebinds", () => {
    expect(errors(tidy(cmd("df ", v("mount"), " ", v("host"))))).toEqual([]);
  });
});

describe("the safe-value check (SPEC §3.5)", () => {
  const bad = { "s:services": data(70, [value(71, "nginx"), value(72, "my app")]) };

  test("E-UNSAFE-VALUE: a value item `my app` used in a command, at the item", () => {
    const p = prog([forEach(11, "svc", "s:services", [doCmd(12, cmd("systemctl restart ", v("svc")))]), stop(13)], bad);
    expect(errors(p)).toEqual([E("E-UNSAFE-VALUE", 72)]);
  });

  test("E-UNSAFE-VALUE: a value item chosen by one of, used in a command", () => {
    const p = prog([ask(11, [lit("Which?")], oneOf("s:services", "svc")), doCmd(12, cmd("restart ", v("svc"))), stop(13)], bad);
    expect(errors(p)).toEqual([E("E-UNSAFE-VALUE", 72)]);
  });

  test("E-UNSAFE-VALUE: a value item starting with -", () => {
    const p = prog([forEach(11, "svc", "s:services", [doCmd(12, cmd("restart ", v("svc")))]), stop(13)], {
      "s:services": data(70, [value(71, "-rf")]),
    });
    expect(errors(p)).toEqual([E("E-UNSAFE-VALUE", 71)]);
  });

  test("E-UNSAFE-VALUE: a param default reaching a command, at the default", () => {
    expect(errors(prog([run(11, cmd("df ", v("mount"))), stop(12)], {}, { mount: { str: "/; rm -rf /", src: 3 } }))).toEqual([
      E("E-UNSAFE-VALUE", 3),
    ]);
  });

  test("E-UNSAFE-VALUE: a negative int param reaching a command", () => {
    expect(errors(prog([run(11, cmd("head -n ", v("n"))), stop(12)], {}, { n: { int: -5, src: 4 } }))).toEqual([E("E-UNSAFE-VALUE", 4)]);
  });

  test("unsafe values that never reach a command are fine", () => {
    const p = prog(
      [forEach(11, "svc", "s:services", [ask(12, [lit("Restart "), v("svc"), lit("?")], yesno())]), page(13, [v("note")])],
      bad,
      { note: { str: "a b; c", src: 3 } },
    );
    expect(errors(p)).toEqual([]);
  });

  test("safe values, ints and params pass", () => {
    const p = prog(
      [run(11, cmd("x ", v("a"), " ", v("n"), " ", v("host"))), stop(12)],
      {},
      { a: { str: "A-z0.9_/:@%+=,-", src: 3 }, n: { int: 0, src: 4 } },
    );
    expect(errors(p)).toEqual([]);
  });
});

describe("bound names (SPEC §3.5)", () => {
  test("E-UNBOUND: a command using a name bound by run … as x · else skip (and it's run output: E-TAINT)", () => {
    expect(errors(prog([run(11, DF, "x", skip), run(12, cmd("echo ", v("x"))), stop(13)]))).toEqual([E("E-TAINT", 12), E("E-UNBOUND", 12)]);
  });

  test("E-UNBOUND: a comparison on a name bound by run … as x · else skip", () => {
    expect(errors(prog([run(11, DF, "x", skip), cmp(12, v("x"), ">", { num: "1" }), stop(13)]))).toEqual([E("E-UNBOUND", 12)]);
  });

  test("E-UNBOUND: a for each variable used after the loop", () => {
    const p = prog(
      [forEach(11, "svc", "s:services", [run(12, cmd("status ", v("svc")))]), run(13, cmd("status ", v("svc"))), stop(14)],
      SERVICES,
    );
    expect(errors(p)).toEqual([E("E-UNBOUND", 13)]);
  });

  test("E-UNBOUND: a comparison on a name that's never bound", () => {
    expect(errors(prog([cmp(11, v("y"), "<", { num: "3" }), stop(12)]))).toEqual([E("E-UNBOUND", 11)]);
  });

  test("E-UNBOUND: a question naming something never bound anywhere", () => {
    expect(errors(prog([ask(11, [lit("Is "), v("nope"), lit(" ok?")], yesno()), stop(12)]))).toEqual([E("E-UNBOUND", 11)]);
  });

  test("E-UNBOUND: page text naming something never bound anywhere", () => {
    expect(errors(prog([page(11, [v("nope")])]))).toEqual([E("E-UNBOUND", 11)]);
  });

  test("E-UNBOUND: a name bound on only one of two paths into a section", () => {
    const p = prog([ask(11, [lit("Which?")], options([12, "s:a"], [13, "s:b"]))], {
      "s:a": section(20, [run(21, DF, "x"), then(22, "s:c")]),
      "s:b": section(30, [then(31, "s:c")]),
      "s:c": section(40, [cmp(41, v("x"), ">", { num: "1" }), stop(42)]),
    });
    expect(errors(p)).toEqual([E("E-UNBOUND", 41)]);
  });

  test("E-UNBOUND: do with an item that isn't bound", () => {
    expect(errors(prog([doItem(11, "step"), stop(12)]))).toEqual([E("E-UNBOUND", 11)]);
  });

  test("E-UNBOUND: a run output bound inside a loop, used before its binding on the next pass", () => {
    const p = prog(
      [run(11, DF, "x"), forEach(12, "svc", "s:services", [cmp(13, v("x"), ">", { num: "1" }), run(14, DF, "x", skip)]), stop(15)],
      SERVICES,
    );
    expect(errors(p)).toEqual([E("E-UNBOUND", 13)]);
  });

  test("a name bound on every path lints; a possibly unbound name may go in page text", () => {
    const p = prog([run(11, DF, "used"), run(12, DF, "biggest", skip), then(13, "s:b")], {
      "s:b": section(20, [cmp(21, v("used"), "<", { num: "80" }), page(22, [v("used"), v("biggest"), v("host"), v("run_id"), v("skill")])]),
    });
    expect(errors(p)).toEqual([]);
  });

  test("an unreachable section's transfer doesn't weaken what a reachable one binds", () => {
    const p = prog([run(11, DF, "y"), then(12, "s:t")], {
      "s:u": section(20, [then(21, "s:t")]),
      "s:t": section(30, [cmp(31, v("y"), "<", { num: "1" }), stop(32)]),
    });
    expect(lint(p)).toEqual({ errors: [], warnings: [E("W-SECTION-UNREACHED", 20)] });
  });

  test("E-UNBOUND: a loop variable after a transfer out of its loop", () => {
    const p = prog([forEach(11, "svc", "s:services", [run(12, DF, undefined, ref("s:b"))]), stop(13)], {
      ...SERVICES,
      "s:b": section(20, [run(21, cmd("status ", v("svc"))), stop(22)]),
    });
    expect(errors(p)).toEqual([E("E-UNBOUND", 21)]);
  });

  test("E-UNBOUND: a loop variable that shadows a param is unbound after the loop", () => {
    const p = prog([forEach(11, "mount", "s:services", [run(12, DF)]), run(13, cmd("df ", v("mount"))), stop(14)], SERVICES, {
      mount: { str: "/", src: 3 },
    });
    expect(errors(p)).toEqual([E("E-UNBOUND", 13)]);
  });

  test("a name bound inside a loop is bound after it: lists are never empty", () => {
    expect(
      errors(prog([forEach(11, "svc", "s:services", [run(12, DF, "x")]), cmp(13, v("x"), ">", { num: "1" }), stop(14)], SERVICES)),
    ).toEqual([]);
  });
});

describe("if yes (SPEC §4.2)", () => {
  test("E-IF-YES: if yes first in a section", () => {
    expect(errors(prog([ifYesRun(11, DF), stop(12)]))).toEqual([E("E-IF-YES", 11)]);
  });

  test("E-IF-YES: if yes after a one of ask, not a yes | no", () => {
    expect(errors(prog([ask(11, [lit("Which?")], oneOf("s:services", "svc")), ifYesRun(12, DF), stop(13)], SERVICES))).toEqual([
      E("E-IF-YES", 12),
    ]);
  });

  test("E-IF-YES: the yes | no ask is outside the loop body", () => {
    const p = prog([ask(11, [lit("Ok?")], yesno()), forEach(12, "svc", "s:services", [ifYesRun(13, DF)]), stop(14)], SERVICES);
    expect(errors(p)).toEqual([E("E-IF-YES", 13)]);
  });

  test("E-IF-YES: the answer is rebound before the if yes", () => {
    expect(errors(prog([ask(11, [lit("Ok?")], yesno("ok")), run(12, DF, "ok"), ifYesRun(13, DF), stop(14)]))).toEqual([E("E-IF-YES", 13)]);
  });

  test("E-IF-YES: a loop between may rebind the answer", () => {
    const p = prog(
      [
        ask(11, [lit("A?")], yesno("ok"), skip),
        forEach(12, "i", "s:services", [ask(13, [lit("B?")], yesno("ok"), skip)]),
        ifYesRun(14, cmd("true")),
        stop(15),
      ],
      SERVICES,
    );
    expect(errors(p)).toEqual([E("E-IF-YES", 14)]);
  });

  test("if yes after a yes | no ask, with other instructions between, lints", () => {
    expect(errors(prog([ask(11, [lit("Ok?")], yesno("ok")), run(12, DF), ifYesRun(13, DF), stop(14)]))).toEqual([]);
  });
});

describe("checks (SPEC §3.4)", () => {
  // src/ast.ts refuses this JSON, so the statement is built directly.
  test("E-GRAMMAR: a check with neither target nor else, at lint time", () => {
    const { SkopeAst } = gen;
    const stmt = SkopeAst.Stmt.create_Check(
      new BigNumber(11),
      SkopeAst.Cond.create_Succeeds(_dafny.Seq.of()),
      SkopeAst.Option.create_None(),
      SkopeAst.Else.create_NoElse(),
    );
    const found = [...gen.SkopeCheck.__default.CheckFindings(stmt)].map((e: any) =>
      E(e.dtor_code.toVerbatimString(false), e.dtor_src.toNumber()),
    );
    expect(found).toEqual([E("E-GRAMMAR", 11)]);
  });
});

describe("reporting (SPEC §7.1, §12.2)", () => {
  test("a skill with two errors reports both, ordered by line then code", () => {
    const p = prog(
      [
        forEach(11, "step", "s:cleanups", [run(12, cmd("journalctl"), "errors"), run(13, cmd("echo ", v("step"), v("errors")))]),
        then(14, "s:nonexistent"),
        stop(15),
      ],
      CLEANUPS,
    );
    expect(errors(p)).toEqual([E("E-ACTION-IN-CMD", 13), E("E-TAINT", 13), E("E-UNRESOLVED", 14), E("E-UNREACHABLE", 15)]);
  });
});

describe("warnings (SPEC §7.1)", () => {
  test("W-SECTION-UNREACHED: a section no path reaches, at its heading", () => {
    expect(warnings(prog([stop(11)], { "s:lost": section(20, [stop(21)]) }))).toEqual([E("W-SECTION-UNREACHED", 20)]);
  });

  test("W-ASK-NO-CONTEXT: an ask naming no run output", () => {
    const p = prog([ask(11, [lit("Is "), v("mount"), lit(" full?")], yesno()), stop(12)], {}, { mount: { str: "/", src: 3 } });
    expect(warnings(p)).toEqual([E("W-ASK-NO-CONTEXT", 11)]);
  });

  test("an ask naming a run output that may be unbound has context", () => {
    expect(warnings(prog([run(11, DF, "x", skip), ask(12, [lit("Is "), v("x"), lit(" bad?")], yesno()), stop(13)]))).toEqual([]);
  });

  test("W-NO-GUIDANCE: a section offered as an option with no guidance, at its heading", () => {
    const p = prog([run(11, DF, "used"), ask(12, [v("used")], options([13, "s:b"], [14, "s:c"]))], {
      "s:b": section(30, [stop(31)], null),
      "s:c": section(40, [stop(41)]),
    });
    expect(warnings(p)).toEqual([E("W-NO-GUIDANCE", 30)]);
  });

  test("a section without guidance that isn't an option is fine", () => {
    expect(warnings(prog([then(11, "s:b")], { "s:b": section(20, [stop(21)], null) }))).toEqual([]);
  });

  const sev = (after: J[], more: Record<string, J> = {}) =>
    prog(
      [
        run(11, DF, "errors"),
        ask(
          12,
          [v("errors")],
          score(1, 3, [
            [13, 1],
            [14, 2],
            [15, 3],
          ]),
        ),
        ...after,
      ],
      more,
    );

  test("W-SCORE-UNUSED: a Score variable never used after it's bound", () => {
    expect(warnings(sev([stop(16)]))).toEqual([E("W-SCORE-UNUSED", 12)]);
  });

  test("W-SCORE-THRESHOLD: a Score used in one >= check", () => {
    expect(
      warnings(sev([cmp(16, v("sev"), ">=", { num: "3" }, ref("s:page")), stop(17)], { "s:page": section(20, [page(21, [lit("!")])]) })),
    ).toEqual([E("W-SCORE-THRESHOLD", 12)]);
  });

  test("a Score used in a later section counts as used", () => {
    const more = { "s:page": section(20, [page(21, [lit("rated "), v("sev")])]) };
    expect(warnings(sev([then(16, "s:page")], more))).toEqual([]);
  });

  test("a Score used in two checks gets no warning", () => {
    const more = { "s:page": section(20, [page(21, [lit("!")])]) };
    expect(
      warnings(sev([cmp(16, v("sev"), "<=", { num: "1" }), cmp(17, v("sev"), "==", { num: "2" }, ref("s:page")), stop(18)], more)),
    ).toEqual([]);
  });
});
