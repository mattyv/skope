// The fake ask backend (SPEC §6.2, contracts/fakes.schema.json): answers
// questions from answers.yaml instead of a real backend. Used by tests and
// `skop --fake`.
//
// A key is the question text exactly as sent, or `line:N` (the statement's
// source-map id), which wins when both match. `unsure` is a uniform
// answer over the options, always a tie, so the gate fails. `unavailable`
// is a backend failure (ask_unavailable). Anything else is a probs object,
// passed through as-is (valid or not: the core does the real validation,
// SPEC §6.1).

import type { FakesAnswers } from "../contracts.gen.js";
import type { AskOutput, AskRequest } from "./types.js";

export class FakeAskUnmatched extends Error {
  readonly code = "FAKE_ASK_UNMATCHED";
}

export function askFake(answers: FakesAnswers, request: AskRequest, src?: number): AskOutput {
  const lineKey = src !== undefined ? `line:${src}` : undefined;
  const key = lineKey !== undefined && Object.hasOwn(answers, lineKey) ? lineKey : request.question;
  if (!Object.hasOwn(answers, key)) {
    throw new FakeAskUnmatched(`--fake has no answer for: ${key}`);
  }
  const entry = answers[key];

  if (entry === "unavailable") {
    return {
      error: "unavailable",
      detail: "fake: unavailable",
      backend: "fake",
    };
  }
  if (entry === "unsure") {
    const p = 1 / request.options.length;
    const probs: Record<string, number> = {};
    for (const o of request.options) probs[o.id] = p;
    return { probs, backend: "fake", model: "fake", ms: 0 };
  }
  const { unassigned, ...probs } = entry as Record<string, number>;
  const answer: import("./types.js").AskAnswer = {
    probs,
    backend: "fake",
    model: "fake",
    ms: 0,
  };
  if (unassigned !== undefined) answer.unassigned = unassigned;
  return answer;
}
