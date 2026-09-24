// `skope SKILL.md --test` (docs/design/skill-tests.md, SPEC §7.3): run each
// scenario under the skill's tests/ directory, and each scenario tests.yaml
// (beside SKILL.md) defines, with its fake commands, as an --apply run that
// runs nothing real, and check what happened against its expect.yaml (or
// the older expected-exit). Scripted, answers come from the scenario's
// answers.yaml, filled in for any `asks` entry it doesn't already answer
// (src/runner/deriveAnswers.ts). With --live, every ask goes to the
// configured backend, and each scenario runs several times: the report
// gives its hit rate and, per ask, the answers chosen and how far
// confidence cleared sure.
//
// Output: one JSON line per scenario, then a summary line, on stdout; a
// readable line for each on stderr. Exit 0 when every scenario passes, 60
// when any fails, 40 when the skill or a scenario is invalid.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { load as loadYaml } from "js-yaml";
import IDENTITY from "../build-identity.js";
import type { CoreProgram } from "../contracts.gen.js";
import { Interp } from "../interp.js";
import { preprocess } from "../preprocess/index.js";
import { sectionId } from "../preprocess/slug.js";
import { asksError, findAsk } from "../runner/askOptions.js";
import { type Config, loadConfig } from "../runner/config.js";
import { deriveAnswers } from "../runner/deriveAnswers.js";
import { plainText } from "../runner/events.js";
import { type Expect, expectError } from "../runner/expect.js";
import { askLine } from "../runner/fakeKeys.js";
import { readTestsYaml } from "../runner/testsYaml.js";
import { explore } from "./explore.js";
import { EXIT, params, runSkill } from "./run.js";
import { costs } from "./verify.js";

export interface TestOptions {
  file: string;
  /** One scenario instead of every one under tests/ and in tests.yaml: a directory, or a tests.yaml scenario's name. */
  scenario?: string;
  params: string[];
  config?: string;
  /** Ask the configured backend instead of answers.yaml, and repeat each scenario. */
  live?: boolean;
  /** --runs: how many times each live scenario runs, over its live.runs. */
  runs?: number;
}

/** Runs per live scenario when neither --runs nor live.runs says (docs/design/skill-tests.md). */
export const DEFAULT_RUNS = 10;
/** Without live.min_margin, a margin under this many points is a warning. */
export const WARN_MARGIN = 5;

type Event = { event: string } & Record<string, unknown>;
/** `source` names its fakes in messages: the folder, or its entry in tests.yaml. */
type Scenario = { name: string; expect: Expect; commands: unknown; answers?: unknown; source: string };
type ScenarioRow = Scenario | { name: string; invalid: string };
type Result = { pass: true } | { pass: false; mismatch: string } | { invalid: string };
type Run = { code: number; events: Event[] } | { invalid: string };

