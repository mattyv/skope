// The jev backend (SPEC §6.2).

import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { askJev, isModelAlias } from "../../src/ask/jev.js";
import type { AskRequest } from "../../src/ask/types.js";
import { isFailure } from "../../src/ask/types.js";
import { expectValidAskOutput } from "./schema-helpers.js";

const recording = (name: string) => readFileSync(new URL(`../recordings/jev/${name}`, import.meta.url), "utf8");

const diskFullRequest: AskRequest = {
  kind: "choice",
  question: "Given `used`, `errors` and `biggest`, what's the best next step?",
  guidance: "Look at usage, recent errors and what's biggest on disk.",
  options: [
    {
      id: "s:clean_up",
      label: "Clean up",
      description: "Run cleanups least risky first. Stop as soon as usage is under target.",
    },
    {
      id: "s:restart",
      label: "Restart",
      description: "Restart the one service most likely behind the growth. Never more than one.",
    },
    {
      id: "s:page",
      label: "Page",
      description: "Nothing here is safe to try automatically. Tell a human.",
    },
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
    await askJev(diskFullRequest, config, retryCfg, {
      fetch: fetchImpl as any,
      sleep,
    });

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
    await askJev(diskFullRequest, config, retryCfg, {
      fetch: fetchImpl as any,
      sleep,
    });
    expect(sentBody.state).toEqual(diskFullRequest.context);
    expect(Object.keys(sentBody.state)).toHaveLength(3);
  });

  test("maps Jev's label keys in answers.q back to option ids", async () => {
    const fetchImpl = fetchReturning(new Response(recording("choice-success.json"), { status: 200 }));
    const out = await askJev(diskFullRequest, config, retryCfg, {
      fetch: fetchImpl,
      sleep,
    });
    expect(isFailure(out)).toBe(false);
    expect(!isFailure(out) && out.probs).toEqual({
      "s:clean_up": 0.82,
      "s:restart": 0.12,
      "s:page": 0.04,
      "s:investigate": 0.02,
    });
  });

  test("reads the answer from answers.q; a response without it is invalid (unavailable)", async () => {
    const fetchImpl = fetchReturning(
      new Response(JSON.stringify({ model: "jev-1.13.0", answers: {} }), {
        status: 200,
      }),
    );
    const out = await askJev(diskFullRequest, config, retryCfg, {
      fetch: fetchImpl,
      sleep,
    });
    expect(isFailure(out) && out.error).toBe("unavailable");
  });

  test("a partial probabilities object (a missing option) is unavailable, never filled in", async () => {
    const body = {
      model: "jev-1.13.0",
      answers: {
        q: { type: "choice", probabilities: { "Clean up": 0.9, Restart: 0.1 } },
      },
    };
    const fetchImpl = fetchReturning(new Response(JSON.stringify(body), { status: 200 }));
    const out = await askJev(diskFullRequest, config, retryCfg, {
      fetch: fetchImpl,
      sleep,
    });
    expect(isFailure(out) && out.error).toBe("unavailable");
  });

  test("reports backend and model on every answer", async () => {
    const fetchImpl = fetchReturning(new Response(recording("choice-success.json"), { status: 200 }));
    const out = await askJev(diskFullRequest, config, retryCfg, {
      fetch: fetchImpl,
      sleep,
    });
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
      if (calls === 1)
        return new Response("", {
          status: 429,
          headers: { "retry-after": "1" },
        });
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

  test("on OpenRouter, a dated snapshot is pinned; the bare version and ~latest float", () => {
    expect(isModelAlias("typesafe/jev-1.13-20260917")).toBe(false);
    expect(isModelAlias("typesafe/jev-1.13")).toBe(true);
    expect(isModelAlias("~typesafe/jev-latest")).toBe(true);
  });

  test("modelMismatch end-to-end: a response reporting a different model than configured is visible to the caller", async () => {
    const res = {
      model: "jev-1.14.0",
      answers: { q: { type: "noul", noul: 0.6 } },
    };
    const out = expectValidAskOutput(
      await askJev(
        {
          kind: "yesno",
          question: "q?",
          guidance: null,
          options: [
            { id: "yes", label: "yes", description: null },
            { id: "no", label: "no", description: null },
          ],
          context: {},
          timeout_ms: 2000,
        },
        { model: "jev-1.13.0", apiKey: "k" },
        retryCfg,
        { fetch: fetchReturning(new Response(JSON.stringify(res))), sleep },
      ),
    );
    expect(isFailure(out)).toBe(false);
    // configured !== responded: the caller can see the mismatch by
    // comparing what it configured against `out.model`.
    expect(!isFailure(out) && out.model).toBe("jev-1.14.0");
    expect(!isFailure(out) && out.model !== "jev-1.13.0").toBe(true);
  });
});

