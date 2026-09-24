// --verify, --verify --trace and --explain (SPEC §5.6, §7, §12.4): the
// explore handler's graph, reported without running anything.

import IDENTITY from "../build-identity.js";
import type { CoreProgram, Section } from "../contracts.gen.js";
import type { Config } from "../runner/config.js";
import { DEFAULT_GRACE_MS } from "../runner/exec.js";
import type { RunConfig, Val } from "../step.js";
import { askMs, type Costs, coreEventsOf, type Explorable, explore, responseClass, signature, traceFits } from "./explore.js";

export type ReadOnly = { verify: true; trace?: Record<string, unknown>[] } | { explain: true };

export interface VerifyInput {
  program: CoreProgram;
  config: Config;
  params: Record<string, Val>;
  /** Makes a fresh run of the program in explore mode. */
  start(cfg: RunConfig): Explorable;
  /** One JSON line on stdout. */
  emit(e: Record<string, unknown>): void;
  /** One readable line on stderr. */
  say(line: string): void;
}

const EXPLORE_BUILTINS = { host: "host", run_id: "r-explore", skill: "skill" };

export function costs(config: Config): Costs {
  return { graceMs: DEFAULT_GRACE_MS, askMs: askMs(config.ask.timeout_ms, config.ask.retries), pagerMs: config.pager?.timeout_ms ?? 10000 };
}

/** Exit code: 0 when the report is clean (or the trace fits), 40 otherwise. */
export function readOnly(mode: ReadOnly, v: VerifyInput): number {
  const c = costs(v.config);
  const cfg = (dry: boolean, params = v.params): RunConfig => ({
    params,
    builtins: { ...EXPLORE_BUILTINS, skill: v.program.skill },
    dry,
    mode: "explore",
  });

  if ("verify" in mode && mode.trace) {
    const events = mode.trace;
    const start = events.find((e) => e.event === "run_start") as { dry_run?: boolean; params?: Record<string, string> } | undefined;
    // The trace's own mode and params decide which paths exist.
    const params = Object.fromEntries(
      Object.entries(v.params).map(([k, d]) => {
        const t = start?.params?.[k];
        return [k, t === undefined ? d : typeof d === "number" ? Number(t) : t];
      }),
    );
    const core = coreEventsOf(events);
    const { fits, at } = traceFits(v.start(cfg(start?.dry_run ?? false, params)), core.map(signature), c);
    const { version, build } = IDENTITY;
    if (fits) {
      v.emit({ skop_version: version, skop_build: build, trace_fits: true });
      return 0;
    }
    // The first trace event no explored path takes (SPEC §12.4), or none: the trace ends early.
    const e = core[at];
    const mismatch = e
      ? { index: at, event: e.event, section: e.section ?? null, line: e.line ?? null, class: responseClass(e) }
      : { index: at, event: null, section: null, line: null, class: null };
    v.emit({ skop_version: version, skop_build: build, trace_fits: false, mismatch });
    v.say(
      e
        ? `skop: the trace doesn't fit: no explored path has ${e.event}${e.event === "outcome" ? "" : ` at ${e.section}:${e.line}`} (${mismatch.class}), core event ${at + 1} of ${core.length}`
        : `skop: the trace doesn't fit: it ends after ${core.length} core events, where every explored path goes on`,
    );
    return 40;
  }

  const s = explore(v.start(cfg(false)), c);
  const sections = Object.entries(v.program.sections);
  // Lint already warns about these (W-SECTION-UNREACHED); the report lists them.
  const unreached = sections.filter(([, x]) => "body" in x && !s.sections.has(x.name)).map(([, x]) => x as Section);
  const { version, build } = IDENTITY;
  const maxima = { max_ask_calls: s.maxAsks, max_effects: s.maxEffects, worst_case_ms: s.maxMs, asks: s.asks };
  if ("explain" in mode) {
    const n = (k: number, word: string) => `${k} ${word}${k === 1 ? "" : "s"}`;
    const entry = (v.program.sections[v.program.entry.section] as Section).name;
    v.say(
      `skop: ${n(sections.length, "section")}, entry ${entry}; at most ${n(s.maxAsks, "ask")} and ${n(s.maxEffects, "effect")}; worst case ${s.maxMs / 1000}s`,
    );
    v.emit({
      skop_version: version,
      skop_build: build,
      entry: (v.program.sections[v.program.entry.section] as Section).name,
      sections: sections.map(([, x]) => ({
        name: x.name,
        line: x.src,
        kind: "body" in x ? "instructions" : "lists" in x && x.lists.length > 0 ? "data" : "prose",
      })),
      transfers: [...s.transfers].sort(),
      ...maxima,
    });
    return 0;
  }
  // A path that ends without an outcome, or in error, can't get here: the loop would have thrown (P6).
  v.emit({
    skop_version: version,
    skop_build: build,
    paths: s.paths <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(s.paths) : String(s.paths),
    outcomes: [...s.outcomes].sort(),
    ...maxima,
    deadline_ms: v.program.limits.deadline_ms,
    unreached_sections: unreached.map((x) => x.name),
    note: "deadline handoffs aren't explored: once limits.deadline passes, any run hands off between two steps (SPEC §5.4)",
  });
  return 0;
}
