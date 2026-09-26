// The declared backend limits (SPEC §6.2 table). A backend can only lower
// the language's maximums (255 options, no context cap).

import type { BackendLimits } from "./types.js";

export const JEV_LIMITS: BackendLimits = {
  maxOptions: 255,
  contextTokens: 30_000,
};

// OpenRouter's option cap comes from the 20 alternatives OpenRouter
// returns (§6.2); its context cap is the model's context length minus 2k,
// which needs a live model lookup (see openrouter.ts's checkModel).
export const OPENROUTER_LIMITS: BackendLimits = {
  maxOptions: 20,
  contextTokens: null,
};

export const FAKE_LIMITS: BackendLimits = {
  maxOptions: 255,
  contextTokens: null,
};
