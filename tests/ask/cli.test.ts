// The skop-ask entry point (SPEC §6.1): `--request /path/req.json` (or
// stdin) gives the request, and skop-ask asks the configured backend and
// prints an answer or a failure. runAsk is the entry point's core logic,
// tested directly (no real fetch); main()'s `--request` file handling and
// the main-module guard are exercised via the built dist/ask/cli.js, per
// tests/version.test.ts's pattern.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

  test("ask.backend: fake is the host's job, not skop-ask's (SPEC §5.4) — the error says so clearly", async () => {
    await expect(runAsk(JSON.stringify(request), { SKOP_ASK_BACKEND: "fake" })).rejects.toThrow(/host/);
  });

  test("SKOP_ASK_RETRIES outside 0-3 is E-CONFIG", async () => {
    await expect(
      runAsk(JSON.stringify(request), {
        SKOP_ASK_BACKEND: "jev",
        TYPESAFE_API_KEY: "k",
        JEV_MODEL: "jev-1.13.0",
        SKOP_ASK_RETRIES: "4",
      }),
    ).rejects.toMatchObject({ code: "E-CONFIG" });
  });

  test("OPENROUTER_MIN_MASS outside (0, 1] is E-CONFIG", async () => {
    await expect(
      runAsk(JSON.stringify(request), {
        SKOP_ASK_BACKEND: "openrouter",
        OPENROUTER_API_KEY: "k",
        OPENROUTER_MODEL: "test/model",
        OPENROUTER_MIN_MASS: "0",
      }),
    ).rejects.toMatchObject({ code: "E-CONFIG" });
    await expect(
      runAsk(JSON.stringify(request), {
        SKOP_ASK_BACKEND: "openrouter",
        OPENROUTER_API_KEY: "k",
        OPENROUTER_MODEL: "test/model",
        OPENROUTER_MIN_MASS: "1.5",
      }),
    ).rejects.toMatchObject({ code: "E-CONFIG" });
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

describe("skop-ask --request (SPEC §6.1, dist/ask/cli.js)", () => {
  const cli = fileURLToPath(new URL("../../dist/ask/cli.js", import.meta.url));

  test("reads the request from the file named by --request", () => {
    const dir = mkdtempSync(join(tmpdir(), "skop-ask-"));
    const reqPath = join(dir, "req.json");
    writeFileSync(reqPath, JSON.stringify(request));
    let stderr = "";
    let status = 0;
    try {
      execFileSync(process.execPath, [cli, "--request", reqPath], { encoding: "utf8", env: {} });
    } catch (e) {
      const err = e as { status: number; stderr: string };
      status = err.status;
      stderr = err.stderr;
    }
    // No API key configured: fails past the point of reading and parsing
    // the request file, proving --request was honoured (a bad --request
    // path, or stdin instead, would fail differently or hang on stdin).
    expect(status).toBe(1);
    expect(stderr).toContain("API key");
  });
});
