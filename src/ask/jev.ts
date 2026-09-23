// The jev backend: TypeSafe Jev (SPEC §6.2). Checked against the docs for
// jev-1.13 in September 2026.
//
// ponytail: SPEC.md only shows the wire format for a `choice` question
// (§6.2's disk-full example). It names Jev's `yesno` type "Noul" and its
// `score` type "Score" but never gives their request/response JSON, and
// this environment has no network access to TypeSafe's real docs to check
// against. This implementation treats `yesno` as a 2-option choice over
// "yes"/"no" (same wire shape as `choice`, which every fact SPEC states
// about Noul — a single yes-probability — is consistent with), and reads
// Score's `probabilities` as an object keyed by the rubric's 0-based array
// position, matching "Jev numbers levels by array position from 0" (§6.2).
// Flagging this per PLAN.md §1: verify against TypeSafe's real API docs
// before this ships; nothing here should be trusted uncross-checked.

import type { HttpDeps, RetryConfig } from "./retry.js";
import { fetchWithRetry } from "./retry.js";
import type { AskOutput, AskRequest } from "./types.js";

export interface JevConfig {
  model: string;
  apiKey: string;
  url?: string;
}

const DEFAULT_URL = "https://api.typesafe.ai/v1/systemone";

/** An alias like `jev-latest` (SPEC §6.2): anything that isn't a plain `jev-X.Y.Z`. */
export function isModelAlias(model: string): boolean {
  return !/^jev-\d+\.\d+\.\d+$/.test(model);
}

/** A response reporting a different model than configured (SPEC §6.2, W-MODEL-ALIAS). */
export function modelMismatch(configured: string, responded: string): boolean {
  return configured !== responded;
}

interface JevQuestion {
  type: "choice" | "yesno" | "score";
  instructions: { question: string; guidance?: string };
  criteria: Record<string, string | null> | string[];
}

function buildQuestion(request: AskRequest): JevQuestion {
  const instructions =
    request.guidance === null ? { question: request.question } : { question: request.question, guidance: request.guidance };
  if (request.kind === "score") {
    // Lowest level first, per SPEC §6.2. Options already arrive LOW..HIGH.
    return { type: "score", instructions, criteria: request.options.map((o) => o.description ?? "") };
  }
  const criteria: Record<string, string | null> = {};
  for (const o of request.options) criteria[o.label] = o.description;
  return { type: request.kind, instructions, criteria };
}

interface JevAnswerBody {
  model: string;
  answers?: { q?: { type: string; probabilities?: Record<string, number> } };
}

export async function askJev(request: AskRequest, config: JevConfig, retryCfg: RetryConfig, deps: HttpDeps): Promise<AskOutput> {
  const url = config.url ?? DEFAULT_URL;
  const body = {
    model: config.model,
    state: request.context,
    questions: { q: buildQuestion(request) },
  };
  const started = Date.now();

  const res = await fetchWithRetry(
    (signal) =>
      deps.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(body),
        signal,
      }),
    retryCfg,
    deps,
  );

  if (res === null) {
    return { error: "unavailable", detail: "jev: no response (timeout or connection error)", backend: "jev", model: config.model };
  }
  if (res.status === 413) {
    return { error: "request_too_large", detail: "jev: request too large", backend: "jev", model: config.model };
  }
  if (!res.ok) {
    return { error: "unavailable", detail: `jev: HTTP ${res.status}`, backend: "jev", model: config.model };
  }

  let json: JevAnswerBody;
  try {
    json = (await res.json()) as JevAnswerBody;
  } catch {
    return { error: "unavailable", detail: "jev: response wasn't valid JSON", backend: "jev", model: config.model };
  }

  const probabilities = json.answers?.q?.probabilities;
  if (!probabilities) {
    return { error: "unavailable", detail: "jev: response has no answers.q.probabilities", backend: "jev", model: config.model };
  }

  const probs: Record<string, number> = {};
  if (request.kind === "score") {
    for (let i = 0; i < request.options.length; i++) {
      const option = request.options[i];
      const p = probabilities[String(i)];
      if (option === undefined || p === undefined) {
        return { error: "unavailable", detail: `jev: missing probability for level ${i}`, backend: "jev", model: config.model };
      }
      probs[option.id] = p;
    }
  } else {
    for (const o of request.options) {
      const p = probabilities[o.label];
      if (p === undefined) {
        return { error: "unavailable", detail: `jev: missing probability for "${o.label}"`, backend: "jev", model: config.model };
      }
      probs[o.id] = p;
    }
  }

  // Jev always reports 0 unassigned probability (SPEC §6.2): omitted, so
  // the default applies.
  return { probs, backend: "jev", model: json.model, ms: Date.now() - started };
}
