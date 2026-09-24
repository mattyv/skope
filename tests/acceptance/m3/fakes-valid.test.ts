// Every fake answer/command file for every scenario in SPEC §12.1 validates
// against contracts/fakes.schema.json, and every expected-exit is one of
// the outcome codes in SPEC §4.1. PLAN.md §4 F: "add a test that validates
// them all". This passes now — it doesn't wait for any milestone.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import { allScenarios, ROOT, readExpectedExit, readYaml } from "../lib/scenarios.js";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020").default;
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const fakesSchema = JSON.parse(readFileSync(`${ROOT}/contracts/fakes.schema.json`, "utf8"));
ajv.addSchema(fakesSchema);
const validateAnswers = ajv.getSchema(`${fakesSchema.$id}#/$defs/answers`);
const validateCommands = ajv.getSchema(`${fakesSchema.$id}#/$defs/commands`);
if (!validateAnswers || !validateCommands) throw new Error("fakes.schema.json is missing $defs/answers or $defs/commands");

const EXIT_CODES = new Set([0, 10, 20, 30, 31, 40, 50]);

describe("fake scenario files validate against contracts/fakes.schema.json (SPEC §5.4, §6.2)", () => {
  const scenarios = allScenarios();

  test("there's at least one scenario per fixture", () => {
    const fixtures = new Set(scenarios.map((s) => s.fixture));
    expect(fixtures).toEqual(new Set(["disk-full", "cert-expiry", "error-triage"]));
  });

  for (const s of scenarios) {
    describe(`${s.fixture}/${s.name}`, () => {
      test("answers.yaml is a valid Fakes answers object", () => {
        const answers = readYaml(s.answersPath);
        expect(validateAnswers(answers), JSON.stringify(validateAnswers.errors)).toBe(true);
      });

      test("commands.yaml is a valid Fakes commands object", () => {
        const commands = readYaml(s.commandsPath);
        expect(validateCommands(commands), JSON.stringify(validateCommands.errors)).toBe(true);
      });

      test("expected-exit is one of skope's outcome codes (SPEC §4.1)", () => {
        expect(EXIT_CODES.has(readExpectedExit(s.expectedExitPath))).toBe(true);
      });

      test("a golden event stream exists for this scenario", () => {
        expect(() => readFileSync(s.goldenPath, "utf8")).not.toThrow();
      });
    });
  }
});
