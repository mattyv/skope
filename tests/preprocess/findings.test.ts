// Regression tests for the preprocessor review (P1-1 … P2-11 and nits). Each
// finding's case failed before the fix. Tests match on code and line (SPEC
// §7.1); only the E-UNKNOWN-BOLD suggestion checks message text, because the
// suggestion is the feature.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { CoreProgram, Section } from "../../src/contracts.gen.js";
import { preprocess } from "../../src/preprocess/index.js";
import { BODY_START as B, FRONTMATTER, skillMd } from "./helpers.js";

function program(md: string): CoreProgram {
  const result = preprocess(md);
  if ("errors" in result) throw new Error(`expected a program, got errors: ${JSON.stringify(result.errors, null, 2)}`);
  return result.program;
}
function errs(md: string): { code: string; line: number }[] {
  const result = preprocess(md);
  if (!("errors" in result)) throw new Error(`expected errors, got a program: ${JSON.stringify(result.program)}`);
  return result.errors.map(({ code, line }) => ({ code, line }));
}
const body = (md: string, id = "s:triage") => (program(md).sections[id] as Section).body;
const stmtKinds = (md: string, id = "s:triage") => body(md, id).map((s) => Object.keys(s).find((k) => k !== "src" && k !== "else"));
const withFm = (fm: string[], ...lines: string[]) => ["---", ...fm, "---", ...lines].join("\n");

describe("P1-1: a keyword with a colon is still a keyword (instruction or E-GRAMMAR, never prose)", () => {
  for (const item of ["- **run**: df", "- **run**:do", "- **run:** `df`", "- **Stop**:", "- **stop:**", "- **run**: `df -h`"]) {
    test(`${item} is E-GRAMMAR`, () => {
      expect(errs(skillMd("## Triage", item, "- **stop**"))).toEqual([{ code: "E-GRAMMAR", line: B + 1 }]);
    });
  }
  test("> - **run**: x is E-MISPLACED", () => {
    expect(errs(skillMd("## Triage", "> - **run**: x", "", "- **stop**"))).toEqual([{ code: "E-MISPLACED", line: B + 1 }]);
  });
  test("a keyword with a colon in a list before the first section is E-MISPLACED", () => {
    expect(errs(skillMd("- **Stop:** now", "", "## Triage", "- **stop**"))).toEqual([{ code: "E-MISPLACED", line: B }]);
  });
  test("**Note**: and **Note:** are still prose", () => {
    expect(stmtKinds(skillMd("## Triage", "- **Note**: x", "- **Note:** y", "- **stop**"))).toEqual(["stop"]);
  });
});

describe("P1-2: a section is an instruction section if any top-level item is a keyword", () => {
  test("a prose item before the first instruction", () => {
    const md = skillMd("## Triage", "- Look at the dashboard first", "- **run** `df -h`", "- **stop**");
    expect(stmtKinds(md)).toEqual(["run", "stop"]);
  });
  test("an instruction in a second list, after a paragraph", () => {
    const md = skillMd("## Triage", "- Look first", "", "Then:", "", "* **stop**");
    expect(stmtKinds(md)).toEqual(["stop"]);
  });
  test("**Important:** doesn't make a section an instruction section, or the default entry", () => {
    const md = skillMd("## Background", "- **Important:** read this", "", "## Triage", "- **stop**");
    const p = program(md);
    expect(p.entry).toEqual({ section: "s:triage", src: B + 3 });
    expect(p.sections["s:background"]).toEqual({ name: "Background", src: B, lists: [] });
  });
});

