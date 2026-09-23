// The explore handler (SPEC §5.4): answer every request every way a real
// run could, memoised on the core's abstract state, and summarise the
// finite graph that makes (SPEC §5.6). Maxima are longest paths over that
// graph, never a list of paths. Also replays one run's trace through the
// same graph (SPEC §12.4).

import { type CoreEvent, EVENT_FIELDS, type Next, type Outcome, type Response } from "../step.js";

/** A run the explorer can branch: the interpreter in explore mode. */
export interface Explorable {
  step(r: Response): { events: CoreEvent[]; next: Next };
  /** An independent copy of the run so far. */
  fork(): Explorable;
  /** The abstract state (SPEC §5.4): equal keys, equal futures. */
  key(): string;
}

export interface Costs {
  /** Kill grace after a command's timeout (SPEC §4.4). */
  graceMs: number;
  /** Every backend attempt allowed by ask.retries, with its waits (SPEC §6.2). */
  askMs: number;
  pagerMs: number;
}

export interface Summary {
  paths: bigint;
  maxAsks: number;
  maxEffects: number;
  maxMs: number;
  /** `stopped`, `paged`, or `handoff:<reason>`. */
  outcomes: Set<string>;
  sections: Set<string>;
  transfers: Set<string>;
}

type Branch = { response: Response; ms: number };

/** Every answer a real run could get to `next` (SPEC §5.4), with its worst-case time. */
export function branches(next: Exclude<Next, { kind: "done" }>, costs: Costs): Branch[] {
  switch (next.kind) {
    case "exec": {
      const ms = next.timeoutMs + costs.graceMs;
      const r = (exit: number | null, timedOut: boolean): Branch => ({
        response: { kind: "exec", exit, stdout: "", stderrTail: "", timedOut },
        ms,
      });
      return [r(0, false), r(1, false), r(null, true)];
    }
    case "ask": {
      const ids = next.request.options.map((o) => o.id);
      const answer = (probs: Record<string, number>): Branch => ({
        response: { kind: "answer", probs, unassigned: 0, backend: "explore", model: "explore", ms: 0 },
        ms: costs.askMs,
      });
      return [
        ...ids.map((id) => answer(Object.fromEntries(ids.map((x) => [x, x === id ? 1 : 0])))),
        // Unsure: all of it unassigned, so no option can pass a gate (P5), whatever `sure` is.
        {
          response: {
            kind: "answer",
            probs: Object.fromEntries(ids.map((x) => [x, 0])),
            unassigned: 1,
            backend: "explore",
            model: "explore",
            ms: 0,
          },
          ms: costs.askMs,
        },
        { response: { kind: "ask_failed", error: "unavailable", backend: "explore" }, ms: costs.askMs },
      ];
    }
    case "page":
      return [{ response: { kind: "page", ok: true }, ms: costs.pagerMs }];
    case "choose":
      return Array.from({ length: next.n }, (_, i) => ({ response: { kind: "picked", i }, ms: 0 }));
  }
}

const outcomeName = (o: Outcome) => (o.kind === "handoff" ? `handoff:${o.reason}` : o.kind);

function edge(events: CoreEvent[], ms: number, rest: Summary): Summary {
  const sections = new Set(rest.sections);
  const transfers = new Set(rest.transfers);
  let asks = 0;
  let effects = 0;
  for (const e of events) {
    if (e.at) sections.add(e.at.section);
    if (e.event === "ask") asks++;
    if (e.event === "effect_start") effects++;
    // A section entered by a transfer is reached through its own events: at least the outcome, whose
    // `at` is where the run ended, as for a section that only hands off.
    if (e.event === "transfer") transfers.add(`${e.from} → ${e.to}`);
  }
  return { ...rest, maxAsks: rest.maxAsks + asks, maxEffects: rest.maxEffects + effects, maxMs: rest.maxMs + ms, sections, transfers };
}

