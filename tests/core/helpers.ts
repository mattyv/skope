// Hand-written core programs (contracts/core-program.schema.json) and a
// scripted host for step-by-step traces through src/interp.ts.

import { Interp } from "../../src/interp.js";
import type { CoreEvent, Next, Response, RunConfig } from "../../src/step.js";

type J = Record<string, unknown>;
export const lit = (lit: string) => ({ lit });
export const v = (name: string) => ({ var: name });
export const cmd = (s: string) => [lit(s)];
export const skip = { skip: {} };
export const to = (section: string) => ({ section });

export const run = (src: number, c: unknown[], as?: string, els: unknown = null) => ({
  src,
  run: as ? { cmd: c, as } : { cmd: c },
  else: els,
});
export const doCmd = (src: number, c: unknown[], els: unknown = null) => ({ src, do: { cmd: c }, else: els });
export const doItem = (src: number, item: string, els: unknown = null) => ({ src, do: { item }, else: els });
export const checkCmd = (src: number, c: unknown[], then: unknown, els: unknown = null) => ({
  src,
  check: { cond: { succeeds: c }, then, else: els },
});
export const cmp = (src: number, op: string, l: unknown, r: unknown, then: unknown, els: unknown = null) => ({
  src,
  check: { cond: { cmp: { op, l, r } }, then, else: els },
});
export const stop = (src: number) => ({ src, stop: {} });
export const handOff = (src: number) => ({ src, hand_off: {} });
export const thenTo = (src: number, section: string) => ({ src, then: { section } });
export const page = (src: number, text: unknown[]) => ({ src, page: text });
export const askSections = (src: number, q: unknown[], sure: number, options: string[], els: unknown = null) => ({
  src,
  ask: { question: q, sure, else: els, sections: options.map((section, i) => ({ src: src + 1 + i, section })) },
});
export const askYesNo = (src: number, q: unknown[], sure: number, as = "_yn", els: unknown = null) => ({
  src,
  ask: { question: q, sure, else: els, yesno: { as } },
});
export const askOneOf = (src: number, q: unknown[], sure: number, list: string, as: string, els: unknown = null) => ({
  src,
  ask: { question: q, sure, else: els, one_of: { list: { section: list }, as } },
});
export const forEach = (src: number, name: string, list: string, body: unknown[]) => ({
  src,
  for_each: { var: name, list: { section: list }, body },
});
export const ifYesDo = (src: number, item: string, els: unknown = null) => ({ src, if_yes: { do: { item }, else: els } });
export const ifYesRun = (src: number, c: unknown[], els: unknown = null) => ({ src, if_yes: { run: { cmd: c }, else: els } });

export const section = (name: string, body: unknown[], guidance: string | null = null, src = 1) => ({ name, src, guidance, body });
export const values = (name: string, items: string[]) => ({
  name,
  src: 90,
  lists: [{ src: 91, items: items.map((value, i) => ({ src: 91 + i, value })) }],
});
export const actions = (name: string, items: [string, string][]) => ({
  name,
  src: 80,
  lists: [{ src: 81, items: items.map(([label, c], i) => ({ src: 81 + i, action: { label, cmd: cmd(c) } })) }],
});

/** A program whose entry is the first section. */
export function program(sections: Record<string, J>, params: Record<string, string | number> = {}): J {
  const ps = Object.fromEntries(
    Object.entries(params).map(([k, x], i) => [k, typeof x === "string" ? { str: x, src: 2 + i } : { int: x, src: 2 + i }]),
  );
  return {
    skill: "t",
    format: 1,
    entry: { section: Object.keys(sections)[0], src: 1 },
    params: ps,
    limits: { run_timeout_ms: 30000, do_timeout_ms: 600000, deadline_ms: 900000, ask_context_tokens: 4000 },
    sections,
  };
}

export const BUILTINS = { host: "h1", run_id: "r-1", skill: "t" };
export const config = (params: Record<string, string | number> = {}, dry = false, mode: RunConfig["mode"] = "concrete"): RunConfig => ({
  params,
  builtins: BUILTINS,
  dry,
  mode,
});

export const ok = (stdout = ""): Response => ({ kind: "exec", exit: 0, stdout, stderrTail: "", timedOut: false });
export const fail = (exit = 1): Response => ({ kind: "exec", exit, stdout: "", stderrTail: "boom", timedOut: false });
export const timeout: Response = { kind: "exec", exit: null, stdout: "", stderrTail: "", timedOut: true };
export const answer = (probs: Record<string, number>, unassigned = 0): Response => ({
  kind: "answer",
  probs,
  unassigned,
  backend: "fake",
  model: "m",
  ms: 1,
});

export type Turn = { events: CoreEvent[]; next: Next };

/** Start a run and answer each request with the next scripted response; returns every turn. */
export function drive(prog: J, cfg: RunConfig, responses: Response[]): { turns: Turn[]; interp: Interp } {
  const interp = new Interp(prog, cfg);
  const turns: Turn[] = [interp.step({ kind: "none" })];
  for (const r of responses) turns.push(interp.step(r));
  return { turns, interp };
}

export const nexts = (turns: Turn[]) => turns.map((t) => t.next);
export const events = (turns: Turn[]) => turns.flatMap((t) => t.events);
export const last = (turns: Turn[]) => turns[turns.length - 1]?.next;
/** The request of an ask. */
export function request(n: Next | undefined) {
  if (n?.kind !== "ask") throw new Error(`expected an ask, got ${JSON.stringify(n)}`);
  return n.request;
}
/** Events without `at`, for compact comparisons. */
export const bodies = (turns: Turn[]) => events(turns).map(({ at: _, ...b }) => b);
