// The jev backend (SPEC §6.2).

import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { askJev, isModelAlias, modelMismatch } from "../../src/ask/jev.js";
import type { AskRequest } from "../../src/ask/types.js";
import { isFailure } from "../../src/ask/types.js";

const recording = (name: string) => readFileSync(new URL(`../recordings/jev/${name}`, import.meta.url), "utf8");

const diskFullRequest: AskRequest = {
  kind: "choice",
  question: "Given `used`, `errors` and `biggest`, what's the best next step?",
  guidance: "Look at usage, recent errors and what's biggest on disk.",
  options: [
    { id: "s:clean_up", label: "Clean up", description: "Run cleanups least risky first. Stop as soon as usage is under target." },
    { id: "s:restart", label: "Restart", description: "Restart the one service most likely behind the growth. Never more than one." },
    { id: "s:page", label: "Page", description: "Nothing here is safe to try automatically. Tell a human." },
    {
      id: "s:investigate",
      label: "Investigate",
      description: "Nothing in the lists fits. Work out what's filling the disk from the errors and sizes gathered in Triage.",
    },
  ],
  context: { used: "91%", errors: "...", biggest: "..." },
  timeout_ms: 2000,
};

const config = { model: "jev-1.13.0", apiKey: "test-key" };
const retryCfg = { timeoutMs: 1000, retries: 1 };
const sleep = async () => {};

function fetchReturning(res: Response) {
  return vi.fn(async () => res);
}

describe("askJev request shape (SPEC §6.2)", () => {
  test("sends the full request shape: model, state, and questions.q with instructions and criteria", async () => {
    let sentUrl = "";
    let sentBody: any;
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      sentUrl = url;
      sentBody = JSON.parse(init.body as string);
      return new Response(recording("choice-success.json"), { status: 200 });
    });
    await askJev(diskFullRequest, config, retryCfg, { fetch: fetchImpl as any, sleep });

    expect(sentUrl).toBe("https://api.typesafe.ai/v1/systemone");
    expect(sentBody).toEqual({
      model: "jev-1.13.0",
      state: { used: "91%", errors: "...", biggest: "..." },
      questions: {
        q: {
          type: "choice",
          instructions: {
            question: "Given `used`, `errors` and `biggest`, what's the best next step?",
            guidance: "Look at usage, recent errors and what's biggest on disk.",
          },
          criteria: {
            "Clean up": "Run cleanups least risky first. Stop as soon as usage is under target.",
            Restart: "Restart the one service most likely behind the growth. Never more than one.",
            Page: "Nothing here is safe to try automatically. Tell a human.",
            Investigate: "Nothing in the lists fits. Work out what's filling the disk from the errors and sizes gathered in Triage.",
          },
        },
      },
    });
  });

  test("context holds only the named outputs the request carries, nothing else", async () => {
    let sentBody: any;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string);
      return new Response(recording("choice-success.json"), { status: 200 });
    });
    await askJev(diskFullRequest, config, retryCfg, { fetch: fetchImpl as any, sleep });
    expect(sentBody.state).toEqual(diskFullRequest.context);
    expect(Object.keys(sentBody.state)).toHaveLength(3);
  });

  test("maps Jev's label keys in answers.q back to option ids", async () => {
    const fetchImpl = fetchReturning(new Response(recording("choice-success.json"), { status: 200 }));
    const out = await askJev(diskFullRequest, config, retryCfg, { fetch: fetchImpl, sleep });
    expect(isFailure(out)).toBe(false);
    expect(!isFailure(out) && out.probs).toEqual({
      "s:clean_up": 0.82,
      "s:restart": 0.12,
      "s:page": 0.04,
      "s:investigate": 0.02,
    });
  });

  test("reads the answer from answers.q; a response without it is invalid (unavailable)", async () => {
    const fetchImpl = fetchReturning(new Response(JSON.stringify({ model: "jev-1.13.0", answers: {} }), { status: 200 }));
    const out = await askJev(diskFullRequest, config, retryCfg, { fetch: fetchImpl, sleep });
    expect(isFailure(out) && out.error).toBe("unavailable");
  });

  test("a partial probabilities object (a missing option) is unavailable, never filled in", async () => {
    const body = { model: "jev-1.13.0", answers: { q: { type: "choice", probabilities: { "Clean up": 0.9, Restart: 0.1 } } } };
    const fetchImpl = fetchReturning(new Response(JSON.stringify(body), { status: 200 }));
    const out = await askJev(diskFullRequest, config, retryCfg, { fetch: fetchImpl, sleep });
    expect(isFailure(out) && out.error).toBe("unavailable");
  });

  test("reports backend and model on every answer", async () => {
    const fetchImpl = fetchReturning(new Response(recording("choice-success.json"), { status: 200 }));
    const out = await askJev(diskFullRequest, config, retryCfg, { fetch: fetchImpl, sleep });
    expect(!isFailure(out) && out.backend).toBe("jev");
    expect(!isFailure(out) && out.model).toBe("jev-1.13.0");
  });
});

describe("askJev retries (SPEC §6.2, ask.retries 0-3)", () => {
  test("ask.retries: 0 gives up after one failed attempt", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 500 }));
    const out = await askJev(diskFullRequest, config, { timeoutMs: 100, retries: 0 }, { fetch: fetchImpl, sleep });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(isFailure(out) && out.error).toBe("unavailable");
  });

  test("ask.retries: 3 makes four attempts, then succeeds if the last one does", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls < 4) return new Response("", { status: 500 });
      return new Response(recording("choice-success.json"), { status: 200 });
    });
    const out = await askJev(diskFullRequest, config, { timeoutMs: 100, retries: 3 }, { fetch: fetchImpl, sleep });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(isFailure(out)).toBe(false);
  });

  test("429 with retry-after inside the timeout retries and can still succeed", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) return new Response("", { status: 429, headers: { "retry-after": "1" } });
      return new Response(recording("choice-success.json"), { status: 200 });
    });
    const out = await askJev(diskFullRequest, config, { timeoutMs: 5000, retries: 2 }, { fetch: fetchImpl, sleep });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(isFailure(out)).toBe(false);
  });

  test("429 with retry-after beyond the timeout stops retrying and is unavailable", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 429, headers: { "retry-after": "999" } }));
    const out = await askJev(diskFullRequest, config, { timeoutMs: 1000, retries: 3 }, { fetch: fetchImpl, sleep });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(isFailure(out) && out.error).toBe("unavailable");
  });

  test("a request-too-large (413) response is never retried", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 413 }));
    const out = await askJev(diskFullRequest, config, { timeoutMs: 1000, retries: 3 }, { fetch: fetchImpl, sleep });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(isFailure(out) && out.error).toBe("request_too_large");
  });
});

describe("W-MODEL-ALIAS (SPEC §6.2)", () => {
  test("jev-latest is an alias; a pinned jev-1.13.0 is not", () => {
    expect(isModelAlias("jev-latest")).toBe(true);
    expect(isModelAlias("jev-1.13.0")).toBe(false);
  });

  test("a response reporting a different model than configured is a mismatch", () => {
    expect(modelMismatch("jev-1.13.0", "jev-1.14.0")).toBe(true);
    expect(modelMismatch("jev-1.13.0", "jev-1.13.0")).toBe(false);
  });
});
