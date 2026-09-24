// `skope SKILL.md --test` (docs/design/skill-tests.md, SPEC §7.3): run each
// scenario under the skill's tests/ directory with its fake commands and
// answers, as an --apply run that runs nothing real, and check what happened
// against its expect.yaml (or the older expected-exit).
//
// Output: one JSON line per scenario, then a summary line, on stdout; a
// readable line for each on stderr. Exit 0 when every scenario passes, 60
// when any fails, 40 when the skill or a scenario is invalid.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { load as loadYaml } from "js-yaml";
import IDENTITY from "../build-identity.js";
import type { CoreProgram, Section } from "../contracts.gen.js";
import { preprocess } from "../preprocess/index.js";
import { sectionId } from "../preprocess/slug.js";
import { plainText } from "../runner/events.js";
import { type Expect, expectError } from "../runner/expect.js";
import { resolveFakeKeys } from "../runner/fakeKeys.js";
import { EXIT, runSkill } from "./run.js";

export interface TestOptions {
  file: string;
  /** One scenario directory instead of every directory under tests/. */
  scenario?: string;
  params: string[];
  config?: string;
}

type Event = { event: string } & Record<string, unknown>;

/** Codes that mean the scenario's own files, or the skill, can't be used: invalid, not failed. */
const INVALID_CODES = new Set(["E-FAKE-AMBIGUOUS", "E-FAKE-UNUSED", "E-CONFIG", "E-USAGE", "E-PARAM-UNKNOWN", "E-PARAM-TYPE"]);

type Result = { pass: true } | { pass: false; mismatch: string } | { invalid: string };

export async function runTests(o: TestOptions): Promise<number> {
  const out = (e: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(e)}\n`);
  const say = (s: string) => process.stderr.write(plainText(`${s}\n`));

  const dirs = o.scenario !== undefined ? [resolve(o.scenario)] : scenarioDirs(join(dirname(resolve(o.file)), "tests"));
  const stateDir = mkdtempSync(join(tmpdir(), "skope-test-"));
  const tally = { passed: 0, failed: 0, invalid: 0 };
  if (dirs.length === 0) {
    say(`skope: no scenarios: ${join(dirname(o.file), "tests")} has no scenario directories`);
    tally.invalid++;
  }
  const program = parse(o.file);

  for (const dir of dirs) {
    const name = basename(dir);
    const events = join(stateDir, name, "events.jsonl");
    const result = await runScenario(o, program, dir, join(stateDir, name));
    if ("invalid" in result) {
      tally.invalid++;
      out({ scenario: name, pass: false, invalid: result.invalid, events });
      say(`INVALID ${name}: ${result.invalid}`);
    } else if (result.pass) {
      tally.passed++;
      out({ scenario: name, pass: true, mismatch: null, events });
      say(`PASS    ${name}`);
    } else {
      tally.failed++;
      out({ scenario: name, pass: false, mismatch: result.mismatch, events });
      say(`FAIL    ${name}: ${result.mismatch} (events: ${events})`);
    }
  }
  const { version, build } = IDENTITY;
  out({ skope_version: version, skope_build: build, scenarios: dirs.length, ...tally });
  say(`${tally.passed} passed, ${tally.failed} failed, ${tally.invalid} invalid`);
  return tally.invalid > 0 ? EXIT.invalid : tally.failed > 0 ? 60 : 0;
}

/** Every directory directly under `root`, in name order. */
function scenarioDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((n) => join(root, n))
    .filter((p) => statSync(p).isDirectory())
    .sort();
}

function parse(file: string): CoreProgram | null {
  try {
    const r = preprocess(readFileSync(file, "utf8"));
    return "program" in r ? r.program : null;
  } catch {
    return null;
  }
}

async function runScenario(o: TestOptions, program: CoreProgram | null, dir: string, stateDir: string): Promise<Result> {
  const commands = join(dir, "commands.yaml");
  if (!existsSync(commands)) return { invalid: `${dir} has no commands.yaml` };
  let expect: Expect | { exit: number };
  const expectFile = join(dir, "expect.yaml");
  const exitFile = join(dir, "expected-exit");
  try {
    if (existsSync(expectFile)) {
      const doc = loadYaml(readFileSync(expectFile, "utf8"));
      const why = expectError(doc);
      if (why !== null) return { invalid: `expect.yaml: ${why}` };
      expect = doc as Expect;
    } else if (existsSync(exitFile)) {
      const text = readFileSync(exitFile, "utf8").trim();
      if (!/^\d+$/.test(text)) return { invalid: `expected-exit must be a number, got ${text}` };
      expect = { exit: Number(text) };
    } else return { invalid: `${dir} has neither expect.yaml nor expected-exit` };
  } catch (err) {
    return { invalid: `can't read the expectations: ${(err as Error).message}` };
  }

  mkdirSync(stateDir, { recursive: true });
  // Every ask needs an answer: with no answers.yaml, any ask the run reaches is unmatched.
  let answers = join(dir, "answers.yaml");
  if (!existsSync(answers)) {
    answers = join(stateDir, "answers.yaml");
    writeFileSync(answers, "{}");
  }

  const lines: string[] = [];
  const code = await runSkill({
    file: o.file,
    mode: "run",
    apply: true,
    dryRun: false,
    noPage: false,
    params: o.params,
    fake: answers,
    fakeExec: commands,
    config: o.config,
    test: { out: (l) => lines.push(l), err: () => {}, stateDir },
  });
  writeFileSync(join(stateDir, "events.jsonl"), lines.join(""));
  const events = lines
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Event);

  const bad = events.find((e) => e.event === "error" && (INVALID_CODES.has(e.code as string) || e.stage === "parse" || e.stage === "lint"));
  if (bad) return { invalid: `${bad.code}: ${bad.message}` };
  if (!program) return { invalid: "the skill doesn't parse" };
  const mismatch = check(expect, code, events, program);
  if (mismatch !== null && typeof mismatch === "object") return mismatch;
  return mismatch === null ? { pass: true } : { pass: false, mismatch };
}

