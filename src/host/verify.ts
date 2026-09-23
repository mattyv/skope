// --verify, --verify --trace and --explain (SPEC §5.6, §7, §12.4): the
// explore handler's graph, reported without running anything.

import { readFileSync } from "node:fs";
import type { CoreProgram, Section } from "../contracts.gen.js";
import type { Config } from "../runner/config.js";
import { DEFAULT_GRACE_MS } from "../runner/exec.js";
import type { RunConfig, Val } from "../step.js";
import { askMs, type Costs, type Explorable, explore, traceFits, traceOf } from "./explore.js";
import { identity } from "./identity.js";

export type ReadOnly = { verify: true; trace?: string } | { explain: true };

export interface VerifyInput {
  program: CoreProgram;
  config: Config;
  params: Record<string, Val>;
  /** Makes a fresh run of the program in explore mode. */
  start(cfg: RunConfig): Explorable;
  /** One JSON line on stdout. */
  emit(e: Record<string, unknown>): void;
  /** A W-* warning (SPEC §7.1). */
  warn(code: string, message: string, line: number): void;
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
    const events = readFileSync(mode.trace, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const start = events.find((e) => e.event === "run_start") as { dry_run?: boolean; params?: Record<string, string> } | undefined;
    // The trace's own mode and params decide which paths exist.
    const params = Object.fromEntries(
      Object.entries(v.params).map(([k, d]) => {
        const t = start?.params?.[k];
        return [k, t === undefined ? d : typeof d === "number" ? Number(t) : t];
      }),
    );
    const fits = traceFits(v.start(cfg(start?.dry_run ?? false, params)), traceOf(events), c);
    return fits ? 0 : 40;
  }

  const s = explore(v.start(cfg(false)), c);
  const sections = Object.entries(v.program.sections);
  const unreached = sections.filter(([, x]) => "body" in x && !s.sections.has(x.name)).map(([, x]) => x as Section);
  for (const x of unreached) v.warn("W-SECTION-UNREACHED", `no path reaches ${x.name}`, x.src);
  const { version, build } = identity();
  const maxima = { max_ask_calls: s.maxAsks, max_effects: s.maxEffects, worst_case_ms: s.maxMs };
  if ("explain" in mode) {
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
  const ok = s.paths > 0n && [...s.outcomes].every((o) => /^(stopped|paged|handoff:)/.test(o));
  v.emit({
    skop_version: version,
    skop_build: build,
    ok,
    paths: s.paths <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(s.paths) : String(s.paths),
    outcomes: [...s.outcomes].sort(),
    ...maxima,
    deadline_ms: v.program.limits.deadline_ms,
    unreached_sections: unreached.map((x) => x.name),
    note: "deadline handoffs aren't explored: once limits.deadline passes, any run hands off between two steps (SPEC §5.4)",
  });
  return ok ? 0 : 40;
}