function merge(a: Summary, b: Summary): Summary {
  return {
    paths: a.paths + b.paths,
    maxAsks: Math.max(a.maxAsks, b.maxAsks),
    maxEffects: Math.max(a.maxEffects, b.maxEffects),
    maxMs: Math.max(a.maxMs, b.maxMs),
    outcomes: new Set([...a.outcomes, ...b.outcomes]),
    sections: new Set([...a.sections, ...b.sections]),
    transfers: new Set([...a.transfers, ...b.transfers]),
  };
}

const EMPTY: Summary = { paths: 0n, maxAsks: 0, maxEffects: 0, maxMs: 0, outcomes: new Set(), sections: new Set(), transfers: new Set() };

/** Explores every path from the start of a run (P1 makes the graph finite). */
export function explore(start: Explorable, costs: Costs): Summary {
  const memo = new Map<string, Summary>();
  const visit = (run: Explorable, next: Next): Summary => {
    if (next.kind === "done") {
      // A handoff may page (SPEC §8), so its worst case includes the pager's timeout.
      const maxMs = next.outcome.kind === "handoff" ? costs.pagerMs : 0;
      return { ...EMPTY, paths: 1n, maxMs, outcomes: new Set([outcomeName(next.outcome)]) };
    }
    const key = run.key();
    const seen = memo.get(key);
    if (seen) return seen;
    let sum = EMPTY;
    for (const b of branches(next, costs)) {
      const child = run.fork();
      const out = child.step(b.response);
      sum = merge(sum, edge(out.events, b.ms, visit(child, out.next)));
    }
    memo.set(key, sum);
    return sum;
  };
  const first = start.step({ kind: "none" });
  return edge(first.events, 0, visit(start, first.next));
}

/** The core's event kinds: the ones a trace is replayed on. */
const CORE_EVENTS = new Set(Object.keys(EVENT_FIELDS).filter((k) => (EVENT_FIELDS[k]?.core.length ?? 0) > 0));

/**
 * What a trace event says about the path (SPEC §12.4): where it happened and
 * how the request was answered, not values the explorer doesn't know.
 */
export function signature(e: Record<string, unknown>): string {
  const cls = (() => {
    switch (e.event) {
      case "run":
      case "check_cmd":
      case "effect_end":
        return e.timed_out ? "timeout" : e.exit === 0 ? "ok" : "fail";
      case "check":
        return String(e.result);
      case "ask":
        return e.passed ? String(e.chosen) : e.detail ? "unavailable" : "unsure";
      case "transfer":
        return String(e.to);
      case "outcome":
        return `${e.outcome}:${e.reason}`;
      default:
        return "";
    }
  })();
  return e.event === "outcome" ? `outcome ${cls}` : `${e.event} ${e.section}:${e.line} ${cls}`;
}

/** The core events of a run's events.jsonl, as signatures. */
export function traceOf(events: Record<string, unknown>[]): string[] {
  return events.filter((e) => CORE_EVENTS.has(e.event as string)).map(signature);
}

const flat = (e: CoreEvent) => ({ ...(e.at ?? {}), ...e }) as Record<string, unknown>;

/** Whether the explorer can take exactly this path, start to outcome (SPEC §12.4). */
export function traceFits(start: Explorable, trace: string[], costs: Costs): boolean {
  const failed = new Set<string>();
  const matches = (events: CoreEvent[], i: number) => events.every((e, k) => trace[i + k] === signature(flat(e)));
  const visit = (run: Explorable, next: Next, i: number): boolean => {
    if (next.kind === "done") return i === trace.length;
    const key = `${i} ${run.key()}`;
    if (failed.has(key)) return false;
    for (const b of branches(next, costs)) {
      const child = run.fork();
      const out = child.step(b.response);
      if (matches(out.events, i) && visit(child, out.next, i + out.events.length)) return true;
    }
    failed.add(key);
    return false;
  };
  const first = start.step({ kind: "none" });
  return matches(first.events, 0) && visit(start, first.next, first.events.length);
}

/** Worst-case time for one ask: every attempt, and the longest wait before each retry (SPEC §6.2). */
export function askMs(timeoutMs: number, retries: number): number {
  let ms = (retries + 1) * timeoutMs;
  for (let k = 0; k < retries; k++) ms += Math.max(500 * 2 ** k, timeoutMs);
  return ms;
}