describe("P1-3: only sections used as lists are held to the data-item forms", () => {
  test("a prose section's list of links and code isn't validated", () => {
    const md = skillMd("## Background", "- See [runbook](http://x) and `/var/log`", "", "## Triage", "- **stop**");
    expect(program(md).sections["s:background"]).toEqual({ name: "Background", src: B, lists: [] });
  });
  test("an unreferenced section's lists keep only the items that parse as data items", () => {
    const md = skillMd("## Notes", "- plain value", "- `code`", "", "## Triage", "- **stop**");
    expect(program(md).sections["s:notes"]).toEqual({
      name: "Notes",
      src: B,
      lists: [{ src: B + 1, items: [{ src: B + 1, value: "plain value" }] }],
    });
  });
  test("a section used by for each is validated", () => {
    const md = skillMd(
      "## Triage",
      "- **for each** s in [Services]",
      "  - **run** `echo {s}`",
      "- **stop**",
      "",
      "## Services",
      "- `nginx`",
    );
    expect(errs(md)).toEqual([{ code: "E-DATA-ITEM", line: B + 6 }]);
  });
  test("a section used by one of is validated", () => {
    const md = skillMd("## Triage", "- **ask** Which? → one of [Services] as s · sure 80%", "- **stop**", "", "## Services", "- *nginx*");
    expect(errs(md)).toEqual([{ code: "E-DATA-ITEM", line: B + 5 }]);
  });
});

describe("P1-4: CRLF, CR and U+2028 don't hide instructions or shift lines", () => {
  const disk = readFileSync(new URL("../../fixtures/disk-full/SKILL.md", import.meta.url), "utf8");
  const golden = JSON.parse(readFileSync(new URL("../../contracts/examples/disk-full.core.json", import.meta.url), "utf8"));
  test("CRLF", () => expect(program(disk.replace(/\n/g, "\r\n"))).toEqual(golden));
  test("CR", () => expect(program(disk.replace(/\n/g, "\r"))).toEqual(golden));
  test("U+2028 and U+2029 are ordinary characters, not line breaks", () => {
    const md = skillMd("## Triage", "Look\u2028here\u2029now.", "", "- **run** `echo a\u2028b` as x", "- **stop**");
    const b = body(md);
    expect(b[0]).toEqual({ src: B + 3, run: { cmd: [{ lit: "echo a\u2028b" }], as: "x" }, else: null });
  });
  test("a UTF-8 byte order mark before the frontmatter", () => {
    expect(stmtKinds(`\uFEFF${skillMd("## Triage", "- **stop**")}`)).toEqual(["stop"]);
  });
});

describe("P1-5: CommonMark list markers and indentation", () => {
  test("a tab-indented nested list under for each", () => {
    const md = skillMd("## Triage", "- **for each** x in [Items]", "\t- **run** `echo {x}`", "- **stop**", "", "## Items", "- a");
    const fe = body(md)[0] as { for_each: { body: unknown[] } };
    expect(fe.for_each.body).toEqual([{ src: B + 2, run: { cmd: [{ lit: "echo " }, { var: "x" }] }, else: null }]);
  });
  test("a tab after the marker", () => expect(stmtKinds(skillMd("## Triage", "-\t**stop**"))).toEqual(["stop"]));
  test("a 1) marker", () => expect(stmtKinds(skillMd("## Triage", "1) **run** `df`", "2) **stop**"))).toEqual(["run", "stop"]));
  test("an indented blockquote", () => {
    expect(errs(skillMd("## Triage", "  > - **run** x", "", "- **stop**"))).toEqual([{ code: "E-MISPLACED", line: B + 1 }]);
  });
});

describe("P1-6 and rule 7: misplaced items are found at any blockquote depth", () => {
  for (const depth of [1, 2, 3]) {
    test(`depth ${depth}`, () => {
      const md = skillMd("## Triage", `${"> ".repeat(depth)}- **run** \`df\``, "", "- **stop**");
      expect(errs(md)).toEqual([{ code: "E-MISPLACED", line: B + 1 }]);
    });
  }
  test("a blockquote inside a list item", () => {
    const md = skillMd("## Triage", "- **stop**", "", "## Notes", "- Remember:", "  > - **run** `df`");
    expect(errs(md)).toEqual([{ code: "E-MISPLACED", line: B + 5 }]);
  });
});

