// The openrouter backend (SPEC §6.2).

import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { askOpenRouter, buildPrompt, checkModel } from "../../src/ask/openrouter.js";
import type { AskRequest } from "../../src/ask/types.js";
import { checkAskLimits, isFailure } from "../../src/ask/types.js";
import { expectValidAskOutput } from "./schema-helpers.js";

const recording = (name: string) => readFileSync(new URL(`../recordings/openrouter/${name}`, import.meta.url), "utf8");
const config = { model: "test/model", apiKey: "test-key" };
const retryCfg = { timeoutMs: 1000, retries: 0 };
const sleep = async () => {};

const yesnoRequest: AskRequest = {
  kind: "yesno",
  question: 'Is it worth running "Vacuum the journal"?',
  guidance: null,
  options: [
    { id: "yes", label: "yes", description: null },
    { id: "no", label: "no", description: null },
  ],
  context: { used: "91%" },
  timeout_ms: 2000,
};

const servicesRequest: AskRequest = {
  kind: "choice",
  question: "Given `errors` and `biggest`, which service is behind it?",
  guidance: null,
  options: [
    { id: "nginx", label: "nginx", description: null },
    { id: "rsyslog", label: "rsyslog", description: null },
    { id: "myapp-worker", label: "myapp-worker", description: null },
    { id: "myapp-api", label: "myapp-api", description: null },
  ],
  context: { errors: "...", biggest: "..." },
  timeout_ms: 2000,
};

function logprobResponse(tokenAndAlts: { token: string; top_logprobs: { token: string; logprob: number }[] }) {
  return new Response(
    JSON.stringify({
      model: "test/model",
      choices: [
        {
          message: { role: "assistant", content: tokenAndAlts.token },
          logprobs: { content: [tokenAndAlts] },
        },
      ],
    }),
    { status: 200 },
  );
}

describe("buildPrompt (SPEC §6.2)", () => {
  test("labels options A, B, C… in order, using each label", () => {
    const prompt = buildPrompt(servicesRequest);
    expect(prompt).toContain("A: nginx");
    expect(prompt).toContain("B: rsyslog");
    expect(prompt).toContain("C: myapp-worker");
    expect(prompt).toContain("D: myapp-api");
  });

  test("yesno labels A = yes, B = no", () => {
    const prompt = buildPrompt(yesnoRequest);
    expect(prompt).toContain("A: yes");
    expect(prompt).toContain("B: no");
  });

  test("includes the option's description when it has one", () => {
    const req: AskRequest = {
      ...servicesRequest,
      options: [
        {
          id: "s:clean_up",
          label: "Clean up",
          description: "Run cleanups least risky first.",
        },
        { id: "rsyslog", label: "rsyslog", description: null },
      ],
    };
    expect(buildPrompt(req)).toContain("A: Clean up — Run cleanups least risky first.");
  });
});

