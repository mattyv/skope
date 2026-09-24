// src/ast.ts: core program JSON to Dafny's SkopeAst and back, exactly.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { fromAst, toAst } from "../src/ast.js";
import { Unsupported } from "../src/core.js";

const example = (name: string) => JSON.parse(readFileSync(new URL(`../contracts/examples/${name}.core.json`, import.meta.url), "utf8"));
const lit = (s: string) => [{ lit: s }];

// One of every statement, else, target, condition, ask form and item kind.
const everything = {
  skill: "all",
  format: 1,
  entry: { section: "s:main", src: 5 },
  params: { a: { str: "x", src: 2 }, n: { int: -3, src: 3 } },
  limits: { run_timeout_ms: 1, do_timeout_ms: 2, deadline_ms: 3, ask_context_tokens: 4 },
  sections: {
    "s:main": {
      name: "Main",
      src: 5,
      guidance: "Do things.",
      body: [
        { src: 6, run: { cmd: [{ lit: "df " }, { var: "a" }], as: "used" }, else: { skip: {} } },
        { src: 7, run: { cmd: lit("true") }, else: { section: "s:other", anchor: { given: "other", expected: "other" } } },
        { src: 8, do: { cmd: lit("rm x") }, else: null },
        { src: 9, check: { cond: { cmp: { op: "<=", l: { var: "used" }, r: { num: "85" } } }, then: { stop: {} }, else: null } },
        { src: 10, check: { cond: { succeeds: lit("test -f y") }, then: null, else: { section: "s:other" } } },
        {
          src: 11,
          ask: {
            question: lit("Which?"),
            sure: 85,
            else: null,
            sections: [
              { src: 12, section: "s:other" },
              { src: 13, section: "s:main" },
            ],
          },
        },
        { src: 14, ask: { question: lit("Ok?"), sure: 0, else: { skip: {} }, yesno: { as: "_yn" } } },
        { src: 15, if_yes: { run: { cmd: lit("echo yes") }, else: null } },
        { src: 16, if_yes: { do: { item: "step" }, else: { skip: {} } } },
        { src: 17, ask: { question: lit("Pick"), sure: 100, else: null, one_of: { list: { section: "s:list" }, as: "svc" } } },
        {
          src: 18,
          ask: {
            question: [{ lit: "How bad is " }, { var: "used" }, { lit: "?" }],
            sure: 40,
            else: null,
            score: {
              low: 1,
              high: 2,
              rubric: [
                { src: 19, level: 1, text: "fine" },
                { src: 20, level: 2, text: "bad" },
              ],
              as: "sev",
            },
          },
        },
        { src: 21, for_each: { var: "step", list: { section: "s:list" }, body: [{ src: 22, do: { item: "step" }, else: null }] } },
        { src: 23, page: [{ lit: "help " }, { var: "a" }] },
        { src: 24, then: { section: "s:other" } },
        { src: 25, hand_off: {} },
        { src: 26, stop: {} },
      ],
    },
    "s:other": { name: "Other", src: 30, guidance: null, body: [{ src: 31, stop: {} }] },
    "s:list": {
      name: "List",
      src: 40,
      lists: [
        {
          src: 41,
          items: [
            { src: 41, value: "nginx" },
            { src: 42, action: { label: "Clean", cmd: lit("apt-get clean") } },
          ],
        },
      ],
    },
    "s:notes": { name: "Notes", src: 50, lists: [] },
  },
};

describe("core program JSON round-trips through SkopeAst exactly", () => {
  for (const name of ["disk-full", "cert-expiry", "error-triage"]) {
    test(name, () => {
      const p = example(name);
      expect(fromAst(toAst(p))).toEqual(p);
    });
  }

  test("every statement, else, target, condition, ask form and item kind", () => {
    expect(fromAst(toAst(everything))).toEqual(everything);
  });

  test("a comparison keeps its operator", () => {
    for (const op of ["<", "<=", ">", ">=", "==", "!="]) {
      const p = structuredClone(everything);
      p.sections["s:main"].body[3] = {
        src: 9,
        check: { cond: { cmp: { op, l: { var: "x" }, r: { num: "1" } } }, then: { stop: {} }, else: null },
      };
      expect(fromAst(toAst(p))).toEqual(p);
    }
  });
});

