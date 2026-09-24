// The jev backend: TypeSafe Jev (SPEC §6.2). Checked against the docs for
// jev-1.13 in September 2026.
//
// Wire format per TypeSafe's docs (docs.typesafe.ai/api, /primitives):
// choice sends criteria as label → description and answers with
// `probabilities` keyed by label; yesno is a Noul, sent without criteria,
// answering a single `noul` = P(yes); score sends the rubric as an array,
// lowest level first, and answers with `probabilities` keyed "0", "1", …
// by array position.

import type { HttpDeps, RetryConfig } from "./retry.js";
import { fetchWithRetry } from "./retry.js";
import type { AskOutput, AskRequest } from "./types.js";

export interface JevConfig {
  model: string;
  apiKey: string;
  url?: string;
}

const DEFAULT_URL = "https://api.typesafe.ai/v1/systemone";

// TypeSafe pins as jev-X.Y.Z. On OpenRouter, typesafe/jev-1.13 answered as typesafe/jev-1.13-20260917
// (September 2026), so a dated id is taken to name one snapshot. That's inferred from its responses,
// not documented by OpenRouter: if a dated id turns out to move, drop the second alternative.
const PINNED_MODEL = /^(jev-\d+\.\d+\.\d+|typesafe\/jev-\d+\.\d+-\d{8})$/;

/** An alias like `jev-latest` (SPEC §6.2): anything that isn't a pinned version. */
export function isModelAlias(model: string): boolean {
  return !PINNED_MODEL.test(model);
}

interface JevQuestion {
  type: "choice" | "noul" | "score";
  instructions: { question: string; guidance?: string };
  criteria?: Record<string, string | null> | string[];
}

function buildQuestion(request: AskRequest): JevQuestion {
  const instructions =
    request.guidance === null ? { question: request.question } : { question: request.question, guidance: request.guidance };
  if (request.kind === "score") {
    // Lowest level first, per SPEC §6.2. Options already arrive LOW..HIGH.
    return {
      type: "score",
      instructions,
      criteria: request.options.map((o) => o.description ?? ""),
    };
  }
  if (request.kind === "yesno") return { type: "noul", instructions };
  const criteria: Record<string, string | null> = {};
  for (const o of request.options) criteria[o.label] = o.description;
  return { type: "choice", instructions, criteria };
}

interface JevAnswerBody {
  model: string;
  answers?: {
    q?: {
      type: string;
      probabilities?: Record<string, number>;
      noul?: unknown;
    };
  };
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
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      }),
    retryCfg,
    deps,
  );

  if (res === null) {
    return {
      error: "unavailable",
      detail: "jev: no response (timeout or connection error)",
      backend: "jev",
      model: config.model,
    };
  }
  if (res.status === 413) {
    return {
      error: "request_too_large",
      detail: "jev: request too large",
      backend: "jev",
      model: config.model,
    };
  }
  if (!res.ok) {
    return {
      error: "unavailable",
      detail: `jev: HTTP ${res.status}`,
      backend: "jev",
      model: config.model,
    };
  }

  let json: JevAnswerBody;
  try {
    json = JSON.parse(res.text) as JevAnswerBody;
  } catch {
    return {
      error: "unavailable",
      detail: "jev: response wasn't valid JSON",
      backend: "jev",
      model: config.model,
    };
  }

  if (typeof json.model !== "string" || json.model === "") {
    return {
      error: "unavailable",
      detail: "jev: response has no model",
      backend: "jev",
      model: config.model,
    };
  }

  if (request.kind === "yesno") {
    const p = json.answers?.q?.noul;
    if (typeof p !== "number") {
      return {
        error: "unavailable",
        detail: "jev: response has no answers.q.noul",
        backend: "jev",
        model: config.model,
      };
    }
    // The core validates the range (P5); 1 - p keeps the pair summing to 1.
    return {
      probs: { yes: p, no: 1 - p },
      backend: "jev",
      model: json.model,
      ms: Date.now() - started,
    };
  }

  const rawProbabilities = json.answers?.q?.probabilities;
  if (!rawProbabilities) {
    return {
      error: "unavailable",
      detail: "jev: response has no answers.q.probabilities",
      backend: "jev",
      model: config.model,
    };
  }
  // Own-properties only, looked up with Object.hasOwn: a label like
  // "constructor" or "__proto__" must never resolve to something inherited
  // from Object.prototype when it's actually missing from the response.
  const probabilities = Object.fromEntries(Object.entries(rawProbabilities));

  const probs: Record<string, number> = {};
  if (request.kind === "score") {
    for (let i = 0; i < request.options.length; i++) {
      const option = request.options[i];
      const key = String(i);
      if (option === undefined || !Object.hasOwn(probabilities, key)) {
        return {
          error: "unavailable",
          detail: `jev: missing probability for level ${i}`,
          backend: "jev",
          model: config.model,
        };
      }
      probs[option.id] = probabilities[key] as number;
    }
  } else {
    for (const o of request.options) {
      if (!Object.hasOwn(probabilities, o.label)) {
        return {
          error: "unavailable",
          detail: `jev: missing probability for "${o.label}"`,
          backend: "jev",
          model: config.model,
        };
      }
      probs[o.id] = probabilities[o.label] as number;
    }
  }

  // Jev always reports 0 unassigned probability (SPEC §6.2): omitted, so
  // the default applies.
  return { probs, backend: "jev", model: json.model, ms: Date.now() - started };
}
