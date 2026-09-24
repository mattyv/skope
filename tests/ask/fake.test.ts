// The fake ask backend (SPEC §6.2, contracts/fakes.schema.json).

import { describe, expect, test } from "vitest";
import { askFake, FakeAskUnmatched } from "../../src/ask/fake.js";
import type { AskRequest } from "../../src/ask/types.js";
import { isFailure } from "../../src/ask/types.js";
import { expectValidAskOutput } from "./schema-helpers.js";

const req = (over: Partial<AskRequest> = {}): AskRequest => ({
  kind: "choice",
  question: "Given `used`, what next?",
  guidance: null,
  options: [
    { id: "s:clean_up", label: "Clean up", description: null },
    { id: "s:restart", label: "Restart", description: null },
  ],
  context: { used: "91%" },
  timeout_ms: 2000,
  ...over,
});

describe("askFake (SPEC §6.2, contracts/fakes.schema.json)", () => {
  test("keyed by the question text as sent", () => {
    const out = expectValidAskOutput(askFake({ "Given `used`, what next?": { "s:clean_up": 0.7, "s:restart": 0.3 } }, req()));
    expect(isFailure(out)).toBe(false);
    expect(!isFailure(out) && out.probs).toEqual({
      "s:clean_up": 0.7,
      "s:restart": 0.3,
    });
  });

  test("line:N wins when both the question text and the line key match", () => {
    const answers = {
      "Given `used`, what next?": { "s:clean_up": 0.1, "s:restart": 0.9 },
      "line:14": { "s:clean_up": 0.9, "s:restart": 0.1 },
    };
    const out = askFake(answers, req(), 14);
    expect(!isFailure(out) && out.probs).toEqual({
      "s:clean_up": 0.9,
      "s:restart": 0.1,
    });
  });

  test("falls back to the question text when line:N has no entry", () => {
    const out = askFake({ "Given `used`, what next?": { "s:clean_up": 1, "s:restart": 0 } }, req(), 99);
    expect(!isFailure(out) && out.probs).toEqual({
      "s:clean_up": 1,
      "s:restart": 0,
    });
  });

  test("unsure is a uniform answer over the options, always a tie", () => {
    const out = askFake({ "line:1": "unsure" }, req(), 1);
    expect(!isFailure(out) && out.probs).toEqual({
      "s:clean_up": 0.5,
      "s:restart": 0.5,
    });
  });

  test("unavailable is a backend failure with reason unavailable", () => {
    const out = expectValidAskOutput(askFake({ "line:1": "unavailable" }, req(), 1));
    expect(isFailure(out) && out.error).toBe("unavailable");
  });

  test("probs (including an invalid one) pass through unchanged for the core to validate", () => {
    // Deliberately invalid (doesn't sum to 1): the fake backend doesn't
    // validate, per SPEC §6.1's "the answer schema checks shape only".
    const out = askFake({ "line:1": { "s:clean_up": 1.1, "s:restart": -0.2 } }, req(), 1);
    expect(!isFailure(out) && out.probs).toEqual({
      "s:clean_up": 1.1,
      "s:restart": -0.2,
    });
  });

  test("unassigned is passed through when present", () => {
    const out = askFake({ "line:1": { "s:clean_up": 0.5, "s:restart": 0.2, unassigned: 0.3 } }, req(), 1);
    expect(!isFailure(out) && out.probs).toEqual({
      "s:clean_up": 0.5,
      "s:restart": 0.2,
    });
    expect(!isFailure(out) && out.unassigned).toBe(0.3);
  });

  test("a question with no matching key throws", () => {
    expect(() => askFake({}, req())).toThrow(FakeAskUnmatched);
  });

  test("an unmatched fake ask uses code E-FAKE-UNMATCHED", () => {
    try {
      askFake({}, req());
      expect.unreachable("askFake should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(FakeAskUnmatched);
      expect((err as FakeAskUnmatched).code).toBe("E-FAKE-UNMATCHED");
    }
  });
});
