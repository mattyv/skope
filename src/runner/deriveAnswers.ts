// Derived scripted answers (docs/design/skill-tests.md, SPEC §7.3): in
// scripted (non-live) mode, an expect.yaml `asks.<key>.chosen` an
// answers.yaml doesn't already cover gets a scripted answer that confidently
// chooses it, so `asks` alone is enough for a scenario without an
// answers.yaml, or without one entry for every ask it names.

import type { CoreProgram } from "../contracts.gen.js";
import { askOptionIds, chosenOptionId, findAsk } from "./askOptions.js";
import type { Expect } from "./expect.js";
import { answerTemplate, askLine, resolveFakeKeys } from "./fakeKeys.js";

/** The chosen option's probability: certain, so it clears any `sure`, `sure 100%` included. */
const CHOSEN_CONFIDENCE = 1;

/**
 * `answers` with a `line:N` entry added for every `asks` key not already answered: by an existing
 * stable key, `line:N` key, or exact-text key for that ask. The chosen option gets
 * `CHOSEN_CONFIDENCE` and every other option 0, so the answer is valid and never a tie.
 */
export function deriveAnswers(program: CoreProgram, asks: Expect["asks"], answers: Record<string, unknown>): Record<string, unknown> {
  if (!asks || Object.keys(asks).length === 0) return answers;
  const out = { ...answers };
  const { doc: resolved } = resolveFakeKeys(program, answers, "answers", false);
  for (const [key, want] of Object.entries(asks)) {
    const line = askLine(program, key);
    if (line === null) continue; // reported separately: asks.<key> doesn't name exactly one ask
    if (Object.hasOwn(resolved, `line:${line}`)) continue; // a stable or line:N key already answers it
    const template = answerTemplate(program, line);
    if (template && Object.keys(answers).some((k) => template.test(k))) continue; // exact text already answers it
    const ask = findAsk(program, line);
    if (!ask) continue;
    const chosen = chosenOptionId(ask, want.chosen);
    const others = askOptionIds(program, ask).filter((id) => id !== chosen);
    const probs: Record<string, number> = { [chosen]: CHOSEN_CONFIDENCE };
    for (const id of others) probs[id] = 0;
    out[`line:${line}`] = probs;
  }
  return out;
}