describe("P1-7: code and HTML blocks are opaque", () => {
  const opaque = (...inner: string[]) => stmtKinds(skillMd("## Triage", ...inner, "", "- **stop**"));
  test("~~~ fence", () => expect(opaque("~~~", "- **run** `rm -rf /`", "~~~")).toEqual(["stop"]));
  test("a ```` fence isn't closed by ```", () => expect(opaque("````", "```", "- **run** `rm -rf /`", "```", "````")).toEqual(["stop"]));
  test("a fence inside a list item", () => {
    expect(opaque("- Example:", "", "  ```", "  - **run** `rm -rf /`", "  ```")).toEqual(["stop"]);
  });
  test("an indented code block", () => expect(opaque("Example:", "", "    - **run** `rm -rf /`")).toEqual(["stop"]));
  test("an HTML comment", () => expect(opaque("<!--", "- **run** `rm -rf /`", "-->")).toEqual(["stop"]));
  test("a <details> block", () => expect(opaque("<details>", "- **run** `rm -rf /`", "</details>")).toEqual(["stop"]));
  test("a fence doesn't hide what follows it", () => {
    expect(errs(skillMd("## Triage", "```", "x", "```", "- **run** df", "- **stop**"))).toEqual([{ code: "E-GRAMMAR", line: B + 4 }]);
  });
});

describe("P1-8: nested lists under option and rubric items", () => {
  test("under an option item: E-OPTION-ITEM, and the keyword inside is E-MISPLACED", () => {
    const md = skillMd(
      "## Triage",
      "- **ask** Pick · sure 80%",
      "  - [Page]",
      "    - **run** `df`",
      "  - [Triage]",
      "",
      "## Page",
      "- **stop**",
    );
    expect(errs(md)).toEqual([
      { code: "E-OPTION-ITEM", line: B + 2 },
      { code: "E-MISPLACED", line: B + 3 },
    ]);
  });
  test("under a rubric item: E-RUBRIC-ITEM, and the keyword inside is E-MISPLACED", () => {
    const md = skillMd(
      "## Triage",
      "- **ask** How bad? → 1 to 2 as x · sure 75%",
      "  - 1: fine",
      "    - **stop**",
      "  - 2: bad",
      "- **stop**",
    );
    expect(errs(md)).toEqual([
      { code: "E-RUBRIC-ITEM", line: B + 2 },
      { code: "E-MISPLACED", line: B + 3 },
    ]);
  });
  test("a plain nested list under an option item is still E-OPTION-ITEM", () => {
    const md = skillMd("## Triage", "- **ask** Pick · sure 80%", "  - [Page]", "    - why", "  - [Triage]", "", "## Page", "- **stop**");
    expect(errs(md)).toEqual([{ code: "E-OPTION-ITEM", line: B + 2 }]);
  });
});

