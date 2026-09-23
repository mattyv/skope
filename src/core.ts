// The one place that touches Dafny's generated JavaScript (SPEC §5.5).
// It converts core program JSON into Dafny values, and Dafny's results
// (big integers, Dafny strings and sequences) back into plain JS.
//
// Compiled Dafny doesn't check preconditions or types at run time, so this
// file checks them: anything it can't represent exactly is an error, never
// a silent rewrite.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Dafny's output has no types, so it's `any` here and nowhere else.
const gen: any = require("../core/generated/core.cjs");
const BigNumber: any = require("bignumber.js");
const { _dafny, SkopSyntax, SkopLint, SkopInterp } = gen;

// A section of core program JSON (contracts/core-program.schema.json).
// The Phase 0 spike supports run, do and stop with literal commands.
export type Section = { name: string; src: number; guidance: string | null; body: unknown[] };

export type Kind = "run" | "do";
export type LintError = { code: string; src: number };
export type Outcome = { outcome: "stopped" } | { outcome: "handoff"; reason: string };
export type CoreEvent =
  | { event: "run"; src: number; cmd: string; exit: number; after_would_do: boolean }
  | { event: "effect_start"; src: number; cmd: string }
  | { event: "effect_end"; src: number; cmd: string; exit: number }
  | { event: "would_do"; src: number; cmd: string }
  | ({ event: "outcome" } & Outcome);
export type Next = { exec: { kind: Kind; cmd: string; src: number } } | { done: Outcome };

export class Unsupported extends Error {}

const str = (s: string) => _dafny.Seq.UnicodeFromString(s);
const unstr = (s: { toVerbatimString(literal: boolean): string }) => s.toVerbatimString(false);
const num = (n: { toNumber(): number }) => n.toNumber();

function nat(n: unknown, what: string) {
  if (!Number.isSafeInteger(n) || (n as number) < 0)
    throw new Unsupported(`${what} must be a non-negative integer, got ${JSON.stringify(n)}`);
  return new BigNumber(n);
}

function parts(cmd: unknown, src: number) {
  if (!Array.isArray(cmd)) throw new Unsupported(`line ${src}: cmd must be a list of parts`);
  return _dafny.Seq.of(
    ...cmd.map((p) => {
      if (typeof p !== "object" || p === null || Object.keys(p).length !== 1 || typeof (p as any).lit !== "string") {
        throw new Unsupported(`line ${src}: only literal command parts are supported in the Phase 0 spike, got ${JSON.stringify(p)}`);
      }
      return SkopSyntax.Part.create_Lit(str((p as any).lit));
    }),
  );
}

function stmt(s: any) {
  const src = nat(s?.src, "src");
  const keys = Object.keys(s)
    .filter((k) => k !== "src")
    .sort()
    .join(",");
  const where = `line ${s.src}`;
  const noElse = () => {
    if (s.else !== null) throw new Unsupported(`${where}: else isn't supported in the Phase 0 spike`);
  };
  if (keys === "else,run") {
    noElse();
    if (Object.keys(s.run).join() !== "cmd") throw new Unsupported(`${where}: run only supports cmd in the Phase 0 spike`);
    return SkopSyntax.Stmt.create_Run(src, parts(s.run.cmd, s.src));
  }
  if (keys === "do,else") {
    noElse();
    if (Object.keys(s.do).join() !== "cmd") throw new Unsupported(`${where}: do only supports cmd in the Phase 0 spike`);
    return SkopSyntax.Stmt.create_Do(src, parts(s.do.cmd, s.src));
  }
  if (keys === "stop") return SkopSyntax.Stmt.create_Stop(src);
  throw new Unsupported(`${where}: unsupported statement ${JSON.stringify(s)}`);
}

function toDafny(section: Section) {
  if (!Array.isArray(section?.body)) throw new Unsupported("section body must be a list");
  return SkopSyntax.Program.create_Program(nat(section.src, "section src"), _dafny.Seq.of(...section.body.map(stmt)));
}

function outcome(o: any): Outcome {
  return o.is_Stopped ? { outcome: "stopped" } : { outcome: "handoff", reason: unstr(o.dtor_reason) };
}

function event(e: any): CoreEvent {
  const src = e.is_Finished ? 0 : num(e.dtor_src);
  if (e.is_RunDone) return { event: "run", src, cmd: unstr(e.dtor_cmd), exit: num(e.dtor_exit), after_would_do: e.dtor_afterWouldDo };
  if (e.is_EffectStart) return { event: "effect_start", src, cmd: unstr(e.dtor_cmd) };
  if (e.is_EffectEnd) return { event: "effect_end", src, cmd: unstr(e.dtor_cmd), exit: num(e.dtor_exit) };
  if (e.is_WouldDo) return { event: "would_do", src, cmd: unstr(e.dtor_cmd) };
  return { event: "outcome", ...outcome(e.dtor_outcome) };
}

export function lint(section: Section): LintError[] {
  return [...SkopLint.__default.Lint(toDafny(section))].map((e: any) => ({ code: unstr(e.dtor_code), src: num(e.dtor_src) }));
}

// One run. It enforces Step's preconditions: a command's result must be
// passed back after an exec, nothing may be passed otherwise, and there's
// no step after the run is done.
export class Run {
  private state: any;
  private waiting = false;
  private done = false;

  constructor(section: Section, opts: { dry: boolean }) {
    const p = toDafny(section);
    const errors = [...SkopLint.__default.Lint(p)];
    if (errors.length > 0) {
      throw new Unsupported(`program fails lint: ${errors.map((e: any) => `${unstr(e.dtor_code)} at line ${num(e.dtor_src)}`).join(", ")}`);
    }
    this.state = SkopInterp.__default.Start(p, opts.dry);
  }

  step(r: { exit: number } | null): { events: CoreEvent[]; next: Next } {
    if (this.done) throw new Error("step after the run is done");
    if (this.waiting !== (r !== null))
      throw new Error(this.waiting ? "step needs the command's result" : "step got a result nothing asked for");
    const resp = r === null ? SkopInterp.Response.create_NoResponse() : SkopInterp.Response.create_ExecResult(int(r.exit));
    const res = SkopInterp.__default.Step(this.state, resp);
    this.state = res[0];
    const n = res[2];
    this.waiting = n.is_Exec;
    this.done = n.is_Done;
    const next: Next = n.is_Exec
      ? { exec: { kind: n.dtor_kind.is_RunKind ? "run" : "do", cmd: unstr(n.dtor_cmd), src: num(n.dtor_src) } }
      : { done: outcome(n.dtor_outcome) };
    return { events: [...res[1]].map(event), next };
  }
}

function int(n: unknown) {
  if (!Number.isSafeInteger(n)) throw new Error(`exit must be an integer, got ${JSON.stringify(n)}`);
  return new BigNumber(n);
}
