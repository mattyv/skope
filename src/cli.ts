#!/usr/bin/env node
// skop's command line (SPEC §7).

import { parseArgs } from "node:util";
import { identity } from "./host/identity.js";
import { runSkill } from "./host/run.js";

const USAGE = `usage: skop <SKILL.md> (--apply | --dry-run) [--no-page] [--param k=v]... [--fake answers.yaml] [--fake-exec cmds.yaml] [--config path]
       skop <SKILL.md> --lint | --explain | --verify [--trace events.jsonl]
       skop --version`;

async function main(argv: string[]): Promise<number> {
  // Only the flag itself, not a value that happens to spell it.
  if (argv.length === 1 && argv[0] === "--version") {
    const { version, build } = identity();
    console.log(`skop ${version} (build identity ${build})`);
    return 0;
  }
  let values: ReturnType<typeof parse>["values"] = {};
  let positionals: string[] = [];
  let usage: string | undefined;
  try {
    ({ values, positionals } = parse(argv));
    if (positionals.length !== 1) usage = "give exactly one skill file";
    else if (values.trace !== undefined && !values.verify) usage = "--trace goes with --verify";
  } catch (err) {
    usage = (err as Error).message;
  }
  if (usage) process.stderr.write(`${USAGE}\n`);
  return runSkill({
    usage,
    file: positionals[0] ?? "",
    mode: values.lint ? "lint" : values.verify ? "verify" : values.explain ? "explain" : "run",
    trace: values.trace,
    apply: values.apply ?? false,
    dryRun: values["dry-run"] ?? false,
    noPage: values["no-page"] ?? false,
    params: values.param ?? [],
    fake: values.fake,
    fakeExec: values["fake-exec"],
    config: values.config,
  });
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      apply: { type: "boolean" },
      "dry-run": { type: "boolean" },
      "no-page": { type: "boolean" },
      param: { type: "string", multiple: true },
      explain: { type: "boolean" },
      verify: { type: "boolean" },
      trace: { type: "string" },
      lint: { type: "boolean" },
      fake: { type: "string" },
      "fake-exec": { type: "string" },
      config: { type: "string" },
    },
  });
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`skop: internal error: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 50;
  },
);
