// Shared types for every backend (SPEC §6, contracts/ask.schema.json).
// AskRequest and AskAnswer are generated from the contract; AskFailure
// mirrors ask.schema.json#/$defs/failure, which gen-types.mjs doesn't
// export a name for.

import type { AskAnswer, AskRequest } from "../contracts.gen.js";

export type { AskAnswer, AskRequest };

export interface AskFailure {
  error: "unavailable" | "request_too_large";
  detail: string;
  backend: string;
  model?: string;
}

export type AskOutput = AskAnswer | AskFailure;

export function isFailure(output: AskOutput): output is AskFailure {
  return "error" in output;
}

/** A backend's declared limits (SPEC §6.2 table). `contextTokens: null` means no limit. */
export interface BackendLimits {
  maxOptions: number;
  contextTokens: number | null;
}

export type LimitCheck = { ok: true } | { ok: false; code: "E-BACKEND-LIMIT"; detail: string };

/**
 * What's checked against a backend's limits before a run starts (SPEC
 * §6.2): an `ask`'s option count, and the skill's
 * declared `limits.ask_context_tokens` (core-program.schema.json), a
 * best-effort budget rather than the request's actual size.
 */
export interface AskLimitInput {
  kind: "choice" | "yesno";
  optionCount: number;
  declaredContextTokens: number | null;
}

export function checkAskLimits(input: AskLimitInput, limits: BackendLimits): LimitCheck {
  const max = limits.maxOptions;
  if (input.optionCount > max) {
    return {
      ok: false,
      code: "E-BACKEND-LIMIT",
      detail: `${input.optionCount} options exceeds the backend's limit of ${max}`,
    };
  }
  if (limits.contextTokens !== null && input.declaredContextTokens !== null && input.declaredContextTokens > limits.contextTokens) {
    return {
      ok: false,
      code: "E-BACKEND-LIMIT",
      detail: `ask_context ${input.declaredContextTokens} tokens exceeds the backend's limit of ${limits.contextTokens}`,
    };
  }
  return { ok: true };
}