describe("P2-1: slugs, limits, params and big integers", () => {
  test("## 🔥 is E-SECTION-NAME", () => {
    expect(errs(skillMd("## 🔥", "- **stop**", "", "## ---", "Prose."))).toEqual([
      { code: "E-SECTION-NAME", line: B },
      { code: "E-SECTION-NAME", line: B + 3 },
    ]);
  });
  test("a reference with no slug is E-GRAMMAR", () => {
    expect(errs(skillMd("## Triage", "- **then** [🔥]"))).toEqual([{ code: "E-GRAMMAR", line: B + 1 }]);
  });
  test("entry with no slug is E-FRONTMATTER at its line", () => {
    const md = withFm(["name: t", "description: d", "format: 1", "entry: '🔥'"], "## Triage", "- **stop**");
    expect(errs(md)).toEqual([{ code: "E-FRONTMATTER", line: 5 }]);
  });
  for (const [key, value] of [
    ["run_timeout", "0s"],
    ["do_timeout", "0m"],
    ["deadline", "99999999999999999999h"],
    ["ask_context", "0 tokens"],
    ["ask_context", "0k tokens"],
  ]) {
    test(`${key}: ${value} is E-FRONTMATTER`, () => {
      const md = withFm(["name: t", "description: d", "format: 1", "limits:", `  ${key}: ${value}`], "## Triage", "- **stop**");
      expect(errs(md)).toEqual([{ code: "E-FRONTMATTER", line: 6 }]);
    });
  }
  test("an unknown limits key is E-FRONTMATTER at its line", () => {
    const md = withFm(
      ["name: t", "description: d", "format: 1", "limits:", "  run_timeout: 5s", "  runtimeout: 5s"],
      "## Triage",
      "- **stop**",
    );
    expect(errs(md)).toEqual([{ code: "E-FRONTMATTER", line: 7 }]);
  });
  test("a param named __proto__ is kept as an ordinary param", () => {
    const md = withFm(
      ["name: t", "description: d", "format: 1", "params:", "  __proto__: 5", "  constructor: x"],
      "## Triage",
      "- **stop**",
    );
    const params = program(md).params;
    expect(Object.keys(params)).toEqual(["__proto__", "constructor"]);
    expect(Object.getOwnPropertyDescriptor(params, "__proto__")?.value).toEqual({ int: 5, src: 6 });
    expect(JSON.parse(JSON.stringify(params))).toEqual(JSON.parse('{"__proto__":{"int":5,"src":6},"constructor":{"str":"x","src":7}}'));
  });
  test("an integer param beyond 2^53 is E-FRONTMATTER", () => {
    const md = withFm(["name: t", "description: d", "format: 1", "params:", "  n: 9007199254740993"], "## Triage", "- **stop**");
    expect(errs(md)).toEqual([{ code: "E-FRONTMATTER", line: 6 }]);
  });
  test("Score bounds beyond 2^53 are E-GRAMMAR, a rubric level beyond it E-RUBRIC-ITEM", () => {
    const md = skillMd("## Triage", "- **ask** How bad? → 1 to 99999999999999999999 as x · sure 75%", "  - 1: a", "- **stop**");
    expect(errs(md)).toEqual([{ code: "E-GRAMMAR", line: B + 1 }]);
    const md2 = skillMd("## Triage", "- **ask** How bad? → 1 to 2 as x · sure 75%", "  - 99999999999999999999: a", "- **stop**");
    expect(errs(md2)).toEqual([{ code: "E-RUBRIC-ITEM", line: B + 2 }]);
  });
});

describe("P2-2: question text can't contain →, -> or ` · `", () => {
  for (const item of [
    "- **ask**  → yes | no · sure 50%",
    "- **ask** a->b? → yes | no · sure 50%",
    "- **ask** a→b? → yes | no · sure 50%",
    "- **ask** a -> b → yes | no · sure 50%",
    "- **ask** a · b · sure 50%",
  ]) {
    test(item, () => expect(errs(skillMd("## Triage", item, "- **stop**"))).toEqual([{ code: "E-GRAMMAR", line: B + 1 }]));
  }
  test("a middle dot without spaces is fine", () => {
    const ask = (body(skillMd("## Triage", "- **ask** a·b? → yes | no · sure 50%", "- **stop**"))[0] as { ask: { question: unknown } }).ask;
    expect(ask.question).toEqual([{ lit: "a·b?" }]);
  });
});

describe("P2-3: one or more spaces between tokens", () => {
  test("run", () => {
    expect(body(skillMd("## Triage", "- **run**   `df`   as   used   ·   else   skip", "- **stop**"))[0]).toEqual({
      src: B + 1,
      run: { cmd: [{ lit: "df" }], as: "used" },
      else: { skip: {} },
    });
  });
  test("check, ask, for each, if yes", () => {
    const md = skillMd(
      "## Triage",
      "- **check**  {x}  <  1  →  stop",
      "- **ask**  Ok?  →  yes | no  as  ok  ·  sure  50%",
      "- **if yes**  do  `x`  ·  else  [Page]",
      "- **for each**  i  in  [Items]",
      "  - **run** `echo {i}`",
      "- **ask** Which? →  one  of  [Items]  as  it  ·  sure 5%",
      "- **stop**",
      "",
      "## Items",
      "- a",
    );
    expect(stmtKinds(md)).toEqual(["check", "ask", "if_yes", "for_each", "ask", "stop"]);
  });
  test("no space between the keyword and its argument is E-GRAMMAR", () => {
    expect(errs(skillMd("## Triage", "- **run**`df`", "- **stop**"))).toEqual([{ code: "E-GRAMMAR", line: B + 1 }]);
  });
});

