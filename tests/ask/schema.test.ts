// Finding 8: every backend output produced in tests/ask — success and
// failure alike — must validate against
// contracts/ask.schema.json#/$defs/output. jev.test.ts and openrouter.test.ts
// wrap individual outputs with expectValidAskOutput; this file rounds up
// one success and one failure from every backend (jev, openrouter, fake)
// so the contract is checked end to end, not just spot-checked.

import { readFileSync } from "node:fs";
import { describe, test, vi } from "vitest";
import { askFake } from "../../src/ask/fake.js";
import { askJev } from "../../src/ask/jev.js";
import { askOpenRouter } from "../../src/ask/openrouter.js";
import type { AskRequest } from "../../src/ask/types.js";
import { expectValidAskOutput } from "./schema-helpers.js";

const recording = (dir: string, name: string) => readFileSync(new URL(`../recordings/${dir}/${name}`, import.meta.url), "utf8");

const yesnoRequest: AskRequest = {
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

const retryCfg = { timeoutMs: 100, retries: 0 };
const sleep = async () => {};

describe("every backend output validates against ask.schema.json#/$defs/output", () => {
  test("jev success", async () => {
    expectValidAskOutput(
      await askJev(yesnoRequest, { model: "jev-1.13.0", apiKey: "k" }, retryCfg, {
        fetch: vi.fn(async () => new Response(recording("jev", "noul-success.json"), { status: 200 })),
        sleep,
      }),
    );
  });

  test("jev failure (unavailable)", async () => {
    expectValidAskOutput(
      await askJev(yesnoRequest, { model: "jev-1.13.0", apiKey: "k" }, retryCfg, {
        fetch: vi.fn(async () => new Response("", { status: 500 })),
        sleep,
      }),
    );
  });

  test("jev failure (request_too_large)", async () => {
    expectValidAskOutput(
      await askJev(yesnoRequest, { model: "jev-1.13.0", apiKey: "k" }, retryCfg, {
        fetch: vi.fn(async () => new Response("", { status: 413 })),
        sleep,
      }),
    );
  });

  test("openrouter success", async () => {
    expectValidAskOutput(
      await askOpenRouter(yesnoRequest, { model: "test/model", apiKey: "k" }, retryCfg, {
        fetch: vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                model: "test/model",
                choices: [
                  { message: { content: "A" }, logprobs: { content: [{ token: "A", top_logprobs: [{ token: "A", logprob: 0 }] }] } },
                ],
              }),
              { status: 200 },
            ),
        ),
        sleep,
      }),
    );
  });

  test("openrouter failure (unavailable)", async () => {
    expectValidAskOutput(
      await askOpenRouter(yesnoRequest, { model: "test/model", apiKey: "k" }, retryCfg, {
        fetch: vi.fn(async () => new Response("", { status: 500 })),
        sleep,
      }),
    );
  });

  test("openrouter failure (request_too_large, 413)", async () => {
    expectValidAskOutput(
      await askOpenRouter(yesnoRequest, { model: "test/model", apiKey: "k" }, retryCfg, {
        fetch: vi.fn(async () => new Response("", { status: 413 })),
        sleep,
      }),
    );
  });

  test("fake success", () => {
    expectValidAskOutput(askFake({ "Is it worth it?": { yes: 0.6, no: 0.4 } }, yesnoRequest));
  });

  test("fake failure (unavailable)", () => {
    expectValidAskOutput(askFake({ "Is it worth it?": "unavailable" }, yesnoRequest));
  });
});
