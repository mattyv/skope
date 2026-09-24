#!/usr/bin/env node
// skop's command line (SPEC §7).

import { parseArgs } from "node:util";
import IDENTITY from "./build-identity.js";
import { runSkill } from "./host/run.js";
import { plainText } from "./runner/events.js";

const USAGE = `usage: skop <SKILL.md> (--apply | --dry-run) [--no-page] [--param k=v]... [--fake answers.yaml] [--fake-exec cmds.yaml] [--config path]
       skop <SKILL.md> --lint | --explain | --verify [--trace events.jsonl]
       skop --version | --help`;

// SPEC §7's option list.
const HELP = `usage: skop <path/to/SKILL.md> [options]
  --apply                 execute \`do\` commands and invoke the pager
  --dry-run               don't; a run needs exactly one of these two
  --no-page               with --apply: don't page on handoff
  --param k=v             override a frontmatter param (repeatable, typed, safe-value checked)
  --explain               print sections, transfer graph, and worst-case cost; run nothing
  --verify                run the explore handler and print the verify report; run nothing
  --trace events.jsonl    with --verify: check that one run's path is one the explorer can take
  --lint                  parse + static checks only
  --fake answers.yaml     use the fake backend
  --fake-exec cmds.yaml   use the fake command handler; no real command runs
  --config path           default: $XDG_CONFIG_HOME/skop/config.yaml
  --version               print the release version and build identity
  --help                  print this`;

async function main(argv: string[]): Promise<number> {
  // Only the flag itself, not a value that happens to spell it.
  if (argv.length === 1 && argv[0] === "--version") {
    const { version, build } = IDENTITY;
    console.log(`skop ${version} (build identity ${build})`);
    return 0;
  }
  let values: ReturnType<typeof parse>["values"] = {};
  let positionals: string[] = [];
  let usage: string | undefined;
  try {
    ({ values, positionals } = parse(argv));
    if (values.help) {
      console.log(HELP);
      return 0;
    }
    const modes = [values.lint, values.verify, values.explain, values.apply || values["dry-run"]].filter(Boolean).length;
    if (positionals.length !== 1) usage = "give exactly one skill file";
    else if (values.trace !== undefined && !values.verify) usage = "--trace goes with --verify";
    else if (modes > 1) usage = "--lint, --verify, --explain and a run (--apply or --dry-run) don't combine";
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
      help: { type: "boolean" },
    },
  });
}

// A reader that closes stdout early (`skop … | head -n1`) doesn't stop the run: a run that
// stopped half way would leave its effects unknown. Later events are dropped, the run finishes,
// and the exit code still reports its outcome.
process.stdout.on("error", () => {});

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(plainText(`skop: internal error: ${err instanceof Error ? err.stack : String(err)}\n`));
    process.exitCode = 50;
  },
);