describe("jev response model (SPEC §6.2)", () => {
  test("a missing model in the response is unavailable, not an answer without a model", async () => {
    const res = {
      answers: { q: { type: "noul", noul: 0.6 } },
    };
    const out = await askJev(
      {
        kind: "yesno",
        question: "q?",
        guidance: null,
        options: [
          { id: "yes", label: "yes", description: null },
          { id: "no", label: "no", description: null },
        ],
        context: {},
        timeout_ms: 2000,
      },
      config,
      retryCfg,
      { fetch: fetchReturning(new Response(JSON.stringify(res))), sleep },
    );
    expect(isFailure(out) && out.error).toBe("unavailable");
  });

  test("a non-string model in the response is unavailable", async () => {
    const res = { model: 42, answers: { q: { type: "noul", noul: 0.6 } } };
    const out = await askJev(
      {
        kind: "yesno",
        question: "q?",
        guidance: null,
        options: [
          { id: "yes", label: "yes", description: null },
          { id: "no", label: "no", description: null },
        ],
        context: {},
        timeout_ms: 2000,
      },
      config,
      retryCfg,
      { fetch: fetchReturning(new Response(JSON.stringify(res))), sleep },
    );
    expect(isFailure(out) && out.error).toBe("unavailable");
  });
});

describe("jev label lookups use Object.hasOwn (SPEC §6.2)", () => {
  test("a label named 'constructor' works, rather than resolving to Object.prototype.constructor", async () => {
    const req: AskRequest = {
      kind: "choice",
      question: "q?",
      guidance: null,
      options: [
        { id: "s:ctor", label: "constructor", description: null },
        { id: "s:other", label: "other", description: null },
      ],
      context: {},
      timeout_ms: 2000,
    };
    const res = {
      model: "jev-1.13.0",
      answers: {
        q: { type: "choice", probabilities: { constructor: 0.6, other: 0.4 } },
      },
    };
    const out = expectValidAskOutput(
      await askJev(req, config, retryCfg, {
        fetch: fetchReturning(new Response(JSON.stringify(res))),
        sleep,
      }),
    );
    expect(isFailure(out)).toBe(false);
    expect(!isFailure(out) && out.probs).toEqual({ "s:ctor": 0.6, "s:other": 0.4 });
  });

  test("a label named 'constructor' that's actually missing is reported missing, not silently answered", async () => {
    const req: AskRequest = {
      kind: "choice",
      question: "q?",
      guidance: null,
      options: [
        { id: "s:ctor", label: "constructor", description: null },
        { id: "s:other", label: "other", description: null },
      ],
      context: {},
      timeout_ms: 2000,
    };
    const res = {
      model: "jev-1.13.0",
      answers: { q: { type: "choice", probabilities: { other: 1 } } },
    };
    const out = await askJev(req, config, retryCfg, {
      fetch: fetchReturning(new Response(JSON.stringify(res))),
      sleep,
    });
    expect(isFailure(out) && out.error).toBe("unavailable");
  });
});

