// The hand check of --fake and --fake-exec files (src/runner/fakes.ts)
// against contracts/fakes.schema.json, with ajv as the oracle: they must
// agree on every scenario's files, on hand-picked invalid ones, and on
// random documents built from the shapes that matter.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import { fakesError } from "../../src/runner/fakes.js";
import { allScenarios, ROOT, readYaml } from "../acceptance/lib/scenarios.js";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020").default;
const schema = JSON.parse(readFileSync(`${ROOT}/contracts/fakes.schema.json`, "utf8"));
const ajv = new Ajv2020({ strict: false }).addSchema(schema);
const byAjv = (def: "answers" | "commands") => ajv.getSchema(`${schema.$id}#/$defs/${def}`) as (v: unknown) => boolean;

function agree(doc: unknown, def: "answers" | "commands") {
  expect(fakesError(doc, def) === null, `${def} ${JSON.stringify(doc)}: ${fakesError(doc, def)}`).toBe(byAjv(def)(doc));
}

describe("fake files: the hand check agrees with contracts/fakes.schema.json", () => {
  test("every scenario's answers.yaml and commands.yaml pass both", () => {
    for (const s of allScenarios()) {
      for (const [path, def] of [
        [s.answersPath, "answers"],
        [s.commandsPath, "commands"],
      ] as const) {
        const doc = readYaml(path);
        expect(fakesError(doc, def), path).toBeNull();
        agree(doc, def);
      }
    }
  });

  const invalidCommands: unknown[] = [
    [],
    null,
    "x",
    { "": { exit: 0 } },
    { x: {} },
    { x: { exit: "0" } },
    { x: { exit: 1.5 } },
    { x: { exit: Number.NaN } },
    { x: { exit: 0, sdtout: "typo" } },
    { x: { exit: 0, stdout: 1 } },
    { x: { exit: 0, stderr: null } },
    { x: { exit: 0, timed_out: "yes" } },
    { x: { exit: 0, ms: -1 } },
    { x: { exit: 0, ms: 0.5 } },
    { x: [] },
    { x: [{ exit: 0 }, { stdout: "" }] },
    { x: [[{ exit: 0 }]] },
    { x: null },
  ];
  const validCommands: unknown[] = [
    {},
    { x: { exit: null, timed_out: true } },
    { x: { exit: 1.0, ms: 0 } },
    { x: { exit: Number.POSITIVE_INFINITY } }, // JSON Schema's `integer`, as ajv checks it
    { "line:3": [{ exit: 1 }, { exit: 0, stdout: "", stderr: "", ms: 5 }] },
  ];
  const invalidAnswers: unknown[] = [
    [],
    null,
    { "": "unsure" },
    { q: "maybe" },
    { q: {} },
    { q: { a: "0.5" } },
    { q: { a: null } },
    { q: [0.5] },
    { q: null },
  ];
  const validAnswers: unknown[] = [{}, { q: "unsure" }, { q: "unavailable" }, { q: { a: 0.5, unassigned: 0.5 } }, { q: { a: Number.NaN } }];

  test.each([
    ...invalidCommands.map((d) => [d, "commands"] as const),
    ...validCommands.map((d) => [d, "commands"] as const),
    ...invalidAnswers.map((d) => [d, "answers"] as const),
    ...validAnswers.map((d) => [d, "answers"] as const),
  ])("%j as %s", (doc, def) => agree(doc, def));

  test("the hand-picked invalid files really are invalid", () => {
    for (const d of invalidCommands) expect(fakesError(d, "commands"), JSON.stringify(d)).not.toBeNull();
    for (const d of invalidAnswers) expect(fakesError(d, "answers"), JSON.stringify(d)).not.toBeNull();
  });

  test("random documents: both agree", () => {
    // mulberry32: a small seeded PRNG, so a failure reproduces.
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (((t ^ (t >>> 14)) >>> 0) % 2 ** 32) % n;
    };
    const pick = <T>(xs: T[]): T => xs[rand(xs.length)] as T;
    const times = <T>(n: number, f: () => T): T[] => Array.from({ length: rand(n) }, f);
    // Mostly good values, with every kind of bad one mixed in.
    const pools: Record<string, unknown[]> = {
      exit: [0, 1, -2, null, 0, 1.5, "0", Number.NaN, true],
      stdout: ["", "x", "y", 1, null],
      stderr: ["", "x", "y", 1, null],
      timed_out: [true, false, false, "yes", 0],
      ms: [0, 5, 100, -1, 0.5, "5"],
      sdtout: ["typo"],
    };
    const result = () =>
      Object.fromEntries(
        Object.entries(pools)
          .filter(([k]) => rand(8) < (k === "exit" ? 7 : k === "sdtout" ? 1 : 4))
          .map(([k, v]) => [k, pick(v)]),
      );
    const answer = () =>
      pick<() => unknown>([
        () => pick(["unsure", "unavailable", "maybe", 0.5, null]),
        () => Object.fromEntries(times(4, () => [pick(["a", "b", "yes", "", "unassigned"]), pick([0.5, 0, 1, 0.25, "0.5", null])])),
        () => times(2, () => 0.5),
      ])();
    const command = () => pick<() => unknown>([result, result, () => times(3, result), () => pick(["x", null, 1, [[{ exit: 0 }]]])])();
    const doc = (value: () => unknown) =>
      rand(10) === 0 ? pick([[], null, "x", 1]) : Object.fromEntries(times(4, () => [pick(["x", "line:3", "q", ""]), value()]));
    const valid = { commands: 0, answers: 0 };
    for (let i = 0; i < 3000; i++) {
      for (const [def, value] of [
        ["commands", command],
        ["answers", answer],
      ] as const) {
        const d = doc(value);
        agree(d, def);
        if (byAjv(def)(d)) valid[def]++;
      }
    }
    // Both sides of the line get exercised.
    expect(valid.commands).toBeGreaterThan(300);
    expect(valid.answers).toBeGreaterThan(300);
  });
});
