#!/usr/bin/env node
// The `skop-ask` entry point (SPEC §6.1): `skop-ask --request /path/req.json`
// reads the request from that file, asks the configured backend, and
// prints one JSON object (an answer or a failure) to stdout. Exit 0 on
// success, non-zero on failure. Stdin is also accepted, for callers that
// prefer piping the request rather than writing it to a file first; SPEC
// §6.1 only documents `--request`, so that's the contract, and stdin is
// an implementation convenience on top of it.
//
// ponytail: `--fake` is handled by the host in-process (SPEC §5.4 lists it
// as a handler alongside "real", not as a `skop-ask` backend), so this CLI
// only wires up jev and openrouter. Backend selection and credentials come
// from environment variables here rather than re-reading config.yaml,
// since parsing and validating that file (E-CONFIG) is the runner
// stream's job (PLAN.md §4 E), not this one's.

import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { askJev } from "./jev.js";
import { askOpenRouter } from "./openrouter.js";
import type { RetryConfig } from "./retry.js";
import { ConfigError, checkRetries } from "./retry.js";
import type { AskOutput, AskRequest } from "./types.js";
import { isFailure } from "./types.js";

/** `ask.retries` (SPEC §6.2) and `openrouter.min_mass` (SPEC §9) are
 * validated up front, before any network call, so a bad config fails fast
 * as E-CONFIG rather than surfacing as a confusing backend error. */
function checkMinMass(minMass: number): void {
  if (!Number.isFinite(minMass) || minMass <= 0 || minMass > 1) {
    throw new ConfigError(`openrouter.min_mass must be > 0 and <= 1, got ${minMass}`);
  }
}

export async function runAsk(requestJson: string, env: NodeJS.ProcessEnv): Promise<AskOutput> {
  const request = JSON.parse(requestJson) as AskRequest;
  const backend = env.SKOP_ASK_BACKEND ?? "jev";
  const retries = env.SKOP_ASK_RETRIES !== undefined ? Number(env.SKOP_ASK_RETRIES) : 1;
  checkRetries(retries);
  const retryCfg: RetryConfig = { timeoutMs: request.timeout_ms, retries };

  if (backend === "fake") {
    // SPEC §5.4: `--fake` is handled by the host in-process, before
    // skop-ask is ever invoked. Seeing it here means something upstream
    // is misconfigured (e.g. ask.backend: fake reaching skop-ask instead
    // of being intercepted).
    throw new ConfigError(
      "ask.backend 'fake' is handled by the host via --fake (SPEC §5.4), not by skop-ask; skop-ask should never be invoked for it",
    );
  }
  if (backend === "jev") {
    const keyEnv = env.JEV_KEY_ENV ?? "TYPESAFE_API_KEY";
    const apiKey = env[keyEnv];
    if (!apiKey) throw new ConfigError(`jev: no API key in $${keyEnv}`);
    const model = env.JEV_MODEL;
    if (!model) throw new ConfigError("jev: no jev.model configured");
    return askJev(request, { model, apiKey }, retryCfg, { fetch });
  }
  if (backend === "openrouter") {
    const keyEnv = env.OPENROUTER_KEY_ENV ?? "OPENROUTER_API_KEY";
    const apiKey = env[keyEnv];
    if (!apiKey) throw new ConfigError(`openrouter: no API key in $${keyEnv}`);
    const model = env.OPENROUTER_MODEL;
    if (!model) throw new ConfigError("openrouter: no openrouter.model configured");
    const minMass = env.OPENROUTER_MIN_MASS !== undefined ? Number(env.OPENROUTER_MIN_MASS) : undefined;
    if (minMass !== undefined) checkMinMass(minMass);
    return askOpenRouter(request, { model, apiKey, minMass }, retryCfg, {
      fetch,
    });
  }
  throw new ConfigError(`unknown ask.backend: ${backend}`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/* c8 ignore start -- exercised as a subprocess, not by unit tests */
async function main() {
  const args = process.argv.slice(2);
  const requestFlagIndex = args.indexOf("--request");
  const requestPath = requestFlagIndex !== -1 ? args[requestFlagIndex + 1] : undefined;
  const requestJson = requestPath !== undefined ? readFileSync(requestPath, "utf8") : await readStdin();
  try {
    const out = await runAsk(requestJson, process.env);
    process.stdout.write(`${JSON.stringify(out)}\n`);
    process.exit(isFailure(out) ? 1 : 0);
  } catch (err) {
    process.stderr.write(`skop-ask: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

const invokedAs = process.argv[1];
if (invokedAs !== undefined && pathToFileURL(realpathSync(invokedAs)).href === import.meta.url) main();
/* c8 ignore stop */