export async function runTests(o: TestOptions): Promise<number> {
  const out = (e: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(e)}\n`);
  const say = (s: string) => process.stderr.write(plainText(`${s}\n`));

  const testsDir = join(dirname(resolve(o.file)), "tests");
  const folderDirs = scenarioDirs(testsDir);
  const folderNames = new Set(folderDirs.map((d) => basename(d)));
  const yamlPath = join(dirname(resolve(o.file)), "tests.yaml");
  const program = parse(o.file);
  const yamlRows = readTestsYamlFile(yamlPath, folderNames, program);

  let scenarios: ScenarioRow[] = [...folderDirs.map(readFolderScenario), ...yamlRows].sort((a, b) => a.name.localeCompare(b.name));
  if (o.scenario !== undefined) {
    const p = resolve(o.scenario);
    if (existsSync(p) && statSync(p).isDirectory()) scenarios = [readFolderScenario(p)];
    else {
      const found = yamlRows.find((r) => r.name === o.scenario);
      scenarios = [found ?? { name: o.scenario, invalid: `no scenario named ${o.scenario}` }];
    }
  }

  const stateDir = mkdtempSync(join(tmpdir(), "skope-test-"));
  const tally = { passed: 0, failed: 0, invalid: 0 };
  if (scenarios.length === 0) {
    say(`skope: no scenarios: ${testsDir} has no scenario directories, and ${yamlPath} doesn't define any`);
    tally.invalid++;
  }
  const summary: Record<string, unknown> = {};

  if (o.live) {
    // The exact count can't be known in advance: a wrong answer can lead down a path with more asks.
    const config = readConfig(o.config);
    const perRun = program ? maxAsks(program, o.params, config) : 0;
    const total = scenarios.reduce((n, s) => n + ("invalid" in s ? 0 : perRun * runsFor(o, s.expect)), 0);
    const backend = config?.ask.backend ?? "jev";
    const model = backend === "openrouter" ? config?.openrouter?.model : config?.jev?.model;
    Object.assign(summary, { live: true, backend, model: model ?? null, max_backend_calls: total });
    say(`skope: live: at most ${total} backend calls to ${backend}${model ? ` (${model})` : ""}`);
  }

  for (const s of scenarios) {
    const name = s.name;
    const dir = join(stateDir, name);
    const report = "invalid" in s ? s : program === null ? { invalid: "the skill doesn't parse" } : undefined;
    const r: Result & { live?: Record<string, unknown>; lines?: string[] } =
      report ??
      (o.live
        ? await liveScenario(o, program as CoreProgram, s as Scenario, dir)
        : await scripted(o, program as CoreProgram, s as Scenario, dir));
    const events = o.live ? dir : join(dir, "events.jsonl");
    if ("invalid" in r) {
      tally.invalid++;
      out({ scenario: name, pass: false, invalid: r.invalid, events, ...r.live });
      say(`INVALID ${name}: ${r.invalid}`);
      continue;
    }
    const extra = r.live ?? {};
    if (r.pass) {
      tally.passed++;
      out({ scenario: name, pass: true, mismatch: null, events, ...extra });
      say(`PASS    ${name}`);
    } else {
      tally.failed++;
      out({ scenario: name, pass: false, mismatch: r.mismatch, events, ...extra });
      say(`FAIL    ${name}: ${r.mismatch} (events: ${events})`);
    }
    for (const l of r.lines ?? []) say(`        ${l}`);
  }
  const { version, build } = IDENTITY;
  out({ skope_version: version, skope_build: build, scenarios: scenarios.length, ...tally, ...summary });
  say(`${tally.passed} passed, ${tally.failed} failed, ${tally.invalid} invalid`);
  return tally.invalid > 0 ? EXIT.invalid : tally.failed > 0 ? 60 : 0;
}

/** Every directory directly under `root`, in name order, except hidden ones like `.cache`. */
function scenarioDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((n) => !n.startsWith("."))
    .map((n) => join(root, n))
    .filter((p) => statSync(p).isDirectory())
    .sort();
}

/** tests.yaml's scenarios, or why each one (or, if it can't be read at all, a single entry named
 * tests.yaml) can't be used. No file at all contributes nothing. */
function readTestsYamlFile(path: string, folderNames: ReadonlySet<string>, program: CoreProgram | null): ScenarioRow[] {
  if (!existsSync(path)) return [];
  let doc: unknown;
  try {
    doc = loadYaml(readFileSync(path, "utf8"));
  } catch (err) {
    return [{ name: "tests.yaml", invalid: `can't read tests.yaml: ${(err as Error).message}` }];
  }
  return readTestsYaml(doc, folderNames, program).map((r) => ("scenario" in r ? r.scenario : r));
}

function parse(file: string): CoreProgram | null {
  try {
    const r = preprocess(readFileSync(file, "utf8"));
    return "program" in r ? r.program : null;
  } catch {
    return null;
  }
}

function readConfig(path: string | undefined): Config | null {
  try {
    return loadConfig(path, () => {});
  } catch {
    return null; // The runs report the E-CONFIG.
  }
}

