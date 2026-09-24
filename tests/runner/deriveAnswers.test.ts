// Derived scripted answers (docs/design/skill-tests.md): a scripted
// scenario's `asks` alone can answer an ask, without answers.yaml.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { CoreProgram } from "../../src/contracts.gen.js";
import { preprocess } from "../../src/preprocess/index.js";
import { deriveAnswers } from "../../src/runner/deriveAnswers.js";
import { ROOT } from "../acceptance/lib/scenarios.js";

function program(md: string): CoreProgram {
  const r = preprocess(md);
  if (!("program" in r)) throw new Error(JSON.stringify(r.errors));
  return r.program;
}
const diskFull = program(readFileSync(`${ROOT}/fixtures/disk-full/SKILL.md`, "utf8"));

const sum = (probs: Record<string, number>) => Object.values(probs).reduce((a, b) => a + b, 0);

describe("deriveAnswers", () => {
  test("no asks: the answers are returned as they are", () => {
    const answers = { "Triage.ask": "unsure" };
    expect(deriveAnswers(diskFull, undefined, answers)).toEqual(answers);
  });

  test("an ask named in asks with no existing answer gets a confident, valid answer", () => {
    const out = deriveAnswers(diskFull, { Triage: { chosen: "Restart" } }, {});
    const probs = out["line:27"] as Record<string, number>;
    expect(probs).toBeDefined();
    // Certain, so it clears any sure, 100% included; every other option is named, at 0.
    expect(probs).toEqual({ "s:clean_up": 0, "s:restart": 1, "s:page": 0, "s:investigate": 0 });
    expect(sum(probs)).toBe(1);
  });

  test("a one-of ask's derived answer is keyed by the item's value", () => {
    const out = deriveAnswers(diskFull, { "Restart.service": { chosen: "myapp-worker" } }, {});
    const probs = out["line:46"] as Record<string, number>;
    expect(probs["myapp-worker"]).toBeGreaterThan(0.99);
    expect(sum(probs)).toBeCloseTo(1, 6);
  });

  test("an existing line:N answer for that ask is left alone", () => {
    const answers = { "line:27": { "s:clean_up": 1 } };
    expect(deriveAnswers(diskFull, { Triage: { chosen: "Restart" } }, answers)).toEqual(answers);
  });

  test("an existing Section.ask answer for that ask is left alone", () => {
    const answers = { "Triage.ask": { "s:clean_up": 1 } };
    expect(deriveAnswers(diskFull, { Triage: { chosen: "Restart" } }, answers)).toEqual(answers);
  });

  test("an existing exact-text answer for that ask is left alone", () => {
    const p = program(
      "---\nname: tiny\ndescription: t\nformat: 1\n---\n\n## Main\nDo it.\n\n- **ask** Is this ok? → yes | no · sure 80%\n- **stop**\n",
    );
    const answers = { "Is this ok?": { yes: 1 } };
    expect(deriveAnswers(p, { Main: { chosen: "yes" } }, answers)).toEqual(answers);
  });

  test("asks.key naming no ask is skipped: reported elsewhere as invalid", () => {
    expect(deriveAnswers(diskFull, { Nope: { chosen: "x" } }, {})).toEqual({});
  });

  test("existing answers for other asks are kept alongside the derived one", () => {
    const out = deriveAnswers(diskFull, { Triage: { chosen: "Restart" } }, { "Restart.service": "unsure" });
    expect(out["Restart.service"]).toBe("unsure");
    expect(out["line:27"]).toBeDefined();
  });
});
