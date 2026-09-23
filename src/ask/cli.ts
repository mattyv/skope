#!/usr/bin/env node
// The `skop-ask` entry point (SPEC §6.1): reads a request JSON from stdin,
// asks the configured backend, and prints one JSON object (an answer or a
// failure) to stdout. Exit 0 on success, non-zero on failure.
//
// ponytail: `--fake` is handled by the host in-process (SPEC §5.4 lists it
// as a handler alongside "real", not as a `skop-ask` backend), so this CLI
// only wires up jev and openrouter. Backend selection and credentials come
// from environment variables here rather than re-reading config.yaml,
// since parsing and validating that file (E-CONFIG) is the runner
// stream's job (PLAN.md §4 E), not this one's.

import { askJev } from "./jev.js";
import { askOpenRouter } from "./openrouter.js";
import type { RetryConfig } from "./retry.js";
import { ConfigError } from "./retry.js";
import type { AskOutput, AskRequest } from "./types.js";
import { isFailure } from "./types.js";

export async function runAsk(requestJson: string, env: NodeJS.ProcessEnv): Promise<AskOutput> {
  const request = JSON.parse(requestJson) as AskRequest;
  const backend = env.SKOP_ASK_BACKEND ?? "jev";
  const retryCfg: RetryConfig = {
    timeoutMs: request.timeout_ms,
    retries: env.SKOP_ASK_RETRIES !== undefined ? Number(env.SKOP_ASK_RETRIES) : 1,
  };

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
  const requestJson = await readStdin();
  try {
    const out = await runAsk(requestJson, process.env);
    process.stdout.write(`${JSON.stringify(out)}\n`);
    process.exit(isFailure(out) ? 1 : 0);
  } catch (err) {
    process.stderr.write(`skop-ask: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
/* c8 ignore stop */
