// Fuzz test (PLAN §4 A): whatever the input, the preprocessor returns errors
// or a program, never E-INTERNAL (its catch-all for a crash), and every
// program it returns is valid against contracts/core-program.schema.json.
// Deterministic seed, bounded iterations, fast.

import { describe, expect, test } from "vitest";
import { preprocess } from "../../src/preprocess/index.js";
import { FRONTMATTER, schemaErrors } from "./helpers.js";

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// A mix of raw bytes and Markdown-flavoured tokens, so fuzzing exercises
// more than just "not valid YAML".
const TOKENS = [
  "---",
  "name: x",
  "format: 1",
  "description: y",
  "params:\n  a: 1",
  "limits:\n  run_timeout: 0s",
  "entry: x",
  "##",
  "###",
  "## Triage",
  "## Items",
  "## 🔥",
  "Setext\n---",
  "-",
  "*",
  "+",
  "1.",
  "1)",
  "**run**",
  "__run__",
  "**run**:",
  "**Stop:**",
  "**do**",
  "**check**",
  "**ask**",
  "**for each**",
  "**if yes**",
  "**then**",
  "**page**",
  "**hand off**",
  "**stop**",
  "**rn**",
  "`cmd`",
  "``a ` b``",
  "[Section]",
  "[Triage]",
  "[Items]",
  "[🔥]",
  "(#anchor)",
  "→",
  "->",
  "·",
  "· sure 50%",
  "· sure 101%",
  "· else skip",
  "yes | no",
  "one of [Items] as v",
  "1 to 3 as s",
  "1: a",
  "{x} < 1",
  "{name}",
  "`x` succeeds",
  '"page {host}"',
  ">",
  "> >",
  "```",
  "~~~",
  "<!--",
  "-->",
  "<details>",
  "\n",
  "\r\n",
  "\r",
  "\t",
  "  ",
  "    ",
  "\\",
  "\0",
  "💥",
  "99999999999999999999",
  "__proto__",
  String.fromCharCode(0x2028), // line separator, an easy source of off-by-ones
];

function randomDoc(rand: () => number): string {
  const n = Math.floor(rand() * 60);
  let out = "";
  for (let i = 0; i < n; i++) {
    out += TOKENS[Math.floor(rand() * TOKENS.length)];
    if (rand() < 0.3) out += " ";
    if (rand() < 0.2) out += "\n";
  }
  return out;
}

function check(md: string): void {
  const result = preprocess(md);
  if ("errors" in result) {
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.filter((e) => e.code === "E-INTERNAL")).toEqual([]);
    for (const e of result.errors) expect(Number.isInteger(e.line) && e.line >= 1).toBe(true);
  } else {
    expect(schemaErrors(result.program)).toBeNull();
  }
}

describe("fuzz: no E-INTERNAL, and every program is schema-valid", () => {
  const rand = lcg(0xf00d);
  for (let i = 0; i < 300; i++) {
    const md = randomDoc(rand);
    test(`raw case ${i} (len ${md.length})`, () => check(md));
  }

  let programs = 0;
  for (let i = 0; i < 700; i++) {
    const md = `${FRONTMATTER}\n${randomDoc(rand)}`;
    test(`body case ${i} (len ${md.length})`, () => {
      check(md);
      if ("program" in preprocess(md)) programs++;
    });
  }

  test("the body cases include programs, so the schema check isn't vacuous", () => {
    expect(programs).toBeGreaterThan(20);
  });

  test("empty and whitespace-only input", () => {
    for (const md of ["", " ", "\n", "\n\n\n", "\t\t", "\r\n", "﻿"]) check(md);
  });
});