describe("askOpenRouter reading logprobs (SPEC §6.2)", () => {
  test("the 97.1% example: A=0.51, 19 others at 0.025, B not returned, so a 99% gate would fail", async () => {
    const fetchImpl = vi.fn(async () => new Response(recording("gate-971.json"), { status: 200 }));
    // Plain yes/no labels: the letter comes from the option's position
    // (buildPrompt), not from its label text, so relabelling "yes" as "A"
    // here would just be confusing, not meaningful.
    const out = expectValidAskOutput(
      await askOpenRouter(yesnoRequest, config, retryCfg, {
        fetch: fetchImpl,
        sleep,
      }),
    );
    expect(isFailure(out)).toBe(false);
    const probA = !isFailure(out) ? out.probs.yes : undefined;
    expect(probA).toBeCloseTo(0.971428, 5);
    expect(probA).toBeLessThan(0.99);
    // H = 1 - (0.51 + 19*0.025) = 0.015; unassigned = H / (L + H).
    expect(!isFailure(out) && out.unassigned).toBeCloseTo(0.0285714, 5);
  });

  test("whitespace around a returned token is trimmed before matching a letter", async () => {
    const res = logprobResponse({
      token: "A",
      top_logprobs: [
        { token: " A", logprob: Math.log(0.9) },
        { token: "B", logprob: Math.log(0.1) },
      ],
    });
    const fetchImpl = vi.fn(async () => res);
    const out = expectValidAskOutput(
      await askOpenRouter(yesnoRequest, config, retryCfg, {
        fetch: fetchImpl,
        sleep,
      }),
    );
    expect(!isFailure(out) && out.probs.yes).toBeCloseTo(0.9, 5);
  });

  test("probabilities come only from logprobs, never a stated confidence in the text", async () => {
    // The message content could say anything; only top_logprobs feeds probs.
    const res = logprobResponse({
      token: "A",
      top_logprobs: [
        { token: "A", logprob: Math.log(0.9) },
        { token: "B", logprob: Math.log(0.1) },
      ],
    });
    const fetchImpl = vi.fn(async () => res);
    const out = await askOpenRouter(yesnoRequest, config, retryCfg, {
      fetch: fetchImpl,
      sleep,
    });
    expect(!isFailure(out) && out.probs.yes).toBeCloseTo(0.9, 5);
  });

  test("low letter mass (below min_mass) is unavailable, not a low-confidence answer", async () => {
    const res = logprobResponse({
      token: "z",
      top_logprobs: [
        { token: "z", logprob: Math.log(0.3) },
        { token: "y", logprob: Math.log(0.2) },
      ],
    });
    const fetchImpl = vi.fn(async () => res);
    const out = await askOpenRouter(yesnoRequest, { ...config, minMass: 0.5 }, retryCfg, { fetch: fetchImpl, sleep });
    expect(isFailure(out) && out.error).toBe("unavailable");
  });

  test("missing logprobs is unavailable", async () => {
    const res = new Response(
      JSON.stringify({
        model: "test/model",
        choices: [{ message: { content: "A" } }],
      }),
      { status: 200 },
    );
    const fetchImpl = vi.fn(async () => res);
    const out = await askOpenRouter(yesnoRequest, config, retryCfg, {
      fetch: fetchImpl,
      sleep,
    });
    expect(isFailure(out) && out.error).toBe("unavailable");
  });

  test("a reasoning-only reply (no visible token, reasoning tokens reported) is unavailable", async () => {
    const res = new Response(
      JSON.stringify({
        model: "test/model",
        choices: [
          {
            message: { content: "", reasoning: "thinking it over..." },
            logprobs: { content: [] },
          },
        ],
      }),
      { status: 200 },
    );
    const fetchImpl = vi.fn(async () => res);
    const out = await askOpenRouter(yesnoRequest, config, retryCfg, {
      fetch: fetchImpl,
      sleep,
    });
    expect(isFailure(out) && out.error).toBe("unavailable");
    expect(isFailure(out) && out.detail).toContain("reasoning");
  });

  test("reasoning tokens reported in usage make the response unavailable even though logprobs are present", async () => {
    const res = new Response(
      JSON.stringify({
        model: "test/model",
        choices: [
          {
            message: { content: "A" },
            logprobs: { content: [{ token: "A", top_logprobs: [{ token: "A", logprob: 0 }] }] },
          },
        ],
        usage: { completion_tokens_details: { reasoning_tokens: 12 } },
      }),
      { status: 200 },
    );
    const fetchImpl = vi.fn(async () => res);
    const out = await askOpenRouter(yesnoRequest, config, retryCfg, {
      fetch: fetchImpl,
      sleep,
    });
    expect(isFailure(out) && out.error).toBe("unavailable");
    expect(isFailure(out) && out.detail).toContain("reasoning");
  });

  test("a non-empty message.reasoning makes the response unavailable even with logprobs present", async () => {
    const res = new Response(
      JSON.stringify({
        model: "test/model",
        choices: [
          {
            message: { content: "A", reasoning: "let me think" },
            logprobs: { content: [{ token: "A", top_logprobs: [{ token: "A", logprob: 0 }] }] },
          },
        ],
      }),
      { status: 200 },
    );
    const fetchImpl = vi.fn(async () => res);
    const out = await askOpenRouter(yesnoRequest, config, retryCfg, {
      fetch: fetchImpl,
      sleep,
    });
    expect(isFailure(out) && out.error).toBe("unavailable");
  });

  test("an empty or whitespace-only first visible token is unavailable", async () => {
    const res = logprobResponse({
      token: "  ",
      top_logprobs: [{ token: "  ", logprob: 0 }],
    });
    const fetchImpl = vi.fn(async () => res);
    const out = await askOpenRouter(yesnoRequest, config, retryCfg, {
      fetch: fetchImpl,
      sleep,
    });
    expect(isFailure(out) && out.error).toBe("unavailable");
  });

  test("reports the response's served model rather than config.model when present", async () => {
    const res = logprobResponse({
      token: "A",
      top_logprobs: [{ token: "A", logprob: 0 }],
    });
    const fetchImpl = vi.fn(async () => res);
    const out = await askOpenRouter(yesnoRequest, { ...config, model: "configured/model" }, retryCfg, {
      fetch: fetchImpl,
      sleep,
    });
    // logprobResponse always stamps "model": "test/model" as the served model.
    expect(!isFailure(out) && out.model).toBe("test/model");
  });

  test("service labels (one-of options with no description) appear in the prompt and map back by letter", async () => {
    let sentBody: any;
    const fetchImpl = vi.fn(async (_url, init) => {
      sentBody = JSON.parse(init.body as string);
      return logprobResponse({
        token: "B",
        top_logprobs: [{ token: "B", logprob: Math.log(0.95) }],
      });
    });
    const out = await askOpenRouter(servicesRequest, config, retryCfg, {
      fetch: fetchImpl,
      sleep,
    });
    expect(sentBody.messages[0].content).toContain("A: nginx");
    expect(sentBody.messages[0].content).toContain("B: rsyslog");
    expect(!isFailure(out) && out.probs.rsyslog).toBeCloseTo(0.95, 5);
  });
});

