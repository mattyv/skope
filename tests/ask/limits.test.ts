// Backend limits (SPEC §6.2 table): a backend can only lower the
// language's maximums, and skop checks the skill against them before the
// run starts (E-BACKEND-LIMIT, §12.2).

import { describe, expect, test } from "vitest";
import { FAKE_LIMITS, JEV_LIMITS, OPENROUTER_LIMITS } from "../../src/ask/limits.js";
import { checkAskLimits } from "../../src/ask/types.js";

describe("checkAskLimits (SPEC §6.2, §12.2)", () => {
  test("declares the limits table from SPEC §6.2", () => {
    expect(JEV_LIMITS).toEqual({
      maxOptions: 255,
      maxScoreLevels: 10,
      contextTokens: 30000,
    });
    expect(OPENROUTER_LIMITS).toEqual({
      maxOptions: 20,
      maxScoreLevels: 10,
      contextTokens: null,
    });
    expect(FAKE_LIMITS).toEqual({
      maxOptions: 255,
      maxScoreLevels: 10,
      contextTokens: null,
    });
  });

  test("21 options on openrouter is E-BACKEND-LIMIT (max 20)", () => {
    const r = checkAskLimits({ kind: "choice", optionCount: 21, declaredContextTokens: null }, OPENROUTER_LIMITS);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe("E-BACKEND-LIMIT");
  });

  test("20 options on openrouter is within the limit", () => {
    expect(checkAskLimits({ kind: "choice", optionCount: 20, declaredContextTokens: null }, OPENROUTER_LIMITS).ok).toBe(true);
  });

  test("ask_context: 40k tokens on the jev backend is E-BACKEND-LIMIT (max 30k)", () => {
    const r = checkAskLimits({ kind: "choice", optionCount: 4, declaredContextTokens: 40000 }, JEV_LIMITS);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe("E-BACKEND-LIMIT");
  });

  test("ask_context under the jev limit passes", () => {
    expect(checkAskLimits({ kind: "choice", optionCount: 4, declaredContextTokens: 4000 }, JEV_LIMITS).ok).toBe(true);
  });

  test("a backend with no context limit (fake) never fails on context size", () => {
    expect(checkAskLimits({ kind: "choice", optionCount: 4, declaredContextTokens: 1_000_000 }, FAKE_LIMITS).ok).toBe(true);
  });

  test("a score ask checks the level count against maxScoreLevels, not maxOptions", () => {
    // openrouter's option cap (20) is lower than its score cap (10 is the
    // language max anyway), so this exercises the score branch specifically.
    const r = checkAskLimits({ kind: "score", optionCount: 11, declaredContextTokens: null }, JEV_LIMITS);
    expect(r.ok).toBe(false);
  });
});