const same = (a: string, b: string) => sectionId(a) === sectionId(b);
const arrow = (p: string[]) => p.join(" → ");

/** The first way the run differs from `expect`, null if it doesn't, or why `expect` can't be checked. */
export function check(expect: Expect, code: number, events: Event[], program: CoreProgram): string | null | { invalid: string } {
  const outcome = events.findLast((e) => e.event === "outcome");
  const error = events.find((e) => e.event === "error");
  const got = `${outcome?.outcome ?? "no outcome"}${outcome?.reason ? ` (${outcome.reason})` : ""}${error ? `, ${error.code}: ${error.message}` : ""}`;

  // A run that broke (no fake for a command or question, or any other runtime error) fails
  // whatever else expect.yaml checks, unless the scenario says that's what it expects.
  const broke = events.find((e) => e.event === "error" && e.stage === "runtime");
  if (broke && expect.exit !== EXIT.error) return `the run failed: ${broke.code}: ${broke.message}`;
  if (expect.outcome !== undefined && outcome?.outcome !== expect.outcome) return `outcome: expected ${expect.outcome}, got ${got}`;
  const exit = expect.exit ?? (expect.outcome !== undefined ? EXIT[expect.outcome] : undefined);
  if (exit !== undefined && code !== exit) return `exit: expected ${exit}, got ${code}: ${got}`;
  if (expect.handoff_reason !== undefined && outcome?.reason !== expect.handoff_reason)
    return `handoff_reason: expected ${expect.handoff_reason}, got ${got}`;

  const entry = program.sections[program.entry.section];
  const path = [entry?.name ?? program.entry.section, ...events.filter((e) => e.event === "transfer").map((e) => e.to as string)];
  if (expect.path !== undefined && !(path.length === expect.path.length && expect.path.every((s, i) => same(s, path[i] as string))))
    return `path: expected ${arrow(expect.path)}, got ${arrow(path)}`;
  const prefix = expect.path_prefix;
  if (prefix !== undefined && !(path.length >= prefix.length && prefix.every((s, i) => same(s, path[i] as string))))
    return `path_prefix: expected ${arrow(prefix)}, got ${arrow(path)}`;

  for (const [key, want] of Object.entries(expect.asks ?? {})) {
    const line = askLine(program, key);
    if (line === null) return { invalid: `asks.${key} doesn't name exactly one ask` };
    const ask = events.findLast((e) => e.event === "ask" && e.line === line);
    if (!ask) return `asks.${key}: expected ${want.chosen}, but the run never reached that ask`;
    const chosen = ask.chosen as string | number | null;
    // Only a section-option ask chooses by section id; a list item is its value, whatever it looks like.
    const bySection = sectionOptions(program, line);
    const matches = bySection ? sectionId(String(want.chosen)) === chosen : String(want.chosen) === String(chosen);
    const label = bySection && typeof chosen === "string" ? (program.sections[chosen]?.name ?? chosen) : chosen;
    if (!matches) return `asks.${key}: expected ${want.chosen}, got ${label ?? `nothing (${ask.detail ?? "no answer"})`}`;
    if (!ask.passed) return `asks.${key}: chose ${want.chosen}, but below sure (confidence ${ask.confidence}, sure ${ask.sure}%)`;
  }

  if (expect.page_contains !== undefined) {
    const pages = events.filter((e) => ["page", "would_page", "handoff_page"].includes(e.event)).map((e) => String(e.text));
    if (!pages.some((t) => t.includes(expect.page_contains as string)))
      return `page_contains: no page contains "${expect.page_contains}"${pages.length ? `; pages: ${pages.join(" | ")}` : "; the run sent no page"}`;
  }
  if (expect.max_ask_calls !== undefined && ((outcome?.ask_calls as number) ?? 0) > expect.max_ask_calls)
    return `max_ask_calls: expected at most ${expect.max_ask_calls}, got ${outcome?.ask_calls}`;
  return null;
}

/** Whether the ask on `line` offers sections as its options, rather than a list, yes/no or a Score. */
function sectionOptions(program: CoreProgram, line: number): boolean {
  type Body = Section["body"];
  const find = (body: Body): boolean =>
    body.some((st) =>
      "ask" in st && st.src === line ? st.ask.sections !== undefined : "for_each" in st && find(st.for_each.body as Body),
    );
  return Object.values(program.sections).some((sec) => "body" in sec && find(sec.body));
}

/** The line of the ask an `asks` key names: `Section` (its only ask) or `Section.var` (the ask that binds var). */
function askLine(program: CoreProgram, key: string): number | null {
  for (const k of [key, `${key}.ask`]) {
    const { doc, issues } = resolveFakeKeys(program, { [k]: true }, "answers", true);
    const lineKey = Object.keys(doc).find((d) => /^line:\d+$/.test(d));
    if (lineKey && issues.length === 0) return Number(lineKey.slice(5));
  }
  return null;
}
