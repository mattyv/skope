// Every parse-stage code in SPEC §7.1 (stage: "parse" in contracts/error-codes.json),
// each with its §12.2 (or §7.1 table) case and the correct line. Tests match
// on code and line, never on message text (SPEC §7.1).

import { describe, expect, test } from "vitest";
import { preprocess } from "../../src/preprocess/index.js";
import { BODY_START, skillMd } from "./helpers.js";

function codesAt(md: string): { code: string; line: number }[] {
  const result = preprocess(md);
  if (!("errors" in result)) throw new Error(`expected errors, got a program: ${JSON.stringify(result)}`);
  return result.errors.map((e) => ({ code: e.code, line: e.line }));
}

describe("E-NOT-RUNNABLE (parse): no format: 1 in the frontmatter", () => {
  test("a plain agent skill with no frontmatter at all", () => {
    const md = "# Just a heading\n\nSome prose.\n";
    expect(codesAt(md)).toEqual([{ code: "E-NOT-RUNNABLE", line: 1 }]);
  });

  test("frontmatter present but format: 1 is missing", () => {
    const md = "---\nname: test\ndescription: x\n---\n# Title\n";
    expect(codesAt(md)).toContainEqual({ code: "E-NOT-RUNNABLE", line: 1 });
  });
});

describe("E-FRONTMATTER (parse): a frontmatter field is missing or invalid", () => {
  test("no description", () => {
    const md = "---\nname: test\nformat: 1\n---\n# Title\n";
    expect(codesAt(md)).toContainEqual({ code: "E-FRONTMATTER", line: 1 });
  });

  test("run_timeout: soon", () => {
    const md = ["---", "name: test", "description: x", "format: 1", "limits:", "  run_timeout: soon", "---", "# Title"].join("\n");
    const errs = codesAt(md);
    expect(errs.some((e) => e.code === "E-FRONTMATTER" && e.line === 6)).toBe(true);
  });
});

describe("E-DUP-SECTION (parse): two sections share a name, ignoring case", () => {
  test("## Page twice", () => {
    const md = skillMd("## Page", "- **stop**", "", "## Page", "- **stop**");
    // BODY_START=6: 6 "## Page", 7 "- **stop**", 8 "", 9 "## Page", 10 "- **stop**"
    expect(codesAt(md)).toEqual([{ code: "E-DUP-SECTION", line: BODY_START + 3 }]);
  });

  test("## Clean up and ## Clean-up share a slug", () => {
    const md = skillMd("## Clean up", "- **stop**", "", "## Clean-up", "- **stop**");
    expect(codesAt(md)).toEqual([{ code: "E-DUP-SECTION", line: BODY_START + 3 }]);
  });
});

describe("E-MISPLACED (parse): a keyword item where instructions aren't recognised", () => {
  test("before the first section", () => {
    const md = skillMd("- **run** `df -h`", "", "## Triage", "- **stop**");
    expect(codesAt(md)).toContainEqual({ code: "E-MISPLACED", line: BODY_START });
  });

  test("inside a blockquote", () => {
    const md = skillMd("## Triage", "> - **run** `df -h`", "- **stop**");
    expect(codesAt(md)).toContainEqual({ code: "E-MISPLACED", line: BODY_START + 1 });
  });

  test("nested under a plain (prose) bullet", () => {
    const md = skillMd("## Triage", "- **Note:** see below", "  - **run** `df -h`", "- **stop**");
    expect(codesAt(md)).toContainEqual({ code: "E-MISPLACED", line: BODY_START + 2 });
  });
});

describe("E-SECTION-NAME (parse): a ## heading with no letters or digits", () => {
  test("## 🔥", () => {
    expect(codesAt(skillMd("## 🔥", "- **stop**"))).toEqual([{ code: "E-SECTION-NAME", line: BODY_START }]);
  });
});

describe("E-DATA-ITEM (parse): a data list item isn't a plain value or `Label — command`", () => {
  test("value item `nginx` (a code span, not plain text) in a section used as a list", () => {
    const md = skillMd(
      "## Triage",
      "- **for each** s in [Services]",
      "  - **run** `echo {s}`",
      "- **stop**",
      "",
      "## Services",
      "- `nginx`",
      "- rsyslog",
    );
    expect(codesAt(md)).toEqual([{ code: "E-DATA-ITEM", line: BODY_START + 6 }]);
  });
});