describe("askOpenRouter request (SPEC §6.2)", () => {
  test("asks for one token at temperature 0 with logprobs and 20 alternatives", async () => {
    let sentBody: any;
    const fetchImpl = vi.fn(async (_url, init) => {
      sentBody = JSON.parse(init.body as string);
      return logprobResponse({
        token: "A",
        top_logprobs: [{ token: "A", logprob: 0 }],
      });
    });
    await askOpenRouter(yesnoRequest, config, retryCfg, {
      fetch: fetchImpl,
      sleep,
    });
    expect(sentBody.max_tokens).toBe(1);
    expect(sentBody.temperature).toBe(0);
    expect(sentBody.logprobs).toBe(true);
    expect(sentBody.top_logprobs).toBe(20);
  });

  test("pins every request param: reasoning, provider.require_parameters, logprobs, top_logprobs, max_tokens, temperature", async () => {
    let sentBody: any;
    const fetchImpl = vi.fn(async (_url, init) => {
      sentBody = JSON.parse(init.body as string);
      return logprobResponse({
        token: "A",
        top_logprobs: [{ token: "A", logprob: 0 }],
      });
    });
    await askOpenRouter(yesnoRequest, config, retryCfg, {
      fetch: fetchImpl,
      sleep,
    });
    expect(sentBody).toMatchObject({
      model: "test/model",
      max_tokens: 1,
      temperature: 0,
      logprobs: true,
      top_logprobs: 20,
      provider: { require_parameters: true },
      reasoning: { effort: "none" },
    });
  });

  test("omits `reasoning` when the config says the model doesn't support it", async () => {
    let sentBody: any;
    const fetchImpl = vi.fn(async (_url, init) => {
      sentBody = JSON.parse(init.body as string);
      return logprobResponse({
        token: "A",
        top_logprobs: [{ token: "A", logprob: 0 }],
      });
    });
    await askOpenRouter(yesnoRequest, { ...config, supportsReasoning: false }, retryCfg, {
      fetch: fetchImpl,
      sleep,
    });
    expect(Object.hasOwn(sentBody, "reasoning")).toBe(false);
  });
});

