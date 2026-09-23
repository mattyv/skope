// The openrouter backend: a general model through OpenRouter (SPEC §6.2).
//
// ponytail: exact OpenRouter parameter names for disabling reasoning and
// requiring provider parameters aren't fully pinned in SPEC.md (it says
// "historically provider.require_parameters: true" and just "turn
// reasoning off"), and this environment has no network access to check
// OpenRouter's current docs. Implemented as `provider: {
// require_parameters: true }` and `reasoning: { enabled: false }`,
// following the OpenAI-compatible chat-completions + logprobs shape.
// Flagging per PLAN.md §1: verify against OpenRouter's real docs before
// this ships.

import type { HttpDeps, RetryConfig } from "./retry.js";
import { fetchWithRetry } from "./retry.js";
import type { AskOutput, AskRequest } from "./types.js";

export interface OpenRouterConfig {
  model: string;
  apiKey: string;
  minMass?: number; // default 0.5 (SPEC §9)
  url?: string;
}

const DEFAULT_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODELS_URL = "https://openrouter.ai/api/v1/models";
const LETTERS = "ABCDEFGHIJKLMNOPQRST"; // 20: OpenRouter's alternatives cap (§6.2)

/** Labels options A, B, C… in order, and builds the fixed prompt template (SPEC §6.2). */
export function buildPrompt(request: AskRequest): string {
  const lines = [request.question];
  if (request.guidance) lines.push(request.guidance);
  const contextEntries = Object.entries(request.context);
  if (contextEntries.length > 0) {
    lines.push("", "Context:");
    for (const [k, v] of contextEntries) lines.push(`${k}: ${v}`);
  }
  lines.push("", "Options:");
  request.options.forEach((o, i) => {
    const letter = LETTERS[i];
    lines.push(o.description ? `${letter}: ${o.label} — ${o.description}` : `${letter}: ${o.label}`);
  });
  lines.push("", "Answer with the letter alone.");
  return lines.join("\n");
}

interface TopLogprob {
  token: string;
  logprob: number;
}

interface ChatCompletion {
  choices?: {
    message?: { reasoning?: string | null };
    logprobs?: { content?: { token: string; top_logprobs?: TopLogprob[] }[] } | null;
  }[];
}

export async function askOpenRouter(
  request: AskRequest,
  config: OpenRouterConfig,
  retryCfg: RetryConfig,
  deps: HttpDeps,
): Promise<AskOutput> {
  const url = config.url ?? DEFAULT_URL;
  const minMass = config.minMass ?? 0.5;
  const started = Date.now();

  const body = {
    model: config.model,
    messages: [{ role: "user", content: buildPrompt(request) }],
    max_tokens: 1,
    temperature: 0,
    logprobs: true,
    top_logprobs: 20,
    provider: { require_parameters: true },
    reasoning: { enabled: false },
  };

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

  const fail = (detail: string): AskOutput => ({ error: "unavailable", detail, backend: "openrouter", model: config.model });

  if (res === null) return fail("openrouter: no response (timeout or connection error)");
  if (!res.ok) return fail(`openrouter: HTTP ${res.status}`);

  let json: ChatCompletion;
  try {
    json = (await res.json()) as ChatCompletion;
  } catch {
    return fail("openrouter: response wasn't valid JSON");
  }

  const choice = json.choices?.[0];
  const content = choice?.logprobs?.content?.[0];
  if (!choice?.logprobs || !content) {
    if (choice?.message?.reasoning) return fail("openrouter: reasoning-only reply, no visible answer token");
    return fail("openrouter: no logprobs in the response");
  }
  const alternatives = content.top_logprobs;
  if (!alternatives || alternatives.length === 0) return fail("openrouter: no logprobs in the response");

  const massOf = (token: string) => alternatives.filter((a) => a.token.trim() === token).reduce((sum, a) => sum + Math.exp(a.logprob), 0);
  const sumAllAlts = alternatives.reduce((sum, a) => sum + Math.exp(a.logprob), 0);
  const H = Math.max(0, 1 - sumAllAlts);

  const letterMass = new Map<string, number>();
  let L = 0;
  request.options.forEach((o, i) => {
    const letter = LETTERS[i];
    const m = letter ? massOf(letter) : 0;
    letterMass.set(o.id, m);
    L += m;
  });

  if (L < minMass) return fail(`openrouter: letter mass ${L.toFixed(3)} is below min_mass ${minMass}`);

  const denom = L + H;
  const probs: Record<string, number> = {};
  for (const o of request.options) probs[o.id] = (letterMass.get(o.id) ?? 0) / denom;

  return { probs, unassigned: H / denom, backend: "openrouter", model: config.model, ms: Date.now() - started };
}

export interface ModelCheck {
  ok: boolean;
  contextTokens?: number;
}

interface ModelsResponse {
  data?: { id: string; context_length?: number; supported_parameters?: string[] }[];
}

/**
 * Checked before the run starts (SPEC §6.2): the model must support
 * logprobs and be able to turn reasoning off, or it's E-BACKEND-MODEL.
 */
export async function checkModel(model: string, deps: HttpDeps, url = MODELS_URL): Promise<ModelCheck> {
  const res = await deps.fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) return { ok: false };
  const json = (await res.json()) as ModelsResponse;
  const entry = json.data?.find((m) => m.id === model);
  if (!entry) return { ok: false };
  const supported = entry.supported_parameters ?? [];
  if (!supported.includes("logprobs") || !supported.includes("reasoning")) return { ok: false };
  if (entry.context_length === undefined) return { ok: false };
  return { ok: true, contextTokens: entry.context_length - 2000 };
}
