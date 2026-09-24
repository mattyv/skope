// tests.yaml (docs/design/skill-tests.md, SPEC §7.3): scenarios that don't
// need their own directory under tests/.

import { describe, expect, test } from "vitest";
import { readTestsYaml } from "../../src/runner/testsYaml.js";

const NO_FOLDERS = new Set<string>();

describe("readTestsYaml", () => {
  test("each scenario merges over defaults.commands and defaults.answers, key by key", () => {
    const doc = {
      defaults: { commands: { a: { exit: 0 }, b: { exit: 0 } }, answers: { q: "unsure" } },
      scenarios: {
        one: { outcome: "stopped" },
        two: { outcome: "stopped", commands: { a: { exit: 1 } } },
      },
    };
    const rows = readTestsYaml(doc, NO_FOLDERS);
    expect(rows).toHaveLength(2);
    const scenario = (name: string) =>
      (rows.find((r) => "scenario" in r && r.scenario.name === name) as { scenario: { commands: unknown; answers: unknown } }).scenario;
    expect(scenario("one").commands).toEqual({ a: { exit: 0 }, b: { exit: 0 } });
    expect(scenario("one").answers).toEqual({ q: "unsure" });
    // The scenario's own value for a key wins over the default.
    expect(scenario("two").commands).toEqual({ a: { exit: 1 }, b: { exit: 0 } });
  });

  test("a scenario with neither commands nor answers defaults to no commands", () => {
    const doc = { scenarios: { x: { outcome: "stopped" } } };
    const [row] = readTestsYaml(doc, NO_FOLDERS);
    expect(row).toMatchObject({ scenario: { commands: {}, answers: undefined } });
  });

  test("expect.yaml fields sit at the scenario's top level, checked by the same rules as expect.yaml", () => {
    const doc = { scenarios: { x: { colour: "red", outcome: "paged" } } };
    const [row] = readTestsYaml(doc, NO_FOLDERS);
    expect(row).toMatchObject({ name: "x", invalid: expect.stringContaining("unknown key colour") });
  });

  test("a scenario needs at least one of outcome, exit, path or path_prefix, same as expect.yaml", () => {
    const doc = { scenarios: { x: { commands: {} } } };
    const [row] = readTestsYaml(doc, NO_FOLDERS);
    expect(row).toMatchObject({ name: "x", invalid: expect.stringContaining("set at least one of") });
  });

  test("a scenario name that's also a folder scenario is invalid", () => {
    const doc = { scenarios: { restart: { outcome: "paged" } } };
    const [row] = readTestsYaml(doc, new Set(["restart"]));
    expect(row).toMatchObject({ name: "restart", invalid: expect.stringContaining("restart") });
  });

  test.each([
    ["empty", ""],
    ["containing a slash", "a/b"],
    ["starting with a dot", ".hidden"],
  ])("a scenario name %s is invalid", (_, name) => {
    const doc = { scenarios: { [name]: { outcome: "paged" } } };
    const [row] = readTestsYaml(doc, NO_FOLDERS);
    expect(row).toMatchObject({ name, invalid: expect.any(String) });
  });

  test("a scenario that isn't a mapping is invalid", () => {
    const doc = { scenarios: { x: "not a mapping" } };
    const [row] = readTestsYaml(doc, NO_FOLDERS);
    expect(row).toMatchObject({ name: "x", invalid: expect.any(String) });
  });

  test("a scenario's commands that isn't a mapping is invalid", () => {
    const doc = { scenarios: { x: { outcome: "paged", commands: [] } } };
    const [row] = readTestsYaml(doc, NO_FOLDERS);
    expect(row).toMatchObject({ name: "x", invalid: expect.any(String) });
  });

  test("a document that isn't a mapping is one invalid entry named tests.yaml", () => {
    expect(readTestsYaml("not a mapping", NO_FOLDERS)).toEqual([{ name: "tests.yaml", invalid: expect.any(String) }]);
  });

  test("no scenarios key is one invalid entry named tests.yaml", () => {
    expect(readTestsYaml({}, NO_FOLDERS)).toEqual([{ name: "tests.yaml", invalid: expect.any(String) }]);
  });

  test.each([
    ["scenarios isn't a mapping", { scenarios: [] }],
    ["scenarios is empty", { scenarios: {} }],
  ])("%s is one invalid entry named tests.yaml", (_, doc) => {
    expect(readTestsYaml(doc, NO_FOLDERS)).toEqual([{ name: "tests.yaml", invalid: expect.any(String) }]);
  });

  test("an unknown top-level key makes every scenario the document would have defined invalid", () => {
    const doc = { scenarios: { x: { outcome: "paged" }, y: { outcome: "paged" } }, colour: "red" };
    const rows = readTestsYaml(doc, NO_FOLDERS);
    expect(rows).toEqual([
      { name: "x", invalid: expect.stringContaining("unknown key colour") },
      { name: "y", invalid: expect.stringContaining("unknown key colour") },
    ]);
  });

  test("a malformed defaults makes every scenario the document would have defined invalid", () => {
    const doc = { defaults: { colour: "red" }, scenarios: { x: { outcome: "paged" } } };
    expect(readTestsYaml(doc, NO_FOLDERS)).toEqual([{ name: "x", invalid: expect.stringContaining("defaults.colour") }]);
  });
});
