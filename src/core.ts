// The one place that touches Dafny's generated JavaScript (SPEC §5.5).
// It converts core program JSON into Dafny values, and Dafny's results
// (big integers, Dafny strings and sequences) back into plain JS.
//
// Compiled Dafny checks nothing at run time: not preconditions, not nat,
// int, bool or char. So this file checks them: anything it can't represent
// exactly is an error, never a silent rewrite.

import { createRequire } from "node:module";
// A section of core program JSON (contracts/core-program.schema.json). The
// Phase 0 spike supports run, do and stop with literal commands; the input
// is untrusted JSON, so everything is still checked at run time.
import type { Section } from "./contracts.gen.js";

export type { Section };

const require = createRequire(import.meta.url);
// Dafny's output has no types, so it's `any` here and nowhere else.
const gen: any = require("../core/generated/core.cjs");
const BigNumber: any = require("bignumber.js");
const { _dafny, SkopSyntax, SkopLint, SkopInterp } = gen;

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

// Dafny's char excludes lone surrogates.
function str(s: string) {
  if (!s.isWellFormed()) throw new Unsupported(`text isn't well-formed Unicode: ${JSON.stringify(s)}`);
  return _dafny.Seq.UnicodeFromString(s);
}
const unstr = (s: { toVerbatimString(literal: boolean): string }) => s.toVerbatimString(false);
const num = (n: { toNumber(): number }) => n.toNumber();

// Dafny's int, and nat when min is 0.
function big(n: unknown, what: string, min = Number.NEGATIVE_INFINITY) {
  if (!Number.isSafeInteger(n) || (n as number) < min) {
    throw new Unsupported(`${what} must be an integer${min === 0 ? " ≥ 0" : ""}, got ${JSON.stringify(n)}`);
  }
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

const isObject = (b: unknown): b is Record<string, unknown> => typeof b === "object" && b !== null && !Array.isArray(b);
const onlyCmd = (b: unknown) => isObject(b) && Object.keys(b).join() === "cmd";

function stmt(s: unknown) {
  if (!isObject(s)) throw new Unsupported(`a statement must be an object, got ${JSON.stringify(s)}`);
  const src = big(s.src, "src", 0);
  const where = `line ${s.src}`;
  const keys = Object.keys(s)
    .filter((k) => k !== "src")
    .sort()
    .join(",");
  const noElse = () => {
    if (s.else !== null) throw new Unsupported(`${where}: else isn't supported in the Phase 0 spike`);
  };
  if (keys === "else,run") {
    noElse();
    if (!onlyCmd(s.run)) throw new Unsupported(`${where}: run only supports cmd in the Phase 0 spike`);
    return SkopSyntax.Stmt.create_Run(src, parts((s.run as any).cmd, s.src as number));
  }
  if (keys === "do,else") {
    noElse();
    if (!onlyCmd(s.do)) throw new Unsupported(`${where}: do only supports cmd in the Phase 0 spike`);
    return SkopSyntax.Stmt.create_Do(src, parts((s.do as any).cmd, s.src as number));
  }
  if (keys === "stop") {
    if (!isObject(s.stop) || Object.keys(s.stop).length > 0) throw new Unsupported(`${where}: stop takes no fields`);
    return SkopSyntax.Stmt.create_Stop(src);
  }
  throw new Unsupported(`${where}: unsupported statement ${JSON.stringify(s)}`);
}

function toDafny(section: Section) {
  const body: unknown = (section as unknown as { body?: unknown })?.body;
  if (!Array.isArray(body)) throw new Unsupported("section body must be a list");
  return SkopSyntax.Program.create_Program(big(section.src, "section src", 0), _dafny.Seq.of(...body.map(stmt)));
}

// Each Dafny case is mapped explicitly. Anything else is a bug, never a
// silent mislabel, so adding a case to the core forces a change here.
function outcome(o: any): Outcome {
  if (o.is_Stopped) return { outcome: "stopped" };
  if (o.is_Handoff) return { outcome: "handoff", reason: unstr(o.dtor_reason) };
  throw new Error(`unknown outcome from the core: ${o}`);
}

function kind(k: any): Kind {
  if (k.is_RunKind) return "run";
  if (k.is_DoKind) return "do";
  throw new Error(`unknown kind from the core: ${k}`);
}

function event(e: any): CoreEvent {
  if (e.is_RunDone) {
    return { event: "run", src: num(e.dtor_src), cmd: unstr(e.dtor_cmd), exit: num(e.dtor_exit), after_would_do: e.dtor_afterWouldDo };
  }
  if (e.is_EffectStart) return { event: "effect_start", src: num(e.dtor_src), cmd: unstr(e.dtor_cmd) };
  if (e.is_EffectEnd) return { event: "effect_end", src: num(e.dtor_src), cmd: unstr(e.dtor_cmd), exit: num(e.dtor_exit) };
  if (e.is_WouldDo) return { event: "would_do", src: num(e.dtor_src), cmd: unstr(e.dtor_cmd) };
  if (e.is_Finished) return { event: "outcome", ...outcome(e.dtor_outcome) };
  throw new Error(`unknown event from the core: ${e}`);
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
    // A dry-run flag that isn't a real boolean must not reach Dafny's bool:
    // `undefined` would run the effect (P3).
    if (typeof opts?.dry !== "boolean") throw new Unsupported(`dry must be true or false, got ${JSON.stringify(opts?.dry)}`);
    const errors = lint(section);
    if (errors.length > 0) throw new Unsupported(`program fails lint: ${errors.map((e) => `${e.code} at line ${e.src}`).join(", ")}`);
    this.state = SkopInterp.__default.Start(toDafny(section), opts.dry);
  }

  step(r: { exit: number } | null): { events: CoreEvent[]; next: Next } {
    if (this.done) throw new Error("step after the run is done");
    if (this.waiting !== (r !== null))
      throw new Error(this.waiting ? "step needs the command's result" : "step got a result nothing asked for");
    const resp = r === null ? SkopInterp.Response.create_NoResponse() : SkopInterp.Response.create_ExecResult(big(r.exit, "exit"));
    const res = SkopInterp.__default.Step(this.state, resp);
    this.state = res[0];
    const n = res[2];
    this.waiting = n.is_Exec;
    this.done = n.is_Done;
    const next: Next = n.is_Exec
      ? { exec: { kind: kind(n.dtor_kind), cmd: unstr(n.dtor_cmd), src: num(n.dtor_src) } }
      : { done: outcome(n.dtor_outcome) };
    return { events: [...res[1]].map(event), next };
  }
}
