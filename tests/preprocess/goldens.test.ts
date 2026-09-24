// M1 goldens (SPEC §12.3): the preprocessor's output for disk-full and
// cert-expiry must equal contracts/examples/*.core.json exactly.
// error-triage (v1.1, Score) is also a golden, per the stream brief.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { preprocess } from "../../src/preprocess/index.js";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const cases = [
  { name: "disk-full", skill: "../../fixtures/disk-full/SKILL.md", golden: "../../contracts/examples/disk-full.core.json" },
  { name: "cert-expiry", skill: "../../fixtures/cert-expiry/SKILL.md", golden: "../../contracts/examples/cert-expiry.core.json" },
  {
    name: "error-triage (v1.1 Score)",
    skill: "../../fixtures/error-triage/SKILL.md",
    golden: "../../contracts/examples/error-triage.core.json",
  },
];

describe("preprocess produces the exact M1 golden core JSON", () => {
  for (const { name, skill, golden } of cases) {
    test(name, () => {
      const md = read(skill);
      const expected = JSON.parse(read(golden));
      const result = preprocess(md);
      if ("errors" in result) {
        throw new Error(`expected a program, got errors: ${JSON.stringify(result.errors, null, 2)}`);
      }
      expect(result.program).toEqual(expected);
    });
  }
});