describe("P2-4: nesting and continuation follow CommonMark", () => {
  test("a loose list", () => expect(stmtKinds(skillMd("## Triage", "- **run** `df`", "", "- **stop**"))).toEqual(["run", "stop"]));
  test("a lazy continuation line is part of the item", () => {
    expect(body(skillMd("## Triage", "- **run** `df`", "as used", "- **stop**"))[0]).toMatchObject({ run: { as: "used" } });
  });
  test("a one-space indent is a sibling, not a nested list", () => {
    expect(stmtKinds(skillMd("## Triage", "- **run** `df`", " - **stop**"))).toEqual(["run", "stop"]);
  });
  test("a four-space indent under for each is its body", () => {
    const fe = body(skillMd("## Triage", "- **for each** x in [I]", "    - **stop**", "", "## I", "- a"))[0] as {
      for_each: { body: unknown[] };
    };
    expect(fe.for_each.body).toEqual([{ src: B + 2, stop: {} }]);
  });
  test("a paragraph in a loose instruction item is prose", () => {
    expect(stmtKinds(skillMd("## Triage", "- **run** `df`", "", "  Explains the run.", "- **stop**"))).toEqual(["run", "stop"]);
  });
});

describe("P2-5: setext headings and closing #s", () => {
  test("a setext h2 starts a section", () => {
    const md = skillMd("Triage", "------", "- **stop**");
    expect(program(md).sections["s:triage"]).toEqual({ name: "Triage", src: B, guidance: null, body: [{ src: B + 2, stop: {} }] });
  });
  test("closing #s aren't part of the name", () => {
    expect(program(skillMd("## Triage ##", "- **stop**")).sections["s:triage"]?.name).toBe("Triage");
  });
  test("an h2 in a blockquote isn't a section", () => {
    expect(Object.keys(program(skillMd("## Triage", "- **stop**", "", "> ## Quoted", "> text")).sections)).toEqual(["s:triage"]);
  });
});

describe("P2-6: GitHub slugs keep Unicode letters", () => {
  test("[Café](#café) matches ## Café", () => {
    const md = skillMd("## Triage", "- **then** [Café](#café)", "", "## Café", "- **stop**");
    expect(body(md)[0]).toEqual({ src: B + 1, then: { section: "s:café", anchor: { given: "café", expected: "café" } } });
  });
  test("a heading's surrounding punctuation doesn't reach its id", () => {
    expect(Object.keys(program(skillMd("## _Triage_", "- **stop**")).sections)).toEqual(["s:triage"]);
  });
});

describe("P2-7: data items are plain text or `Label — command`", () => {
  const listed = (...items: string[]) =>
    skillMd("## Triage", "- **for each** s in [Services]", "  - **run** `echo {s}`", "- **stop**", "", "## Services", ...items);
  for (const bad of ["_nginx_", "<b>nginx</b>", "<http://x>", "[x](#y)", "nginx\\_x", "*nginx*"]) {
    test(`${bad} is E-DATA-ITEM`, () => expect(errs(listed(`- ${bad}`))).toEqual([{ code: "E-DATA-ITEM", line: B + 6 }]));
  }
  test("an action label must be plain text too", () => {
    expect(errs(listed("- **Vacuum** — `x`"))).toEqual([{ code: "E-DATA-ITEM", line: B + 6 }]);
  });
  test("a nested list under a data item is E-DATA-ITEM", () => {
    expect(errs(listed("- nginx", "  - primary"))).toEqual([{ code: "E-DATA-ITEM", line: B + 6 }]);
  });
  test("my_app and a*b are plain text", () => {
    expect((program(listed("- my_app", "- a*b")).sections["s:services"] as { lists: unknown[] }).lists).toEqual([
      {
        src: B + 6,
        items: [
          { src: B + 6, value: "my_app" },
          { src: B + 7, value: "a*b" },
        ],
      },
    ]);
  });
  test("a double-backtick command span", () => {
    const lists = (program(listed("- Date — `` echo `date` ``")).sections["s:services"] as { lists: { items: unknown[] }[] }).lists;
    expect(lists[0]?.items).toEqual([{ src: B + 6, action: { label: "Date", cmd: [{ lit: "echo `date`" }] } }]);
  });
});

