// Opt-in live tests (PLAN.md §4 D): one per backend and question kind,
// recording real responses so the fixtures in tests/recordings/ come from
// the real APIs. Skipped unless SKOP_LIVE=1 and the relevant API key are
// set, so they never run in normal CI.

import { writeFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { askJev } from "../../src/ask/jev.js";
import { askOpenRouter } from "../../src/ask/openrouter.js";
import type { AskRequest } from "../../src/ask/types.js";
import { isFailure } from "../../src/ask/types.js";

const live = process.env.SKOP_LIVE === "1";
const retryCfg = { timeoutMs: 10_000, retries: 1 };

const choiceRequest: AskRequest = {
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
  context: { used: "91%", errors: "journalctl: 3 disk write errors on /dev/sda1", biggest: "/var/log 12G" },
  timeout_ms: 10_000,
};

const yesnoRequest: AskRequest = {
  kind: "yesno",
  question: 'Given `used` and `biggest`, is it worth running "Vacuum the journal"?',
  guidance: null,
  options: [
    { id: "yes", label: "yes", description: null },
    { id: "no", label: "no", description: null },
  ],
  context: { used: "91%", biggest: "/var/log 12G" },
  timeout_ms: 10_000,
};

describe.runIf(live && process.env.TYPESAFE_API_KEY)("jev live (SKOP_LIVE=1)", () => {
  const jevConfig = { model: process.env.JEV_MODEL ?? "jev-1.13.0", apiKey: process.env.TYPESAFE_API_KEY as string };

  test("a choice question", async () => {
    const out = await askJev(choiceRequest, jevConfig, retryCfg, { fetch });
    writeFileSync(new URL("../recordings/jev/live-choice.json", import.meta.url), JSON.stringify(out, null, 2));
    expect(isFailure(out)).toBe(false);
  });

  test("a yesno question", async () => {
    const out = await askJev(yesnoRequest, jevConfig, retryCfg, { fetch });
    writeFileSync(new URL("../recordings/jev/live-yesno.json", import.meta.url), JSON.stringify(out, null, 2));
    expect(isFailure(out)).toBe(false);
  });
});

describe.runIf(live && process.env.OPENROUTER_API_KEY)("openrouter live (SKOP_LIVE=1)", () => {
  const openrouterConfig = {
    model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
    apiKey: process.env.OPENROUTER_API_KEY as string,
  };

  test("a choice question", async () => {
    const out = await askOpenRouter(choiceRequest, openrouterConfig, retryCfg, { fetch });
    writeFileSync(new URL("../recordings/openrouter/live-choice.json", import.meta.url), JSON.stringify(out, null, 2));
    expect(isFailure(out)).toBe(false);
  });

  test("a yesno question", async () => {
    const out = await askOpenRouter(yesnoRequest, openrouterConfig, retryCfg, { fetch });
    writeFileSync(new URL("../recordings/openrouter/live-yesno.json", import.meta.url), JSON.stringify(out, null, 2));
    expect(isFailure(out)).toBe(false);
  });
});