/** A folder scenario's files, or why they can't be used. */
function readFolderScenario(dir: string): ScenarioRow {
  const name = basename(dir);
  const bad = (invalid: string) => ({ name, invalid });
  const commandsPath = join(dir, "commands.yaml");
  if (!existsSync(commandsPath)) return bad(`${dir} has no commands.yaml`);
  let commands: unknown;
  let answers: unknown;
  try {
    commands = loadYaml(readFileSync(commandsPath, "utf8"));
    const answersPath = join(dir, "answers.yaml");
    if (existsSync(answersPath)) answers = loadYaml(readFileSync(answersPath, "utf8"));
  } catch (err) {
    return bad(`can't read the fakes: ${(err as Error).message}`);
  }
  const base = { name, commands, answers, source: dir };
  const expectFile = join(dir, "expect.yaml");
  const exitFile = join(dir, "expected-exit");
  try {
    if (existsSync(expectFile)) {
      const doc = loadYaml(readFileSync(expectFile, "utf8"));
      const why = expectError(doc);
      return why !== null ? bad(`expect.yaml: ${why}`) : { ...base, expect: doc as Expect };
    }
    if (existsSync(exitFile)) {
      const text = readFileSync(exitFile, "utf8").trim();
      return /^\d+$/.test(text) ? { ...base, expect: { exit: Number(text) } } : bad(`expected-exit must be a number, got ${text}`);
    }
    return bad(`${dir} has neither expect.yaml nor expected-exit`);
  } catch (err) {
    return bad(`can't read the expectations: ${(err as Error).message}`);
  }
}

const runsFor = (o: TestOptions, expect: Expect) => o.runs ?? expect.live?.runs ?? DEFAULT_RUNS;

/** The most asks any path through the skill can reach, from the explorer (as --explain counts them). */
function maxAsks(program: CoreProgram, overrides: string[], config: Config | null): number {
  try {
    const p = params(program, overrides, () => {
      throw new Error("bad param");
    });
    const cfg = { params: p, builtins: { host: "host", run_id: "r-explore", skill: program.skill }, dry: false, mode: "explore" as const };
    return explore(new Interp(program, cfg), costs(config ?? readConfig(undefined) ?? DEFAULT_COSTS_CONFIG)).maxAsks;
  } catch {
    return 0; // The runs report the bad param.
  }
}
const DEFAULT_COSTS_CONFIG = { ask: { timeout_ms: 2000, retries: 1 } } as Config;

/**
 * One run of a scenario: scripted with its answers.yaml, or live against the configured backend.
 * Its (possibly tests.yaml-merged) commands and answers are written into `stateDir` and run from
 * there, exactly like a folder scenario's own files. In scripted mode, `expect.asks` fills in any
 * answer the scenario doesn't already give (src/runner/deriveAnswers.ts); live mode never reads
 * answers.yaml, so none of that applies to it.
 */
async function runOnce(o: TestOptions, program: CoreProgram, s: Scenario, stateDir: string, live: boolean): Promise<Run> {
  mkdirSync(stateDir, { recursive: true });
  const commandsPath = join(stateDir, "commands.yaml");
  writeFileSync(commandsPath, JSON.stringify(s.commands ?? {}));
  let answersPath: string | undefined;
  if (!live) {
    answersPath = join(stateDir, "answers.yaml");
    const merged = deriveAnswers(program, s.expect.asks, (s.answers as Record<string, unknown>) ?? {});
    writeFileSync(answersPath, JSON.stringify(merged));
  }
  const lines: string[] = [];
  const code = await runSkill({
    file: o.file,
    mode: "run",
    apply: true,
    dryRun: false,
    noPage: false,
    params: o.params,
    fake: live ? undefined : answersPath,
    fakeExec: commandsPath,
    config: o.config,
    // Scripted runs don't read the personal config: its redact patterns and on_handoff would change
    // what a scenario sees. Live runs need it for the backend; an explicit --config always applies.
    test: { out: (l) => lines.push(l), err: () => {}, stateDir, builtinConfig: !live && o.config === undefined },
  });
  writeFileSync(join(stateDir, "events.jsonl"), lines.join(""));
  const events = lines
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Event);
  // The run read merged copies of the fakes; a message names what the user wrote instead.
  const named = (e: Event) => {
    const msg = `${e.code}: ${e.message}`.replaceAll(commandsPath, s.source);
    return answersPath ? msg.replaceAll(answersPath, s.source) : msg;
  };
  // A run that ended invalid never started: the skill, a param, the config or the scenario's own
  // files can't be used. That's the scenario being broken, whatever it expects.
  if (code === EXIT.invalid) {
    const bad = events.find((e) => e.event === "error");
    return { invalid: bad ? named(bad) : "the run ended invalid" };
  }
  // Two keys for one statement can only be seen as the run reaches it; it's still the fake file that's broken.
  const ambiguous = events.find((e) => e.event === "error" && e.code === "E-FAKE-AMBIGUOUS");
  if (ambiguous) return { invalid: named(ambiguous) };
  return { code, events };
}