describe("P2-8: __bold__ counts as bold", () => {
  test("__run__", () => expect(stmtKinds(skillMd("## Triage", "- __run__ `df`", "- __Stop__"))).toEqual(["run", "stop"]));
  test("__run__ in a blockquote is E-MISPLACED", () => {
    expect(errs(skillMd("## Triage", "> - __run__ `df`", "", "- **stop**"))).toEqual([{ code: "E-MISPLACED", line: B + 1 }]);
  });
  test("__rn__ is E-UNKNOWN-BOLD", () => {
    expect(errs(skillMd("## Triage", "- __rn__ `df`", "- **stop**"))).toEqual([{ code: "E-UNKNOWN-BOLD", line: B + 1 }]);
  });
});

describe("P2-9: E-UNKNOWN-BOLD suggests the nearest keyword", () => {
  const message = (bold: string) => {
    const r = preprocess(skillMd("## Triage", `- **${bold}** x`, "- **stop**"));
    return "errors" in r ? (r.errors[0]?.message ?? "") : "";
  };
  for (const [bold, kw] of [
    ["rn", "run"],
    ["for_each", "for each"],
    ["foreach", "for each"],
    ["for-each", "for each"],
    ["for  each", "for each"],
    ["Hand-Off", "hand off"],
    ["stp", "stop"],
    ["chek", "check"],
    ["if_yes", "if yes"],
  ] as [string, string][]) {
    test(`**${bold}** → **${kw}**`, () => expect(message(bold)).toContain(`did you mean **${kw}**?`));
  }
  test("no suggestion for bold text nowhere near a keyword", () => expect(message("Important")).not.toContain("did you mean"));
});

describe("P2-10: deep nesting is an error, not a crash or a silent truncation", () => {
  test("3000 nested list levels", () => {
    const r = preprocess(skillMd("## Triage", `${"- ".repeat(3000)}**run** x`, "- **stop**"));
    expect("errors" in r && r.errors.map((e) => e.code)).toEqual(["E-NESTED-LIST"]);
  });
  test("3000 nested blockquotes", () => {
    const r = preprocess(skillMd("## Triage", `${"> ".repeat(3000)}- **run** x`, "", "- **stop**"));
    expect("errors" in r && r.errors.map((e) => e.code)).toEqual(["E-NESTED-LIST"]);
  });
  test("an instruction after deep nesting isn't dropped", () => {
    const r = preprocess(skillMd("## Triage", `${"- ".repeat(60)}x`, "- **run** df"));
    expect("errors" in r && r.errors.length > 0).toBe(true);
  });
});

describe("P2-11: grammar cases the mutants survived", () => {
  test("-> in check and ask", () => {
    const b = body(skillMd("## Triage", "- **check** {x} < 1 -> stop", "- **ask** Ok? -> yes | no · sure 50%", "- **stop**"));
    expect(b[0]).toEqual({
      src: B + 1,
      check: { cond: { cmp: { op: "<", l: { var: "x" }, r: { num: "1" } } }, then: { stop: {} }, else: null },
    });
    expect(b[1]).toEqual({ src: B + 2, ask: { question: [{ lit: "Ok?" }], sure: 50, else: null, yesno: { as: "_yn" } } });
  });
  test("% is dropped on numbers and variables", () => {
    expect(body(skillMd("## Triage", "- **check** {x}% >= 85.5% → stop", "- **stop**"))[0]).toEqual({
      src: B + 1,
      check: { cond: { cmp: { op: ">=", l: { var: "x" }, r: { num: "85.5" } } }, then: { stop: {} }, else: null },
    });
  });
  for (const item of [
    "- **ask** Ok? → yes | no · sure 101%",
    "- **hand off** now",
    "- **stop** now",
    "- **check** {x} < 1",
    "- **check** `true` succeeds",
  ]) {
    test(`${item} is E-GRAMMAR`, () =>
      expect(errs(skillMd("## Triage", item, "- **stop**"))).toEqual([{ code: "E-GRAMMAR", line: B + 1 }]));
  }
  for (const item of [
    "- **then** [Page]",
    '- **page** "hi"',
    "- **if yes** run `x`",
    "- **ask** Ok? → yes | no · sure 50%",
    "- **stop**",
  ]) {
    test(`E-NESTED-LIST under ${item}`, () => {
      const md = skillMd("## Triage", item, "  - more", "", "## Page", "- **stop**");
      expect(errs(md)).toEqual([{ code: "E-NESTED-LIST", line: B + 2 }]);
    });
  }
  test("E-MISPLACED under a data item", () => {
    expect(errs(skillMd("## Triage", "- **stop**", "", "## Services", "- nginx", "  - **run** `df`"))).toEqual([
      { code: "E-MISPLACED", line: B + 5 },
    ]);
  });
  test("E-MISPLACED under an E-UNKNOWN-BOLD item", () => {
    expect(errs(skillMd("## Triage", "- **rn** x", "  - **run** `df`", "- **stop**"))).toEqual([
      { code: "E-UNKNOWN-BOLD", line: B + 1 },
      { code: "E-MISPLACED", line: B + 2 },
    ]);
  });
  test("E-MISPLACED under a prose item in a prose section", () => {
    expect(errs(skillMd("## Notes", "- a note", "  - **stop**", "", "## Triage", "- **stop**"))).toEqual([
      { code: "E-MISPLACED", line: B + 2 },
    ]);
  });
});

