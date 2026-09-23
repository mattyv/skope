// Contracts (PLAN.md §3): every example validates, and the schema rejects
// malformed programs, so it can't pass by accepting everything.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020").default;
const read = (p: string) => JSON.parse(readFileSync(new URL(`../contracts/${p}`, import.meta.url), "utf8"));
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(read("core-program.schema.json"));

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
