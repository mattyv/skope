// Shared ajv validator for backend outputs (finding 8): every AskOutput a
// test produces, success or failure, must validate against
// contracts/ask.schema.json#/$defs/output. Set up the same way as
// tests/contracts.test.ts (Ajv2020, strict, allowUnionTypes).

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect } from "vitest";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020").default;
const read = (p: string) => JSON.parse(readFileSync(new URL(`../../contracts/${p}`, import.meta.url), "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
ajv.addSchema(read("ask.schema.json"));
const validateOutput = ajv.getSchema("https://github.com/mattyv/skope/contracts/ask.schema.json#/$defs/output");
if (!validateOutput) throw new Error("no ask.schema.json#/$defs/output schema");

/** Asserts `out` validates against the ask output contract, then returns
 * it unchanged so it can be used inline: `const out = expectValidAskOutput(await askJev(...))`. */
export function expectValidAskOutput<T>(out: T): T {
  const ok = validateOutput(out);
  expect(ok, JSON.stringify(validateOutput.errors)).toBe(true);
  return out;
}