describe("nits", () => {
  test("E-FRONTMATTER points at the field's line", () => {
    expect(errs(withFm(["format: 1", "description: d", "name: Bad_Name"], "## T", "- **stop**"))).toEqual([
      { code: "E-FRONTMATTER", line: 4 },
    ]);
  });
  test("a YAML syntax error points at its line", () => {
    expect(errs(withFm(["name: t", "description: d", "format: 1", "params:", "  a: 1", "  a: 2"], "## T", "- **stop**"))).toEqual([
      { code: "E-FRONTMATTER", line: 7 },
    ]);
  });
  test("param src is right at any YAML indentation", () => {
    const md = withFm(
      ["name: t", "description: d", "format: 1", "params:", "    # a comment", "    mount: /", "    n: 3"],
      "## T",
      "- **stop**",
    );
    expect(program(md).params).toEqual({ mount: { str: "/", src: 7 }, n: { int: 3, src: 8 } });
  });
  test("a nested key with the same name as a param doesn't steal its line", () => {
    const md = withFm(
      ["name: t", "description: d", "format: 1", "limits:", "  deadline: 5m", "params:", "  deadline: 1"],
      "## T",
      "- **stop**",
    );
    expect(program(md).params).toEqual({ deadline: { int: 1, src: 8 } });
  });
  test("a key-like line inside a block scalar doesn't steal a param's line", () => {
    const md = withFm(["name: t", "description: d", "format: 1", "params:", "  m: |", "    n: x", "  n: 3"], "## T", "- **stop**");
    expect(program(md).params).toEqual({ m: { str: "n: x\n", src: 6 }, n: { int: 3, src: 8 } });
  });
  test("guidance strips emphasis, escapes and references", () => {
    const md = skillMd(
      "## Triage",
      "Use *care*, _thought_ and **both**; \\* is a star; see [Page] or [docs](http://x) `now`.",
      "",
      "- **stop**",
    );
    expect((program(md).sections["s:triage"] as Section).guidance).toBe("Use care, thought and both; * is a star; see Page or docs now.");
  });
  test("the default entry can't collide with a real section", () => {
    const p = program(skillMd("## Entry", "Just prose."));
    expect(p.entry.section).not.toBe("s:entry");
    expect(p.sections[p.entry.section]).toBeUndefined();
  });
  test("an h2 inside a code block isn't a section", () => {
    expect(Object.keys(program(skillMd("## Triage", "- **stop**", "", "```", "## Fake", "```")).sections)).toEqual(["s:triage"]);
  });
  test("frontmatter with CRLF keeps field lines", () => {
    const md = `${FRONTMATTER}\n## Triage\n- **stop**`.replace(/\n/g, "\r\n").replace("name: test", "name: Bad");
    expect(errs(md)).toEqual([{ code: "E-FRONTMATTER", line: 2 }]);
  });
});
