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

describe("E-NOT-RUNNABLE (parse): no skope block with format: 1", () => {
  test("a plain agent skill with no frontmatter at all", () => {
    const md = "# Just a heading\n\nSome prose.\n";
    expect(codesAt(md)).toEqual([{ code: "E-NOT-RUNNABLE", line: 1 }]);
  });

  test("frontmatter but no skope block", () => {
    const md = "---\nname: test\ndescription: x\n---\n# Title\n";
    expect(codesAt(md)).toContainEqual({ code: "E-NOT-RUNNABLE", line: 1 });
  });
});

describe("the skope block (SPEC §3.1)", () => {
  const message = (md: string) => {
    const r = preprocess(md);
    return "errors" in r ? r.errors.map((e) => `${e.code}@${e.line}: ${e.message}`) : [];
  };

  test("beta.1 layout, format: 1 in the frontmatter, says to move it", () => {
    const md = "---\nname: t\ndescription: d\nformat: 1\nparams:\n  a: 1\n---\n## T\n- **stop**\n";
    expect(message(md)).toEqual([
      expect.stringMatching(/^E-NOT-RUNNABLE@1: `format`, `params` are in the frontmatter: move them into a ```skope block/),
    ]);
  });

  test("a skope key left in the frontmatter beside a block is E-FRONTMATTER at its line", () => {
    const md = "---\nname: t\ndescription: d\nlimits:\n  deadline: 5m\n---\nA skope skill.\n```skope\nformat: 1\n```\n## T\n- **stop**\n";
    expect(codesAt(md)).toEqual([{ code: "E-FRONTMATTER", line: 4 }]);
  });

  test("any key the Agent Skills spec doesn't allow is E-FRONTMATTER, since claude.ai rejects it", () => {
    const md =
      "---\nname: t\ndescription: d\nauthor: me\nmetadata:\n  team: sre\n---\nA skope skill.\n```skope\nformat: 1\n```\n## T\n- **stop**\n";
    expect(message(md)).toEqual([expect.stringMatching(/^E-FRONTMATTER@4: `author` isn't an Agent Skills frontmatter key/)]);
  });

  test("an unknown key in the block, a block without format: 1, a second block, and an unclosed block", () => {
    const fm = "---\nname: t\ndescription: d\n---\nA skope skill.\n";
    expect(codesAt(`${fm}\`\`\`skope\nformat: 1\ntimeout: 5s\n\`\`\`\n## T\n- **stop**\n`)).toEqual([{ code: "E-FRONTMATTER", line: 8 }]);
    expect(codesAt(`${fm}\`\`\`skope\nparams:\n  a: 1\n\`\`\`\n## T\n- **stop**\n`)).toEqual([{ code: "E-FRONTMATTER", line: 6 }]);
    expect(codesAt(`${fm}\`\`\`skope\nformat: 1\n\`\`\`\n\`\`\`skope\nformat: 1\n\`\`\`\n## T\n- **stop**\n`)).toEqual([
      { code: "E-FRONTMATTER", line: 9 },
    ]);
    expect(codesAt(`${fm}\`\`\`skope\nformat: 1\n## T\n- **stop**\n`)).toEqual([{ code: "E-FRONTMATTER", line: 6 }]);
  });

  test("a skope block after the first section doesn't count", () => {
    const md = "---\nname: t\ndescription: d\n---\nA skope skill.\n## T\n- **stop**\n\n```skope\nformat: 1\n```\n";
    expect(codesAt(md)).toEqual([{ code: "E-NOT-RUNNABLE", line: 1 }]);
  });

  test("~~~ fences work too, and the block's lines are what params point at", () => {
    const md = "---\nname: t\ndescription: d\n---\n# T\n\nA skope skill.\n\n~~~skope\nformat: 1\nparams:\n  a: 1\n~~~\n## T\n- **stop**\n";
    const r = preprocess(md);
    expect("program" in r && r.program.params).toEqual({ a: { int: 1, src: 12 } });
  });

  test("W-NO-SKOPE-NOTE: an intro that never says skope, outside the block", () => {
    const warnings = (intro: string) => {
      const r = preprocess(`---\nname: t\ndescription: d\n---\n${intro}\n\`\`\`skope\nformat: 1\n\`\`\`\n## T\n- **stop**\n`);
      return "program" in r ? r.warnings.map((w) => ({ code: w.code, line: w.line })) : null;
    };
    expect(warnings("# Title")).toEqual([{ code: "W-NO-SKOPE-NOTE", line: 6 }]);
    expect(warnings("# Title\n\n*A skope skill.*")).toEqual([]);
  });
});

describe("E-FRONTMATTER (parse): a frontmatter field is missing or invalid", () => {
  test("no description", () => {
    const md = "---\nname: test\n---\nA skope skill.\n```skope\nformat: 1\n```\n# Title\n";
    expect(codesAt(md)).toContainEqual({ code: "E-FRONTMATTER", line: 1 });
  });

  test("run_timeout: soon", () => {
    const md = [
      "---",
      "name: test",
      "description: x",
      "---",
      "A skope skill.",
      "```skope",
      "format: 1",
      "limits:",
      "  run_timeout: soon",
      "```",
      "# Title",
    ].join("\n");
    const errs = codesAt(md);
    expect(errs.some((e) => e.code === "E-FRONTMATTER" && e.line === 9)).toBe(true);
  });

  // S1: every timeout is 1 ms to 2^31 − 1 ms (SPEC §4.4); a longer one used to pass lint
  // and fail at run time with E-INTERNAL. The deadline is bounded the same way.
  test.each([
    ["run_timeout", "99999999999s"],
    ["do_timeout", "596524h"],
    ["deadline", "35792m"],
    ["run_timeout", "2147484s"],
  ])("%s: %s is past 2^31 − 1 ms", (key, value) => {
    const md = [
      "---",
      "name: test",
      "description: x",
      "---",
      "A skope skill.",
      "```skope",
      "format: 1",
      "limits:",
      `  ${key}: ${value}`,
      "```",
      "# Title",
    ].join("\n");
    expect(codesAt(md)).toContainEqual({ code: "E-FRONTMATTER", line: 9 });
  });

  test("2147483s (just under 2^31 − 1 ms) is accepted for every duration", () => {
    for (const key of ["run_timeout", "do_timeout", "deadline"]) {
      const md = [
        "---",
        "name: test",
        "description: x",
        "---",
        "A skope skill.",
        "```skope",
        "format: 1",
        "limits:",
        `  ${key}: 2147483s`,
        "```",
        "## T",
        "- **stop**",
      ].join("\n");
      expect("errors" in preprocess(md), key).toBe(false);
    }
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

  test("**for_each:** and **Hand-Off**: (a misspelt keyword with a colon is still E-UNKNOWN-BOLD, not a note)", () => {
    for (const lead of ["**for_each:**", "**Hand-Off**:", "**foreach:**"]) {
      const md = skillMd("## Triage", `- ${lead} x in [Items]`, "- **stop**", "", "## Items", "- a");
      expect(codesAt(md), lead).toContainEqual({ code: "E-UNKNOWN-BOLD", line: BODY_START + 1 });
    }
  });

  test("**Note:** and **Tip:** stay prose (they don't normalise to a keyword)", () => {
    const md = skillMd("## Triage", "- **Note:** careful", "- **Tip:** also careful", "- **stop**");
    expect(preprocess(md)).toHaveProperty("program");
  });

  test("<b>run</b> and <strong>stop</strong> (HTML bold renders like a keyword, so it's an error)", () => {
    for (const lead of ["<b>run</b> `df`", "<strong>stop</strong>"]) {
      const md = skillMd("## Triage", `- ${lead}`, "- **stop**");
      expect(codesAt(md), lead).toContainEqual({ code: "E-UNKNOWN-BOLD", line: BODY_START + 1 });
    }
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