// Wire formats per docs.typesafe.ai: Noul answers with a single P(yes);
// Score takes the rubric as an array and keys probabilities by position.
describe("askJev yes/no and Score questions (SPEC §6.2)", () => {
  const yesno: AskRequest = {
    kind: "yesno",
    question: 'Is it worth running "Vacuum the journal"?',
    guidance: null,
    options: [
      { id: "yes", label: "yes", description: null },
      { id: "no", label: "no", description: null },
    ],
    context: {},
    timeout_ms: 2000,
  };
  const score: AskRequest = {
    kind: "score",
    question: "How severe are the errors in `errors`?",
    guidance: null,
    options: [1, 2, 3, 4].map((l, i) => ({
      id: String(l),
      label: String(l),
      description:
        ["known noise, nothing to do", "worth a human look, not urgent", "degraded service", "outage or data at risk"][i] ?? null,
    })) as AskRequest["options"],
    context: { errors: "…" },
    timeout_ms: 2000,
  };
  const capture = (file: string) => {
    const sent: any[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string));
      return new Response(recording(file), { status: 200 });
    });
    return { sent, fetchImpl };
  };

  test("a yes/no question is a Noul with no criteria, and noul is P(yes)", async () => {
    const { sent, fetchImpl } = capture("noul-success.json");
    const out = await askJev(yesno, config, retryCfg, {
      fetch: fetchImpl as any,
      sleep,
    });
    expect(sent[0].questions.q).toEqual({
      type: "noul",
      instructions: { question: 'Is it worth running "Vacuum the journal"?' },
    });
    expect(!isFailure(out) && out.probs).toEqual({ yes: 0.875, no: 0.125 });
  });

  test("a Noul answer without a noul number is unavailable", async () => {
    const res = {
      model: "jev-1.13.0",
      answers: { q: { type: "noul", probabilities: { yes: 1, no: 0 } } },
    };
    const out = await askJev(yesno, config, retryCfg, {
      fetch: fetchReturning(new Response(JSON.stringify(res))) as any,
      sleep,
    });
    expect(out).toMatchObject({ error: "unavailable", backend: "jev" });
  });

  test("a Score question sends the rubric lowest first and maps positions back to levels", async () => {
    const { sent, fetchImpl } = capture("score-success.json");
    const out = await askJev(score, config, retryCfg, {
      fetch: fetchImpl as any,
      sleep,
    });
    expect(sent[0].questions.q.type).toBe("score");
    expect(sent[0].questions.q.criteria).toEqual([
      "known noise, nothing to do",
      "worth a human look, not urgent",
      "degraded service",
      "outage or data at risk",
    ]);
    expect(!isFailure(out) && out.probs).toEqual({
      "1": 0.05,
      "2": 0.1,
      "3": 0.45,
      "4": 0.4,
    });
  });

  test("a Score answer missing a level is unavailable, never filled in", async () => {
    const res = {
      model: "jev-1.13.0",
      answers: {
        q: { type: "score", probabilities: { "0": 0.5, "1": 0.5, "2": 0 } },
      },
    };
    const out = await askJev(score, config, retryCfg, {
      fetch: fetchReturning(new Response(JSON.stringify(res))) as any,
      sleep,
    });
    expect(out).toMatchObject({ error: "unavailable" });
  });

  test("408 is retried", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 408 }))
      .mockResolvedValueOnce(new Response(recording("noul-success.json"), { status: 200 }));
    const out = await askJev(yesno, config, retryCfg, {
      fetch: fetchImpl as any,
      sleep,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(isFailure(out)).toBe(false);
  });

  test("guidance: null is left out of the Jev instructions entirely (not sent as null)", async () => {
    const { sent, fetchImpl } = capture("noul-success.json");
    await askJev(yesno, config, retryCfg, {
      fetch: fetchImpl as any,
      sleep,
    });
    expect(sent[0].questions.q.instructions).toEqual({ question: yesno.question });
    expect(Object.hasOwn(sent[0].questions.q.instructions, "guidance")).toBe(false);
  });

  test("529 overloaded is retried", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("overloaded", { status: 529 }))
      .mockResolvedValueOnce(new Response(recording("noul-success.json"), { status: 200 }));
    const out = await askJev(yesno, config, retryCfg, {
      fetch: fetchImpl as any,
      sleep,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(isFailure(out)).toBe(false);
  });
});
