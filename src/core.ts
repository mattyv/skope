// The one place that touches Dafny's generated JavaScript (SPEC §5.5).
// It converts core program JSON into Dafny values, and Dafny's results
// (big integers, Dafny strings and sequences) back into plain JS.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Dafny's output has no types, so it's `any` here and nowhere else.
const gen: any = require("../core/generated/core.cjs");
const BigNumber: any = require("bignumber.js");
const { _dafny, SkopSyntax, SkopLint, SkopInterp } = gen;

// Core program JSON (SPEC §5.1). Phase 0 spike subset: run, do, stop,
// with commands made of literal parts only.
export type Part = { lit: string };
export type Stmt =
  | { src: number; run: { cmd: Part[] } }
  | { src: number; do: { cmd: Part[] } }
  | { src: number; stop: Record<string, never> };
export type Program = { body: Stmt[] };

export type Kind = "run" | "do";
export type LintError = { code: string; src: number };
export type Outcome = { outcome: "stopped" } | { outcome: "handoff"; reason: string };
export type CoreEvent =
  | { event: "would_do"; src: number; cmd: string }
  | { event: "effect_start"; src: number; cmd: string }
  | { event: "ran"; src: number; kind: Kind; cmd: string; exit: number }
  | ({ event: "outcome" } & Outcome);
export type Next = { exec: { kind: Kind; cmd: string; src: number } } | { done: Outcome };
export type Response = { exit: number } | null;

const str = (s: string) => _dafny.Seq.UnicodeFromString(s);
const unstr = (s: { toVerbatimString(literal: boolean): string }) => s.toVerbatimString(false);
const num = (n: { toNumber(): number }) => n.toNumber();

function cmd(parts: Part[]): string {
  return parts.map((p) => p.lit).join("");
}

function toDafny(p: Program) {
  const body = p.body.map((s) => {
    const src = new BigNumber(s.src);
    if ("run" in s) return SkopSyntax.Stmt.create_Run(src, str(cmd(s.run.cmd)));
    if ("do" in s) return SkopSyntax.Stmt.create_Do(src, str(cmd(s.do.cmd)));
    return SkopSyntax.Stmt.create_Stop(src);
  });
  return SkopSyntax.Program.create_Program(_dafny.Seq.of(...body));
}

function outcome(o: any): Outcome {
  return o.is_Stopped ? { outcome: "stopped" } : { outcome: "handoff", reason: unstr(o.dtor_reason) };
}

function kind(k: any): Kind {
  return k.is_RunKind ? "run" : "do";
}

function event(e: any): CoreEvent {
  if (e.is_WouldDo) return { event: "would_do", src: num(e.dtor_src), cmd: unstr(e.dtor_cmd) };
  if (e.is_EffectStart) return { event: "effect_start", src: num(e.dtor_src), cmd: unstr(e.dtor_cmd) };
  if (e.is_Ran) return { event: "ran", src: num(e.dtor_src), kind: kind(e.dtor_kind), cmd: unstr(e.dtor_cmd), exit: num(e.dtor_exit) };
  return { event: "outcome", ...outcome(e.dtor_outcome) };
}

export function lint(p: Program): LintError[] {
  return [...SkopLint.__default.Lint(toDafny(p))].map((e) => ({ code: unstr(e.dtor_code), src: num(e.dtor_src) }));
}

export class Run {
  private state: any;

  // Dafny's Start requires a clean lint, so check it here first: calling
  // compiled Dafny outside its precondition is undefined behaviour.
  constructor(p: Program, opts: { dry: boolean }) {
    const errors = lint(p);
    if (errors.length > 0) throw new Error(`program fails lint: ${errors.map((e) => `${e.code} at ${e.src}`).join(", ")}`);
    this.state = SkopInterp.__default.Start(toDafny(p), opts.dry);
  }

  step(r: Response): { events: CoreEvent[]; next: Next } {
    const resp = r === null ? SkopInterp.Response.create_NoResponse() : SkopInterp.Response.create_ExecResult(new BigNumber(r.exit));
    const res = SkopInterp.__default.Step(this.state, resp);
    this.state = res[0];
    const n = res[2];
    const next: Next = n.is_Exec
      ? { exec: { kind: kind(n.dtor_kind), cmd: unstr(n.dtor_cmd), src: num(n.dtor_src) } }
      : { done: outcome(n.dtor_outcome) };
    return { events: [...res[1]].map(event), next };
  }
}