async function scripted(o: TestOptions, program: CoreProgram, s: Scenario, stateDir: string): Promise<Result> {
  const bad = asksError(program, s.expect.asks);
  if (bad !== null) return { invalid: bad };
  const run = await runOnce(o, program, s, stateDir, false);
  if ("invalid" in run) return run;
  const mismatch = check(s.expect, run.code, run.events, program);
  if (mismatch !== null && typeof mismatch === "object") return mismatch;
  return mismatch === null ? { pass: true } : { pass: false, mismatch };
}

interface AskStats {
  line: number;
  section: string;
  /** The expect.yaml key, when the scenario names this ask. */
  key?: string;
  sure: number;
  reached: number;
  chosen: Record<string, number>;
  confidences: number[];
  gateFailures: number;
}

type LiveResult = (Result & { live: Record<string, unknown>; lines: string[] }) | { invalid: string; live?: Record<string, unknown> };

/**
 * Runs a scenario `runs` times against the real backend (docs/design/skill-tests.md). A run is a
 * hit when it satisfies the whole expect.yaml; an expected ask it never reached is a miss. The
 * scenario fails when its hit rate is under live.min_hit_rate (default 1), or when it sets
 * live.min_margin and the lowest confidence of an expected ask clears sure by less.
 */
async function liveScenario(o: TestOptions, program: CoreProgram, s: Scenario, stateDir: string): Promise<LiveResult> {
  const bad = asksError(program, s.expect.asks);
  if (bad !== null) return { invalid: bad };
  const runs = runsFor(o, s.expect);
  const keys = new Map<number, string>();
  for (const key of Object.keys(s.expect.asks ?? {})) {
    const line = askLine(program, key);
    if (line === null) return { invalid: `asks.${key} doesn't name exactly one ask` };
    keys.set(line, key);
  }
  const stats = new Map<number, AskStats>();
  let hits = 0;
  let firstMiss: string | undefined;
  for (let i = 1; i <= runs; i++) {
    const run = await runOnce(o, program, s, join(stateDir, `run-${i}`), true);
    if ("invalid" in run) return run;
    const mismatch = check(s.expect, run.code, run.events, program);
    if (mismatch !== null && typeof mismatch === "object") return mismatch;
    if (mismatch === null) hits++;
    else firstMiss ??= `run ${i}: ${mismatch}`;
    for (const e of run.events) {
      if (e.event !== "ask") continue;
      const line = e.line as number;
      const a = stats.get(line) ?? {
        line,
        section: e.section as string,
        key: keys.get(line),
        sure: e.sure as number,
        reached: 0,
        chosen: {},
        confidences: [],
        gateFailures: 0,
      };
      stats.set(line, a);
      a.reached++;
      const label = labelOf(program, line, e.chosen as string | number | null) ?? `(${e.detail ?? "no answer"})`;
      a.chosen[label] = (a.chosen[label] ?? 0) + 1;
      if (typeof e.confidence === "number") a.confidences.push(e.confidence);
      if (!e.passed) a.gateFailures++;
    }
  }

  const minHit = s.expect.live?.min_hit_rate ?? 1;
  const minMargin = s.expect.live?.min_margin;
  const warnings: string[] = [];
  let failure = hits / runs < minHit ? `hit rate ${hits}/${runs} is under ${minHit}; first miss: ${firstMiss}` : undefined;
  const asks = [...stats.values()]
    .sort((a, b) => a.line - b.line)
    .map((a) => {
      const sorted = [...a.confidences].sort((x, y) => x - y);
      const min = sorted[0];
      const median = sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] as number) : undefined;
      // Points, like sure: 81% against sure 80 is +1.
      const margin = min === undefined ? undefined : Math.round(min * 100 - a.sure);
      const name = a.key ?? `${a.section}:${a.line}`;
      if (a.key !== undefined && margin !== undefined) {
        if (minMargin !== undefined && margin < minMargin) failure ??= `${name}: margin ${sign(margin)} is under min_margin ${minMargin}`;
        else if (minMargin === undefined && margin < WARN_MARGIN) warnings.push(`${name}: margin ${sign(margin)} is near the gate`);
      }
      return {
        ask: name,
        line: a.line,
        reached: a.reached,
        chosen: a.chosen,
        confidence_min: min ?? null,
        confidence_median: median ?? null,
        sure: a.sure,
        margin: margin ?? null,
        gate_failures: a.gateFailures,
      };
    });
  const live = { runs, hits, hit_rate: hits / runs, min_hit_rate: minHit, asks, warnings };
  const lines = asks.map((a) => {
    const top = Object.entries(a.chosen).sort((x, y) => y[1] - x[1])[0];
    const conf = a.confidence_min === null ? "conf -" : `conf min ${pct(a.confidence_min)} med ${pct(a.confidence_median as number)}`;
    const warn = warnings.find((w) => w.startsWith(`${a.ask}:`)) ? "  WARN near gate" : "";
    return `${a.ask}  ${top ? `${top[0]} ${top[1]}/${a.reached}` : "-"}  ${conf}  sure ${a.sure}  margin ${a.margin === null ? "-" : sign(a.margin)}${warn}`;
  });
  lines.unshift(`hits ${hits}/${runs} (min ${minHit})`);
  return failure === undefined ? { pass: true, live, lines } : { pass: false, mismatch: failure, live, lines };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/** What an ask event's chosen value is called in expect.yaml: a section's name, or the value itself. */