describe("E-UNKNOWN-BOLD (parse): bold text that isn't a keyword and doesn't end in ':'", () => {
  test("**rn** `df -h` (misspelled keyword, no colon)", () => {
    const md = skillMd("## Triage", "- **rn** `df -h`", "- **stop**");
    expect(codesAt(md)).toContainEqual({ code: "E-UNKNOWN-BOLD", line: BODY_START + 1 });
  });

  test("**for_each** (underscore instead of a space)", () => {
    const md = skillMd("## Triage", "- **for_each** x in [Items]", "- **stop**", "", "## Items", "- a");
    expect(codesAt(md)).toContainEqual({ code: "E-UNKNOWN-BOLD", line: BODY_START + 1 });
  });

  test("**foreach** (no space at all)", () => {
    const md = skillMd("## Triage", "- **foreach** x in [Items]", "- **stop**", "", "## Items", "- a");
    expect(codesAt(md)).toContainEqual({ code: "E-UNKNOWN-BOLD", line: BODY_START + 1 });
  });

  test("**for  each** (double space)", () => {
    const md = skillMd("## Triage", "- **for  each** x in [Items]", "- **stop**", "", "## Items", "- a");
    expect(codesAt(md)).toContainEqual({ code: "E-UNKNOWN-BOLD", line: BODY_START + 1 });
  });
});

describe("E-GRAMMAR (parse): a keyword item doesn't match §3.4", () => {
  test("**Run** the tests first (keyword, but not the run grammar)", () => {
    const md = skillMd("## Triage", "- **Run** the tests first", "- **stop**");
    expect(codesAt(md)).toContainEqual({ code: "E-GRAMMAR", line: BODY_START + 1 });
  });

  test("**run** df -h (missing the code span)", () => {
    const md = skillMd("## Triage", "- **run** df -h", "- **stop**");
    expect(codesAt(md)).toContainEqual({ code: "E-GRAMMAR", line: BODY_START + 1 });
  });
});

describe("E-NESTED-LIST (parse): a nested list under an instruction that doesn't take one", () => {
  test("a list under a run item", () => {
    const md = skillMd("## Triage", "- **run** `df -h`", "  - foo", "- **stop**");
    expect(codesAt(md)).toContainEqual({ code: "E-NESTED-LIST", line: BODY_START + 2 });
  });
});

describe("E-OPTION-ITEM (parse): an option item isn't exactly one [Section] link", () => {
  test("[Page] or restart", () => {
    const md = skillMd("## Triage", "- **ask** Pick one · sure 80%", "  - [Page] or restart", "- **stop**", "", "## Page", "- **stop**");
    expect(codesAt(md)).toContainEqual({ code: "E-OPTION-ITEM", line: BODY_START + 2 });
  });
});

describe("E-RUBRIC-ITEM (parse): a rubric line isn't `INT: text` (v1.1)", () => {
  test("a rubric item with no level (`- very bad`)", () => {
    const md = skillMd(
      "## Triage",
      "- **ask** How bad? → 1 to 2 as x · sure 75%",
      "  - very bad",
      "  - 2: ok",
      "- **check** {x} == 1 → stop",
    );
    expect(codesAt(md)).toContainEqual({ code: "E-RUBRIC-ITEM", line: BODY_START + 2 });
  });

  test("a bold rubric line (`- **4**: outage`)", () => {
    const md = skillMd(
      "## Triage",
      "- **ask** How bad? → 1 to 4 as x · sure 75%",
      "  - 1: fine",
      "  - 2: ok",
      "  - 3: bad",
      "  - **4**: outage",
      "- **check** {x} == 1 → stop",
    );
    expect(codesAt(md)).toContainEqual({ code: "E-RUBRIC-ITEM", line: BODY_START + 5 });
  });

  test("a nested instruction under a Score ask (`- **run** ...`)", () => {
    const md = skillMd(
      "## Triage",
      "- **ask** How bad? → 1 to 2 as x · sure 75%",
      "  - **run** `df -h`",
      "  - 2: ok",
      "- **check** {x} == 1 → stop",
    );
    expect(codesAt(md)).toContainEqual({ code: "E-RUBRIC-ITEM", line: BODY_START + 2 });
  });
});

describe("a skill with two errors reports both", () => {
  test("E-UNKNOWN-BOLD and E-GRAMMAR together", () => {
    const md = skillMd("## Triage", "- **rn** `df -h`", "- **run** df -h", "- **stop**");
    const errs = codesAt(md);
    expect(errs).toContainEqual({ code: "E-UNKNOWN-BOLD", line: BODY_START + 1 });
    expect(errs).toContainEqual({ code: "E-GRAMMAR", line: BODY_START + 2 });
    expect(errs.length).toBe(2);
  });
});