describe("askOpenRouter request_too_large (SPEC §6.2, §6.3)", () => {
  test("a 413 maps to request_too_large and is never retried", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 413 }));
    const out = expectValidAskOutput(
      await askOpenRouter(yesnoRequest, config, { timeoutMs: 100, retries: 3 }, { fetch: fetchImpl, sleep }),
    );
    expect(isFailure(out) && out.error).toBe("request_too_large");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("OpenRouter's context-length 400 error maps to request_too_large and is never retried", async () => {
    const body = JSON.stringify({
      error: { message: "This model's maximum context length is 8192 tokens.", code: 400 },
    });
    const fetchImpl = vi.fn(async () => new Response(body, { status: 400 }));
    const out = expectValidAskOutput(
      await askOpenRouter(yesnoRequest, config, { timeoutMs: 100, retries: 3 }, { fetch: fetchImpl, sleep }),
    );
    expect(isFailure(out) && out.error).toBe("request_too_large");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("a plain 400 that isn't about context length is a normal unavailable, not request_too_large", async () => {
    const body = JSON.stringify({ error: { message: "invalid request", code: 400 } });
    const fetchImpl = vi.fn(async () => new Response(body, { status: 400 }));
    const out = await askOpenRouter(yesnoRequest, config, { timeoutMs: 100, retries: 3 }, { fetch: fetchImpl, sleep });
    expect(isFailure(out) && out.error).toBe("unavailable");
  });
});

describe("checkModel (SPEC §6.2, E-BACKEND-MODEL)", () => {
  test("a model without logprobs support is E-BACKEND-MODEL", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: "test/model",
                supported_parameters: ["reasoning"],
                context_length: 32000,
              },
            ],
          }),
          {
            status: 200,
          },
        ),
    );
    const result = await checkModel("test/model", { fetch: fetchImpl, sleep });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("logprobs");
  });

  test("a model that doesn't list `reasoning` still passes: nothing to turn off", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: "test/model",
                supported_parameters: ["logprobs"],
                context_length: 32000,
              },
            ],
          }),
          {
            status: 200,
          },
        ),
    );
    const result = await checkModel("test/model", { fetch: fetchImpl, sleep });
    expect(result.ok).toBe(true);
    expect(result.supportsReasoning).toBe(false);
  });

  test("a model that lists `reasoning` reports supportsReasoning: true", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ id: "test/model", supported_parameters: ["logprobs", "reasoning"], context_length: 32000 }],
          }),
          { status: 200 },
        ),
    );
    const result = await checkModel("test/model", { fetch: fetchImpl, sleep });
    expect(result.ok).toBe(true);
    expect(result.supportsReasoning).toBe(true);
  });

  test("a model missing from the list is E-BACKEND-MODEL", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const result = await checkModel("test/model", { fetch: fetchImpl, sleep });
    expect(result.ok).toBe(false);
  });

  test("a supported model reports its context length minus 2k", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: "test/model",
                supported_parameters: ["logprobs", "reasoning"],
                context_length: 32000,
              },
            ],
          }),
          { status: 200 },
        ),
    );
    const result = await checkModel("test/model", { fetch: fetchImpl, sleep });
    expect(result.ok).toBe(true);
    expect(result.contextTokens).toBe(30000);
  });

  test("ask_context over the model's context minus 2k is E-BACKEND-LIMIT on openrouter", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ id: "test/model", supported_parameters: ["logprobs", "reasoning"], context_length: 32000 }],
          }),
          { status: 200 },
        ),
    );
    const result = await checkModel("test/model", { fetch: fetchImpl, sleep });
    expect(result.contextTokens).toBe(30000);
    const limits = { maxOptions: 20, contextTokens: result.contextTokens ?? null };
    const r = checkAskLimits({ kind: "choice", optionCount: 4, declaredContextTokens: 30001 }, limits);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe("E-BACKEND-LIMIT");
  });

  test("a network error doesn't crash: it comes back as {ok: false, error}", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const result = await checkModel("test/model", { fetch: fetchImpl, sleep });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  test("invalid JSON doesn't crash: it comes back as {ok: false, error}", async () => {
    const fetchImpl = vi.fn(async () => new Response("not json", { status: 200 }));
    const result = await checkModel("test/model", { fetch: fetchImpl, sleep });
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("is bounded by its own timeout: a fetch that never resolves doesn't hang the check", async () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
    const started = Date.now();
    const result = await checkModel("test/model", { fetch: fetchImpl, sleep }, undefined, 20);
    expect(result.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
