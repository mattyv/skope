// Property test (PLAN §4 A): a list item that starts with a bold keyword is
// an instruction or an error, never prose, wherever it sits (SPEC §3.3 rules
// 3, 4 and 7). The keyword item goes in every kind of place: after prose
// items, in a second list, nested under prose, option and data
// items, in blockquotes of depth 1-3, before the first section, in a data
// section, and in a for-each body. Its suffix may contain `:`, `\r` and `\t`.

import { describe, expect, test } from "vitest";
import { preprocess } from "../../src/preprocess/index.js";
import { FRONTMATTER, schemaErrors, stmtLines } from "./helpers.js";

const KEYWORDS = ["run", "do", "check", "ask", "for each", "if yes", "then", "page", "hand off", "stop"];
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789 `[]{}()·→"_.,%=<>|-:\r\t*#'.split("");

// Each context is body lines with one `%K%`, where the keyword item's text goes.
const CONTEXTS: Record<string, string[]> = {
  "after prose items": ["## Triage", "- look first", "- then think", "- %K%", "- **stop**"],
  "in a second list": ["## Triage", "- **run** `df`", "", "Then:", "", "* %K%", "", "- **stop**"],
  "nested under a prose item": ["## Triage", "- a note", "  - %K%", "- **stop**"],
  "nested under an option item": [
    "## Triage",
    "- **ask** Pick · sure 80%",
    "  - [Page]",
    "    - %K%",
    "  - [Triage]",
    "",
    "## Page",
    "- **stop**",
  ],
  "as an option item": ["## Triage", "- **ask** Pick · sure 80%", "  - [Page]", "  - %K%", "", "## Page", "- **stop**"],
  "nested under a data item": [
    "## Triage",
    "- **for each** s in [Items]",
    "  - **run** `echo {s}`",
    "- **stop**",
    "",
    "## Items",
    "- a",
    "  - %K%",
  ],
  "in a data section": ["## Triage", "- **for each** s in [Items]", "  - **run** `echo {s}`", "- **stop**", "", "## Items", "- a", "- %K%"],
  "in a for-each body": ["## Triage", "- **for each** s in [Items]", "  - %K%", "- **stop**", "", "## Items", "- a"],
  "in a blockquote": ["## Triage", "> - %K%", "", "- **stop**"],
  "in a depth-2 blockquote": ["## Triage", "> > - %K%", "", "- **stop**"],
  "in a depth-3 blockquote": ["## Triage", "> text", "> > > * %K%", "", "- **stop**"],
  "before the first section": ["# Title", "", "1. %K%", "", "## Triage", "- **stop**"],
};

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const pick = <T>(rand: () => number, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;

function keywordItem(rand: () => number): string {
  const kw = pick(rand, KEYWORDS);
  const cased = rand() < 0.3 ? kw.toUpperCase() : rand() < 0.5 ? kw[0]?.toUpperCase() + kw.slice(1) : kw;
  const delim = rand() < 0.2 ? "__" : "**";
  const inner = rand() < 0.15 ? `${cased}:` : cased;
  let suffix = rand() < 0.15 ? ":" : "";
  const len = Math.floor(rand() * 24);
  for (let i = 0; i < len; i++) suffix += pick(rand, ALPHABET);
  return `${delim}${inner}${delim}${suffix}`;
}

describe("the contexts are valid skills without the keyword item", () => {
  for (const [name, lines] of Object.entries(CONTEXTS)) {
    test(name, () => {
      const md = [FRONTMATTER, ...lines.filter((l) => !l.includes("%K%"))].join("\n");
      expect(preprocess(md)).toHaveProperty("program");
    });
  }
});

describe("property: a bold-keyword list item is an instruction or an error, never prose", () => {
  const rand = lcg(20260923);
  const names = Object.keys(CONTEXTS);
  for (let i = 0; i < 600; i++) {
    const where = pick(rand, names);
    const item = keywordItem(rand);
    test(`case ${i}, ${where}: ${JSON.stringify(item)}`, () => {
      const lines = [FRONTMATTER, ...(CONTEXTS[where] as string[])];
      const at = lines.findIndex((l) => l.includes("%K%"));
      lines[at] = (lines[at] as string).replace("%K%", item);
      const itemLine = FRONTMATTER.split("\n").length + at; // 1-based: FRONTMATTER is one element of `lines`
      const extraLines = (item.match(/\r/g) ?? []).length; // a \r in the suffix starts a new line
      const result = preprocess(lines.join("\n"));
      if ("errors" in result) {
        expect(result.errors.map((e) => e.code)).not.toContain("E-INTERNAL");
        expect(result.errors.some((e) => e.line >= itemLine && e.line <= itemLine + extraLines)).toBe(true);
      } else {
        expect(schemaErrors(result.program)).toBeNull();
        expect(stmtLines(result.program)).toContain(itemLine);
      }
    });
  }
});
