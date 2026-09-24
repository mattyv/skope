#!/usr/bin/env node
// skope's command line (SPEC §7).

import { parseArgs } from "node:util";
import IDENTITY from "./build-identity.js";
import { writeDemo } from "./host/demo.js";
import { installSkill } from "./host/installSkill.js";
import { runSkill } from "./host/run.js";
import { runTests } from "./host/test.js";
import { plainText } from "./runner/events.js";

const USAGE = `usage: skope <SKILL.md> (--apply | --dry-run) [--no-page] [--param k=v]... [--fake answers.yaml] [--fake-exec cmds.yaml] [--config path]
       skope <SKILL.md> --lint | --explain | --verify [--trace events.jsonl]
       skope <SKILL.md> --test [--scenario DIR or NAME] [--live] [--runs N] [--param k=v]... [--config path]
       skope --demo [DIR] | --install-skill [DIR]
       skope --version | --help`;

// SPEC §7's option list.
const HELP = `usage: skope <path/to/SKILL.md> [options]
  --apply                 execute \`do\` commands and invoke the pager
  --dry-run               don't; a run needs exactly one of these two
  --no-page               with --apply: don't page on handoff
  --param k=v             override a frontmatter param (repeatable, typed, safe-value checked)
  --explain               print sections, transfer graph, and worst-case cost; run nothing
  --verify                run the explore handler and print the verify report; run nothing
  --trace events.jsonl    with --verify: check that one run's path is one the explorer can take
  --lint                  parse + static checks only
  --test                  run the scenarios in tests/ and tests.yaml next to the skill and check each against its expect.yaml; nothing real runs
  --scenario DIR or NAME  with --test: run only this scenario directory, or this tests.yaml scenario by name
  --live                  with --test: ask the configured backend instead of answers.yaml, and repeat each scenario
  --runs N                with --live: run each scenario N times (default: its live.runs, else 10)
  --fake answers.yaml     use the fake backend
  --fake-exec cmds.yaml   use the fake command handler; no real command runs
  --config path           default: $XDG_CONFIG_HOME/skope/config.yaml
  --demo [DIR]            write a demo skill with tests and fakes into DIR (default: ./skope-demo) and
                          say what to try; needs no API key; nothing else goes with it
  --install-skill [DIR]   install the write-skope-skill agent skill, which has an agent write skope
                          skills test first, into DIR (default: ~/.claude/skills); nothing else goes with it
  --version               print the release version and build identity
  --help                  print this`;

async function main(argv: string[]): Promise<number> {
  // Bare `skope` is someone finding out what it does: the options, not an error event.
  if (argv.length === 0) {
    process.stderr.write(`${HELP}\n`);
    return 40;
  }
  // Only the flag itself, not a value that happens to spell it.
  if (argv.length === 1 && argv[0] === "--version") {
    const { version, build } = IDENTITY;
    console.log(`skope ${version} (build identity ${build})`);
    return 0;
  }
  // No skill file: these write one out. An optional directory, and nothing else.
  if (argv.length <= 2 && !argv[1]?.startsWith("-")) {
    if (argv[0] === "--install-skill") return installSkill(argv[1] || undefined);
    if (argv[0] === "--demo") return writeDemo(argv[1] || undefined);
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
    else if (modes > 1 || (values.test && modes > 0))
      usage = "--lint, --verify, --explain, --test and a run (--apply or --dry-run) don't combine";
    else if (values.scenario !== undefined && !values.test) usage = "--scenario goes with --test";
    else if (values.live && !values.test) usage = "--live goes with --test";
    else if (values.runs !== undefined && !values.live) usage = "--runs goes with --live";
    else if (values.runs !== undefined && !/^[1-9]\d{0,5}$/.test(values.runs))
      usage = `--runs must be a whole number from 1, got ${values.runs}`;
    else if (values.test && (values.fake !== undefined || values["fake-exec"] !== undefined || values["no-page"]))
      usage = "--test takes its fakes from each scenario: --fake, --fake-exec and --no-page don't apply";
  } catch (err) {
    usage = (err as Error).message;
  }
  if (usage) process.stderr.write(`${USAGE}\n`);
  else if (values.test)
    return runTests({
      file: positionals[0] as string,
      scenario: values.scenario,
      params: values.param ?? [],
      config: values.config,
      live: values.live ?? false,
      runs: values.runs === undefined ? undefined : Number(values.runs),
    });
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
      test: { type: "boolean" },
      scenario: { type: "string" },
      live: { type: "boolean" },
      runs: { type: "string" },
      fake: { type: "string" },
      "fake-exec": { type: "string" },
      config: { type: "string" },
      help: { type: "boolean" },
    },
  });
}

// A reader that closes stdout early (`skope … | head -n1`) doesn't stop the run: a run that
// stopped half way would leave its effects unknown. Later events are dropped, the run finishes,
// and the exit code still reports its outcome.
process.stdout.on("error", () => {});

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(plainText(`skope: internal error: ${err instanceof Error ? err.stack : String(err)}\n`));
    process.exitCode = 50;
  },
);
