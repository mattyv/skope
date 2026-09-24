// The openrouter backend: a general model through OpenRouter (SPEC §6.2).
//
// Parameters per OpenRouter's docs: `logprobs` + `top_logprobs` (max 20),
// `reasoning: { effort: "none" }` turns reasoning off (sent only when the
// model lists `reasoning` among its supported_parameters — a model that
// doesn't list it doesn't reason at all, so there's nothing to turn off,
// and sending an unsupported field can get the request rejected), and
// `provider: { require_parameters: true }` routes only to providers that
// honour every parameter, so logprobs can't be silently dropped.

import type { HttpDeps, RetryConfig } from "./retry.js";
import { fetchWithRetry } from "./retry.js";
import type { AskOutput, AskRequest } from "./types.js";

export interface OpenRouterConfig {
  model: string;
  apiKey: string;
  minMass?: number; // default 0.5 (SPEC §9)
  url?: string;
  supportsReasoning?: boolean; // default true: send `reasoning` unless checkModel said not to
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
  model?: string;
  choices?: {
    message?: { reasoning?: string | null };
    logprobs?: {
      content?: { token: string; top_logprobs?: TopLogprob[] }[];
    } | null;
  }[];
  usage?: {
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

/** OpenRouter's "too many tokens for this model" 400 (distinct from a
 * plain bad request): reported per SPEC §6.3 as `request_too_large`,
 * never retried, same as a 413. */
function isContextLengthError(text: string): boolean {
  return /context.{0,20}length|context_length_exceeded|maximum context|too many tokens/i.test(text);
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

  const body: Record<string, unknown> = {
    model: config.model,
    messages: [{ role: "user", content: buildPrompt(request) }],
    max_tokens: 1,
    temperature: 0,
    logprobs: true,
    top_logprobs: 20,
    provider: { require_parameters: true },
  };
  if (config.supportsReasoning ?? true) body.reasoning = { effort: "none" };

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

  const fail = (detail: string): AskOutput => ({
    error: "unavailable",
    detail,
    backend: "openrouter",
    model: config.model,
  });

  if (res === null) return fail("openrouter: no response (timeout or connection error)");
  if (res.status === 413) {
    return {
      error: "request_too_large",
      detail: "openrouter: request too large",
      backend: "openrouter",
      model: config.model,
    };
  }
  if (res.status === 400 && isContextLengthError(res.text)) {
    return {
      error: "request_too_large",
      detail: "openrouter: request exceeds the model's context length",
      backend: "openrouter",
      model: config.model,
    };
  }
  if (!res.ok) return fail(`openrouter: HTTP ${res.status}`);

  let json: ChatCompletion;
  try {
    json = JSON.parse(res.text) as ChatCompletion;
  } catch {
    return fail("openrouter: response wasn't valid JSON");
  }

  const choice = json.choices?.[0];

  // A response can carry logprobs *and* have spent its budget on
  // reasoning (the visible token then usually isn't the real answer), so
  // this is checked before the logprobs are trusted at all, not only as a
  // fallback when they're absent.
  const reasoningTokens = json.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  const reasoningText = choice?.message?.reasoning;
  if (reasoningTokens > 0 || (typeof reasoningText === "string" && reasoningText.trim() !== "")) {
    return fail("openrouter: reasoning tokens reported, no reliable visible-token probability");
  }

  const content = choice?.logprobs?.content?.[0];
  if (!choice?.logprobs || !content) return fail("openrouter: no logprobs in the response");
  if (!content.token || content.token.trim() === "") return fail("openrouter: no visible first token in the response");

  const alternatives = content.top_logprobs;
  if (!alternatives || alternatives.length === 0) return fail("openrouter: no logprobs in the response");

  // Single pass: each alternative's mass is added to its option's letter
  // mass (if it names one) and to the running total, at the same time.
  const letterToId = new Map(request.options.map((o, i) => [LETTERS[i], o.id]));
  const letterMass = new Map<string, number>();
  let sumAllAlts = 0;
  for (const alt of alternatives) {
    const p = Math.exp(alt.logprob);
    sumAllAlts += p;
    const id = letterToId.get(alt.token.trim());
    if (id !== undefined) letterMass.set(id, (letterMass.get(id) ?? 0) + p);
  }
  const H = Math.max(0, 1 - sumAllAlts);
  let L = 0;
  for (const o of request.options) L += letterMass.get(o.id) ?? 0;

  if (L < minMass) return fail(`openrouter: letter mass ${L.toFixed(3)} is below min_mass ${minMass}`);

  const denom = L + H;
  const probs: Record<string, number> = {};
  for (const o of request.options) probs[o.id] = (letterMass.get(o.id) ?? 0) / denom;

  return {
    probs,
    unassigned: H / denom,
    backend: "openrouter",
    // The model that actually served the request, when OpenRouter reports
    // one, rather than what was configured (routing can pick a variant).
    model: json.model ?? config.model,
    ms: Date.now() - started,
  };
}

export interface ModelCheck {
  ok: boolean;
  contextTokens?: number;
  supportsReasoning?: boolean;
  error?: string;
}

interface ModelsResponse {
  data?: {
    id: string;
    context_length?: number;
    supported_parameters?: string[];
  }[];
}

const DEFAULT_CHECK_TIMEOUT_MS = 5000;

/**
 * Checked before the run starts (SPEC §6.2): the model must support
 * logprobs, or it's E-BACKEND-MODEL. Listing `reasoning` is optional — a
 * model that doesn't list it simply never reasons, so `reasoning` is left
 * out of the request rather than treated as a failure (see askOpenRouter).
 * Bounded by its own timeout and never throws: a network or JSON error
 * comes back as `{ok: false, error}`, not a crash.
 */
async function checkModelOnce(model: string, deps: HttpDeps, url: string, signal: AbortSignal): Promise<ModelCheck> {
  let res: Response;
  try {
    res = await deps.fetch(url, {
      headers: { accept: "application/json" },
      signal,
    });
  } catch (err) {
    return { ok: false, error: `openrouter: model check failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!res.ok) return { ok: false, error: `openrouter: model check got HTTP ${res.status}` };
  let json: ModelsResponse;
  try {
    json = (await res.json()) as ModelsResponse;
  } catch {
    return { ok: false, error: "openrouter: model list wasn't valid JSON" };
  }
  const entry = json.data?.find((m) => m.id === model);
  if (!entry) return { ok: false, error: `openrouter: model "${model}" not found` };
  const supported = entry.supported_parameters ?? [];
  if (!supported.includes("logprobs")) return { ok: false, error: `openrouter: model "${model}" doesn't support logprobs` };
  if (entry.context_length === undefined) return { ok: false, error: `openrouter: model "${model}" has no context_length` };
  return {
    ok: true,
    contextTokens: entry.context_length - 2000,
    supportsReasoning: supported.includes("reasoning"),
  };
}

/**
 * Bounded by its own timeout, whether or not `deps.fetch` itself respects
 * the abort signal, and never throws: a network or JSON error, or a
 * timeout, comes back as `{ok: false, error}`, not a crash.
 */
export async function checkModel(
  model: string,
  deps: HttpDeps,
  url = MODELS_URL,
  timeoutMs = DEFAULT_CHECK_TIMEOUT_MS,
): Promise<ModelCheck> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ModelCheck>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, error: `openrouter: model check timed out after ${timeoutMs}ms` });
    }, timeoutMs);
  });
  try {
    return await Promise.race([checkModelOnce(model, deps, url, controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
