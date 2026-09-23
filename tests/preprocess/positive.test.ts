// Positive parse-stage cases (SPEC §12.2, §3.2, §3.3).

import { describe, expect, test } from "vitest";
import type { CoreProgram, Section } from "../../src/contracts.gen.js";
import { preprocess } from "../../src/preprocess/index.js";
import { skillMd } from "./helpers.js";

function program(md: string): CoreProgram {
  const result = preprocess(md, "test.md");
  if ("errors" in result) throw new Error(`expected a program, got errors: ${JSON.stringify(result.errors, null, 2)}`);
  return result.program;
}

describe("**Note:** and mid-paragraph **run** are prose", () => {
  test("- **Note:** ... and - **Warning**: ... in an instruction list are prose (no statement, no error)", () => {
    const md = skillMd("## Triage", "- **Note:** see below", "- **Warning**: careful", "- **run** `df -h` as used", "- **stop**");
    const p = program(md);
    const body = (p.sections["s:triage"] as Section).body;
    expect(body).toHaveLength(2); // run, stop only; the two prose items produced no statement
    expect(body[0]).toMatchObject({ run: { as: "used" } });
    expect(body[1]).toMatchObject({ stop: {} });
  });

  test("**run** in the middle of a paragraph is prose", () => {
    const md = skillMd("## Triage", "Don't **run** certbot with --force; it burns rate limits.", "", "- **stop**");
    const p = program(md);
    expect((p.sections["s:triage"] as Section).body).toEqual([{ src: expect.any(Number), stop: {} }]);
  });
});

describe("prose-only sections are fine", () => {
  test("## Background with only paragraphs lints as an other-section with no lists", () => {
    const md = skillMd("## Background", "Just some context for a human reader.", "", "## Triage", "- **stop**");
    const p = program(md);
    expect(p.sections["s:background"]).toEqual({ name: "Background", src: 6, lists: [] });
  });
});

describe("lists under ### headings run in document order", () => {
  test("two lists split by a ### heading form one sequence", () => {
    const md = skillMd("## Triage", "### First", "- **run** `echo 1` as a", "### Second", "- **run** `echo 2` as b", "- **stop**");
    const p = program(md);
    const body = (p.sections["s:triage"] as Section).body;
    expect(body).toHaveLength(3);
    expect(body[0]).toMatchObject({ run: { as: "a" } });
    expect(body[1]).toMatchObject({ run: { as: "b" } });
    expect(body[2]).toMatchObject({ stop: {} });
  });
});

describe("nested for each", () => {
  test("a for each inside a for each lints", () => {
    const md = skillMd(
      "## Triage",
      "- **for each** x in [Items]",
      "  - **for each** y in [Items]",
      "    - **run** `echo {x}{y}` as r",
      "- **stop**",
      "",
      "## Items",
      "- a",
      "- b",
    );
    const p = program(md);
    const body = (p.sections["s:triage"] as Section).body;
    const outer = body[0] as any;
    expect(outer.for_each.var).toBe("x");
    const inner = outer.for_each.body[0];
    expect(inner.for_each.var).toBe("y");
    expect(inner.for_each.body[0]).toMatchObject({ run: { as: "r" } });
  });
});

describe("a numbered data list works", () => {
  test("1. 2. 3. parses the same as a bulleted list", () => {
    const md = skillMd(
      "## Cleanups",
      "1. Vacuum — `vacuum`",
      "2. Clear cache — `clean`",
      "",
      "## Triage",
      "- **for each** x in [Cleanups]",
      "  - **do** x",
      "- **stop**",
    );
    const p = program(md);
    const cleanups = p.sections["s:cleanups"] as any;
    expect(cleanups.lists).toHaveLength(1);
    expect(cleanups.lists[0].items).toEqual([
      { src: 7, action: { label: "Vacuum", cmd: [{ lit: "vacuum" }] } },
      { src: 8, action: { label: "Clear cache", cmd: [{ lit: "clean" }] } },
    ]);
  });
});

describe("a section ending in **stop** lints", () => {
  test("stop needs no target and parses cleanly", () => {
    const md = skillMd("## Triage", "- **run** `df -h` as used", "- **stop**");
    const p = program(md);
    expect((p.sections["s:triage"] as Section).body.at(-1)).toEqual({ src: 8, stop: {} });
  });
});

describe("an instruction after check … → stop is reachable", () => {
  test("a false check falls through to the next instruction", () => {
    const md = skillMd("## Triage", "- **check** {x} == 1 → stop", "- **run** `df -h` as used", "- **stop**");
    const p = program(md);
    expect((p.sections["s:triage"] as Section).body).toHaveLength(3);
  });
});

describe("default entry", () => {
  test("defaults to the first instruction section, at its heading line", () => {
    const md = skillMd("## Background", "Just prose.", "", "## Triage", "- **stop**");
    const p = program(md);
    expect(p.entry).toEqual({ section: "s:triage", src: 9 });
  });
});

describe("a link's anchor is checked against the heading it resolves to (SPEC §3.4)", () => {
  const thenRef = (md: string) => ((program(md).sections["s:triage"] as Section).body[0] as { then: unknown }).then;

  test("[Clean_Up](#clean-up) resolves to ## Clean up, so expected is that heading's slug", () => {
    const md = skillMd("## Triage", "- **then** [Clean_Up](#clean-up)", "", "## Clean up", "- **stop**");
    expect(thenRef(md)).toEqual({ section: "s:clean_up", anchor: { given: "clean-up", expected: "clean-up" } });
  });

  test("a wrong anchor keeps what was written, so the core reports E-UNRESOLVED", () => {
    const md = skillMd("## Triage", "- **then** [Clean up](#cleanup)", "", "## Clean up", "- **stop**");
    expect(thenRef(md)).toEqual({ section: "s:clean_up", anchor: { given: "cleanup", expected: "clean-up" } });
  });

  test("a link to no section keeps the slug of its own text", () => {
    const md = skillMd("## Triage", "- **then** [Nowhere Else](#nowhere-else)", "", "## Clean up", "- **stop**");
    expect(thenRef(md)).toEqual({ section: "s:nowhere_else", anchor: { given: "nowhere-else", expected: "nowhere-else" } });
  });
});
