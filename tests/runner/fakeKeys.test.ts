// Stable fake keys (SPEC §5.4, docs/design/skill-tests.md): `Section.var`
// and `Section.ask` resolve to the one statement they name, before the run.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { CoreProgram } from "../../src/contracts.gen.js";
import { preprocess } from "../../src/preprocess/index.js";
import { resolveFakeKeys } from "../../src/runner/fakeKeys.js";
import { ROOT } from "../acceptance/lib/scenarios.js";

function program(md: string): CoreProgram {
  const r = preprocess(md);
  if (!("program" in r)) throw new Error(JSON.stringify(r.errors));
  return r.program;
}
const diskFull = program(readFileSync(`${ROOT}/fixtures/disk-full/SKILL.md`, "utf8"));
const skill = (body: string) => program(`---\nname: tiny\ndescription: t\nformat: 1\n---\n\n## Main\nDo it.\n\n${body}\n`);

describe("resolveFakeKeys", () => {
  test("Section.var names the run that binds var, in --fake-exec files", () => {
    const { doc, issues } = resolveFakeKeys(diskFull, { "Triage.used": 1, "Triage.errors": 2, "Restart.used": 3 }, "commands");
    expect(doc).toEqual({ "line:23": 1, "line:25": 2, "line:48": 3 });
    expect(issues).toEqual([]);
  });

  test("Section.var and Section.ask name asks in --fake files, loops included", () => {
    const { doc, issues } = resolveFakeKeys(diskFull, { "Triage.ask": 1, "Restart.service": 2, "Clean up.ask": 3 }, "answers");
    expect(doc).toEqual({ "line:27": 1, "line:46": 2, "line:37": 3 });
    expect(issues).toEqual([]);
  });

  test("the section part resolves by slug", () => {
    const { doc } = resolveFakeKeys(diskFull, { "clean_up.ask": 1 }, "answers");
    expect(doc).toEqual({ "line:37": 1 });
  });

  test("a stable key wins over line:N for the same statement", () => {
    const { doc } = resolveFakeKeys(diskFull, { "Triage.used": "stable", "line:23": "line" }, "commands");
    expect(doc).toEqual({ "line:23": "stable" });
  });

  test("keys that aren't stable keys stay as they are", () => {
    const keys = { "df -h": 1, "./fix.sh": 2, "line:25": 3, "Nowhere.used": 4 };
    expect(resolveFakeKeys(diskFull, keys, "commands")).toEqual({ doc: keys, issues: [] });
  });

  test("W-FAKE-UNUSED: a stable or line:N key that names no statement", () => {
    const { issues } = resolveFakeKeys(diskFull, { "Triage.nope": 1, "line:21": 2, "Page.ask": 3, "Triage.ask": 4 }, "commands");
    expect(issues.map((i) => [i.code, i.key])).toEqual([
      ["W-FAKE-UNUSED", "Triage.nope"],
      ["W-FAKE-UNUSED", "line:21"],
      ["W-FAKE-UNUSED", "Page.ask"],
      ["W-FAKE-UNUSED", "Triage.ask"], // an ask isn't a command
    ]);
  });

  test("a script path is never a stable key, even with a section of that name", () => {
    const p = skill("- **run** `./fix.sh`\n- **run** `bin/fix.sh`\n- **stop**\n\n## Fix\nFix it.\n\n- **stop**");
    const keys = { "./fix.sh": 1, "bin/fix.sh": 2 };
    expect(resolveFakeKeys(p, keys, "commands")).toEqual({ doc: keys, issues: [] });
  });

  test("a stable-looking key that names nothing in its section still matches as exact text", () => {
    const p = skill("- **run** `fix.sh`\n- **stop**\n\n## Fix\nFix it.\n\n- **stop**");
    const { doc, issues } = resolveFakeKeys(p, { "fix.sh": 1 }, "commands");
    expect(doc).toEqual({ "fix.sh": 1 });
    expect(issues).toMatchObject([{ code: "W-FAKE-UNUSED", key: "fix.sh" }]);
  });

  test("in a command file, Section.ask is a variable named ask, not the section's ask", () => {
    const p = skill("- **run** `echo hi` as ask\n- **ask** Is {ask} ok? → yes | no · sure 80%\n- **stop**");
    expect(resolveFakeKeys(p, { "Main.ask": 1 }, "commands")).toEqual({ doc: { "line:10": 1 }, issues: [] });
    expect(resolveFakeKeys(p, { "Main.ask": 2 }, "answers")).toEqual({ doc: { "line:11": 2 }, issues: [] });
  });

  test("E-FAKE-AMBIGUOUS: a stable key that names more than one statement", () => {
    const p = skill(
      "- **run** `echo 1` as n\n- **run** `echo 2` as n\n- **ask** Is {n} ok? → yes | no · sure 80%\n- **ask** And {n}? → yes | no as again · sure 80%\n- **stop**",
    );
    expect(resolveFakeKeys(p, { "Main.n": 1 }, "commands").issues).toMatchObject([{ code: "E-FAKE-AMBIGUOUS", key: "Main.n" }]);
    expect(resolveFakeKeys(p, { "Main.ask": 1 }, "answers").issues).toMatchObject([{ code: "E-FAKE-AMBIGUOUS", key: "Main.ask" }]);
    expect(resolveFakeKeys(p, { "Main.again": 1 }, "answers")).toEqual({ doc: { "line:13": 1 }, issues: [] });
  });

  describe("strict, under --test", () => {
    test("E-FAKE-UNUSED: an unused stable or line:N key is an error", () => {
      const { issues } = resolveFakeKeys(diskFull, { "Triage.nope": 1, "line:21": 2 }, "commands", true);
      expect(issues.map((i) => i.code)).toEqual(["E-FAKE-UNUSED", "E-FAKE-UNUSED"]);
    });

    test("a key that falls back to exact text stays a warning: it may be a command", () => {
      const p = skill("- **run** `fix.sh`\n- **stop**\n\n## Fix\nFix it.\n\n- **stop**");
      expect(resolveFakeKeys(p, { "fix.sh": 1 }, "commands", true).issues).toMatchObject([{ code: "W-FAKE-UNUSED" }]);
    });

    test("E-FAKE-AMBIGUOUS: a stable key and a line:N key for the same statement", () => {
      const { issues } = resolveFakeKeys(diskFull, { "line:23": 1, "Triage.used": 2 }, "commands", true);
      expect(issues).toMatchObject([{ code: "E-FAKE-AMBIGUOUS", key: "Triage.used" }]);
    });
  });
});
