// The skop-ask entry point (SPEC §6.1): reads a request from stdin, asks
// the configured backend, prints an answer or a failure. runAsk is the
// entry point's core logic, tested directly (no real fetch or subprocess).

import { describe, expect, test, vi } from "vitest";
import { runAsk } from "../../src/ask/cli.js";
import type { AskRequest } from "../../src/ask/types.js";
import { isFailure } from "../../src/ask/types.js";

const request: AskRequest = {
  kind: "yesno",
  question: "Is it worth it?",
  guidance: null,
  options: [
    { id: "yes", label: "yes", description: null },
    { id: "no", label: "no", description: null },
  ],
  context: {},
  timeout_ms: 2000,
};

describe("runAsk (SPEC §6.1)", () => {
  test("with no configured backend, defaults to jev and fails without an API key", async () => {
    await expect(runAsk(JSON.stringify(request), {})).rejects.toThrow(/API key/);
  });

  test("an unknown ask.backend is a config error", async () => {
    await expect(runAsk(JSON.stringify(request), { SKOP_ASK_BACKEND: "carrier-pigeon" })).rejects.toThrow(/unknown ask.backend/);
  });

  test("selects jev and calls out to it", async () => {
    // Stub global fetch since runAsk wires jev to the real `fetch`.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: { q: { type: "noul", noul: 0.75 } },
        }),
        {
          status: 200,
        },
      ),
    );
    try {
      const out = await runAsk(JSON.stringify(request), {
        SKOP_ASK_BACKEND: "jev",
        TYPESAFE_API_KEY: "k",
        JEV_MODEL: "jev-1.13.0",
      });
      expect(isFailure(out)).toBe(false);
      expect(!isFailure(out) && out.probs).toEqual({ yes: 0.75, no: 0.25 });
      expect(fetchSpy).toHaveBeenCalledWith("https://api.typesafe.ai/v1/systemone", expect.anything());
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("selects openrouter and calls out to it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "test/model",
          choices: [
            {
              message: { content: "A" },
              logprobs: {
                content: [{ token: "A", top_logprobs: [{ token: "A", logprob: 0 }] }],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    try {
      const out = await runAsk(JSON.stringify(request), {
        SKOP_ASK_BACKEND: "openrouter",
        OPENROUTER_API_KEY: "k",
        OPENROUTER_MODEL: "test/model",
      });
      expect(isFailure(out)).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
