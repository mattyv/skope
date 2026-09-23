// Property test (PLAN §4 A): for any generated Markdown, a list item that
// starts with a bold keyword parses as an instruction or produces an error,
// never prose. That's the core safety property of the surface format
// (SPEC §3.3 rule 4: "Never fall back to treating it as prose").
//
// Known spec tension, not something to silently "fix" here: SPEC §3.3 rule 3
// says a bold span ending in ':' (inside or right after the `**`) is always
// prose, *before* the keyword check runs — so `**run**:x` (a real keyword
// immediately followed by a colon) is prose by the letter of rule 3, which
// is in tension with this very safety property. The generator below avoids
// producing that byte (no ':' right after the closing `**`) so it tests the
// property as intended rather than tripping over that edge; see the final
// report for the spec citation.

import { describe, expect, test } from "vitest";
import { preprocess } from "../../src/preprocess/index.js";
import { FRONTMATTER } from "./helpers.js";

const KEYWORDS = ["run", "do", "check", "ask", "for each", "if yes", "then", "page", "hand off", "stop"];
// No ':' (see the tension noted above) and no newline (a suffix is always one line).
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789 `[]{}()·→"_.,%=<>|-'.split("");

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomSuffix(rand: () => number, maxLen: number): string {
  const len = Math.floor(rand() * maxLen);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return out;
}

describe("property: a bold-keyword list item never comes out as prose", () => {
  const rand = lcg(20260923);
  for (let i = 0; i < 300; i++) {
    const kw = KEYWORDS[Math.floor(rand() * KEYWORDS.length)] as string;
    const suffix = randomSuffix(rand, 24);
    test(`case ${i}: **${kw}**${JSON.stringify(suffix)}`, () => {
      const item = `- **${kw}**${suffix}`;
      const md = [FRONTMATTER, "", "## Triage", item, ""].join("\n");
      const itemLine = md.split("\n").indexOf(item) + 1; // 1-based
      const result = preprocess(md, "test.md");
      if ("errors" in result) {
        expect(result.errors.some((e) => e.line === itemLine)).toBe(true);
      } else {
        const stmts = Object.values(result.program.sections).flatMap((s) => ("body" in s ? s.body : []));
        expect(stmts.some((s) => s.src === itemLine)).toBe(true);
      }
    });
  }
});
