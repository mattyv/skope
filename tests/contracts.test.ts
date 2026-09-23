// Contracts (PLAN.md §3): every example validates, and the schema rejects
// malformed programs, so it can't pass by accepting everything.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020").default;
const read = (p: string) => JSON.parse(readFileSync(new URL(`../contracts/${p}`, import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
for (const f of ["core-program", "ask", "fakes", "event"]) ajv.addSchema(read(`${f}.schema.json`));
const schema = (f: string, def = "") => {
  const v = ajv.getSchema(`https://github.com/mattyv/skop/contracts/${f}.schema.json${def}`);
  if (!v) throw new Error(`no schema ${f}${def}`);
  return v;
};
const validate = schema("core-program");

describe("core program schema (SPEC §5.1)", () => {
  for (const name of ["disk-full", "cert-expiry", "error-triage"]) {
    test(`${name} example is valid`, () => {
      expect(validate(read(`examples/${name}.core.json`)), JSON.stringify(validate.errors)).toBe(true);
    });
  }

  // Each case breaks the disk-full example in one way.
  const base = () => read("examples/disk-full.core.json");
  const triage = (p: any) => p.sections["s:triage"].body;
  const broken: [string, (p: any) => void][] = [
    ["an unknown statement", (p) => triage(p).push({ src: 99, frobnicate: {} })],
    ["an ask with two forms", (p) => (triage(p)[4].ask.yesno = { as: "_yn" })],
    ["an ask with no form", (p) => delete triage(p)[4].ask.sections],
    ["a section id without the s: prefix", (p) => (p.entry = "triage")],
    ["an if_yes with both run and do", (p) => (p.sections["s:clean_up"].body[0].for_each.body[1].if_yes.run = { cmd: [] })],
    ["a run with no else", (p) => delete triage(p)[0].else],
    ["a src of zero", (p) => (triage(p)[0].src = 0)],
    ["a percent sign left on a number", (p) => (triage(p)[1].check.cond.cmp.r = { num: "85%" })],
    ["a sure above 100", (p) => (triage(p)[4].ask.sure = 101)],
    ["a format other than 1", (p) => (p.format = 2)],
  ];
  for (const [what, breakIt] of broken) {
    test(`rejects ${what}`, () => {
      const p = base();
      breakIt(p);
      expect(validate(p)).toBe(false);
    });
  }
});

describe("error-code contract (SPEC §7.1)", () => {
  test("every code has a stage and a meaning", () => {
    const codes: { code: string; stage: string; meaning: string }[] = read("error-codes.json");
    expect(codes.length).toBeGreaterThan(40);
    for (const c of codes) {
      expect(c.code).toMatch(/^[EW]-[A-Z-]+$/);
      expect(["parse", "lint", "args", "runtime", "warning"]).toContain(c.stage);
      expect(c.meaning.length).toBeGreaterThan(0);
    }
  });
});

describe("the spike example is a valid core program section", () => {
  test("spike-program.json matches the section definition", () => {
    const section = schema("core-program", "#/$defs/section");
    expect(section(read("examples/spike-program.json")), JSON.stringify(section.errors)).toBe(true);
  });
});

describe("backend request and answer (SPEC §6.1)", () => {
  const request = schema("ask", "#/$defs/request");
  const answer = schema("ask", "#/$defs/answer");
  const req = {
    kind: "choice",
    question: "Given `used`, what's the best next step?",
    guidance: null,
    options: [
      { id: "s:clean_up", label: "Clean up", description: "Run cleanups least risky first." },
      { id: "s:page", label: "Page", description: null },
    ],
    context: { used: "91%" },
    timeout_ms: 2000,
  };

  test("the spec's request and answer shapes are valid", () => {
    expect(request(req)).toBe(true);
    expect(answer({ probs: { "s:clean_up": 0.82, "s:page": 0.18 }, backend: "jev", model: "jev-1.13.0", ms: 94 })).toBe(true);
    expect(answer({ probs: { A: 0.5 }, unassigned: 0.3, backend: "openrouter", model: "m", ms: 3 })).toBe(true);
  });

  test("an out-of-range answer still fits the contract, so the core can reject it (P5)", () => {
    expect(answer({ probs: { yes: 1.1, no: -0.1 }, backend: "jev", model: "m", ms: 1 })).toBe(true);
  });

  test("malformed shapes are rejected", () => {
    expect(request({ ...req, kind: "multi" })).toBe(false);
    expect(request({ ...req, options: [req.options[0]] })).toBe(false);
    expect(request({ ...req, context: { used: 91 } })).toBe(false);
    expect(answer({ probs: { yes: "high" }, backend: "jev", model: "m", ms: 1 })).toBe(false);
    expect(answer({ probs: {}, backend: "jev", model: "m" })).toBe(false);
  });
});

describe("fake files (SPEC §5.4, §6.2)", () => {
  const answers = schema("fakes", "#/$defs/answers");
  const commands = schema("fakes", "#/$defs/commands");

  test("valid answers and commands", () => {
    expect(answers({ "line:27": { "s:clean_up": 0.9, "s:page": 0.1 }, "Is it worth it?": "unsure", "line:46": "unavailable" })).toBe(true);
    expect(commands({ "df -h": { exit: 0, stdout: "91%" }, "line:47": { exit: null, timed_out: true } })).toBe(true);
  });

  test("malformed fakes are rejected", () => {
    expect(answers({ q: "maybe" })).toBe(false);
    expect(answers({ q: {} })).toBe(false);
    expect(commands({ "df -h": { stdout: "91%" } })).toBe(false);
    expect(commands({ "df -h": { exit: 0, colour: "red" } })).toBe(false);
  });
});

describe("log events (SPEC §10)", () => {
  const event = schema("event");
  const base = { ts: "2026-09-23T10:00:00Z", run_id: "r-1", skill: "disk-full", skill_hash: `sha256:${"a".repeat(64)}`, host: "h" };

  test("valid events", () => {
    expect(event({ ...base, event: "would_do", section: "Clean up", line: 38, cmd: "apt-get clean" })).toBe(true);
    expect(event({ ...base, event: "effect_end", cmd: "x", exit: null, ms: 30000, timed_out: true })).toBe(true);
    expect(event({ ...base, event: "error", code: "E-TAINT", stage: "lint", file: "SKILL.md", line: 14, message: "…" })).toBe(true);
  });

  test("unknown events, missing fields and stray fields are rejected", () => {
    expect(event({ ...base, event: "ran", cmd: "x" })).toBe(false);
    expect(event({ ...base, event: "effect_end", cmd: "x" })).toBe(false);
    expect(event({ ...base, event: "would_do", cmd: "x", bogus: 1 })).toBe(false);
    expect(event({ ...base, event: "error", code: "W-NOPE", stage: "lint", message: "m" })).toBe(false);
    expect(event({ ...base, ts: "yesterday", event: "would_do", cmd: "x" })).toBe(false);
  });
});
