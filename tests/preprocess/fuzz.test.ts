// Fuzz test (PLAN §4 A): the preprocessor never throws, whatever the input.
// Deterministic seed, bounded iterations, fast.

import { describe, expect, test } from "vitest";
import { preprocess } from "../../src/preprocess/index.js";
import { FRONTMATTER } from "./helpers.js";

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
  "##",
  "###",
  "-",
  "*",
  "1.",
  "**run**",
  "**do**",
  "**check**",
  "**ask**",
  "**for each**",
  "`cmd`",
  "[Section]",
  "(#anchor)",
  "→",
  "->",
  "·",
  "· sure 50%",
  "· else skip",
  "yes | no",
  ">",
  "\n",
  "  ",
  "{name}",
  "\0",
  "💥",
  String.fromCharCode(0x2028), // line separator, an easy source of off-by-ones
];

function randomDoc(rand: () => number): string {
  const n = Math.floor(rand() * 40);
  let out = "";
  for (let i = 0; i < n; i++) {
    out += TOKENS[Math.floor(rand() * TOKENS.length)];
    if (rand() < 0.3) out += " ";
    if (rand() < 0.2) out += "\n";
  }
  return out;
}

describe("fuzz: preprocess never throws", () => {
  const rand = lcg(0xf00d);
  for (let i = 0; i < 500; i++) {
    const md = randomDoc(rand);
    test(`case ${i} (len ${md.length})`, () => {
      expect(() => preprocess(md, "fuzz.md")).not.toThrow();
      const result = preprocess(md, "fuzz.md");
      expect("program" in result || "errors" in result).toBe(true);
    });
  }

  test("valid frontmatter followed by pure noise", () => {
    for (let i = 0; i < 50; i++) {
      const noise = randomDoc(rand);
      const md = `${FRONTMATTER}\n${noise}`;
      expect(() => preprocess(md, "fuzz.md")).not.toThrow();
    }
  });

  test("empty and whitespace-only input", () => {
    for (const md of ["", " ", "\n", "\n\n\n", "\t\t"]) {
      expect(() => preprocess(md, "fuzz.md")).not.toThrow();
    }
  });
});