function labelOf(program: CoreProgram, line: number, chosen: string | number | null): string | null {
  if (chosen === null) return null;
  return sectionOptions(program, line) && typeof chosen === "string" ? (program.sections[chosen]?.name ?? chosen) : String(chosen);
}

// The pager's link escaping (src/host/loop.ts) puts a zero-width space after `@`, in `://` and after a
// dot between letters; page_contains is written against the page as the skill wrote it.
const PAGER_ESCAPE = "\u200b";
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
    const pages = events
      .filter((e) => ["page", "would_page", "handoff_page"].includes(e.event))
      .map((e) => String(e.text).replaceAll(PAGER_ESCAPE, ""));
    if (!pages.some((t) => t.includes(expect.page_contains as string)))
      return `page_contains: no page contains "${expect.page_contains}"${pages.length ? `; pages: ${pages.join(" | ")}` : "; the run sent no page"}`;
  }
  if (expect.max_ask_calls !== undefined && ((outcome?.ask_calls as number) ?? 0) > expect.max_ask_calls)
    return `max_ask_calls: expected at most ${expect.max_ask_calls}, got ${outcome?.ask_calls}`;
  return null;
}

/** Whether the ask on `line` offers sections as its options, rather than a list, yes/no or a Score. */
function sectionOptions(program: CoreProgram, line: number): boolean {
  return findAsk(program, line)?.sections !== undefined;
}