describe("toAst refuses what the contract doesn't allow, never rewriting it", () => {
  const body = (s: unknown) => {
    const p = structuredClone(everything) as { sections: Record<string, { body?: unknown[] }> };
    (p.sections["s:other"] as { body: unknown[] }).body = [s, { src: 99, stop: {} }];
    return p;
  };
  const refuse: [string, unknown][] = [
    ["an unknown top-level field", { ...everything, extra: 1 }],
    ["format 2", { ...everything, format: 2 }],
    ["a statement with an unknown field", body({ src: 1, stop: {}, x: 1 })],
    ["a statement with two kinds", body({ src: 1, stop: {}, hand_off: {} })],
    ["a run without its else", body({ src: 1, run: { cmd: lit("x") } })],
    ["a check with an else outside it", body({ src: 1, check: { cond: { succeeds: lit("x") }, then: null, else: null }, else: null })],
    ["a part with a literal and a variable", body({ src: 1, run: { cmd: [{ lit: "a", var: "b" }] }, else: null })],
    [
      "an ask with two forms",
      body({
        src: 1,
        ask: { question: lit("q"), sure: 1, else: null, yesno: { as: "_yn" }, one_of: { list: { section: "s:list" }, as: "x" } },
      }),
    ],
    ["an ask with no form", body({ src: 1, ask: { question: lit("q"), sure: 1, else: null } })],
    ["sure over 100", body({ src: 1, ask: { question: lit("q"), sure: 101, else: null, yesno: { as: "_yn" } } })],
    [
      "an unknown comparison",
      body({ src: 1, check: { cond: { cmp: { op: "=~", l: { num: "1" }, r: { num: "1" } } }, then: { stop: {} }, else: null } }),
    ],
    ["an if_yes with both run and do", body({ src: 1, if_yes: { run: { cmd: lit("x") }, do: { item: "s" }, else: null } })],
    ["a stop with fields", body({ src: 1, stop: { now: true } })],
    ["a skip else with fields", body({ src: 1, run: { cmd: lit("x") }, else: { skip: { x: 1 } } })],
    ["a check with neither target nor else (E-GRAMMAR)", body({ src: 1, check: { cond: { succeeds: lit("x") }, then: null, else: null } })],
    ["a variable that isn't a NAME", body({ src: 1, run: { cmd: [{ var: "Bad-name" }] }, else: null })],
    ["a run binding that isn't a NAME", body({ src: 1, run: { cmd: lit("x"), as: "1x" }, else: null })],
    ["a loop variable that isn't a NAME", body({ src: 1, for_each: { var: "", list: { section: "s:list" }, body: [] } })],
    ["a do item that isn't a NAME", body({ src: 1, do: { item: "Step" }, else: null })],
    [
      "an operand that isn't a NAME",
      body({ src: 1, check: { cond: { cmp: { op: "<", l: { var: "a b" }, r: { num: "1" } } }, then: { stop: {} }, else: null } }),
    ],
    ["a yes/no binding that isn't a NAME", body({ src: 1, ask: { question: lit("q"), sure: 1, else: null, yesno: { as: "OK" } } })],
    ["a param that isn't a NAME", { ...everything, params: { "Mount-Point": { str: "/", src: 1 } } }],
    ["a negative src", body({ src: -1, stop: {} })],
    ["a fractional src", body({ src: 1.5, stop: {} })],
    ["an unsafe integer param", { ...everything, params: { n: { int: 2 ** 60, src: 1 } } }],
    ["a lone surrogate", body({ src: 1, run: { cmd: lit("echo \ud800") }, else: null })],
    [
      "a list item with two kinds",
      {
        ...everything,
        sections: {
          ...everything.sections,
          "s:l": { name: "L", src: 1, lists: [{ src: 1, items: [{ src: 1, value: "a", action: { label: "b", cmd: lit("c") } }] }] },
        },
      },
    ],
  ];
  for (const [what, p] of refuse) {
    test(what, () => {
      expect(() => toAst(p)).toThrow(Unsupported);
    });
  }
});
