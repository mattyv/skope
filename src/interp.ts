// Drives the proven interpreter (core/Run.dfy): Start, then Step with each
// response, converting to and from the plain types in src/step.ts.
//
// Compiled Dafny checks nothing at run time, so this file enforces what
// Start and Step require: the program lints clean (so it's WellFormed,
// SkopeCheck.LintSound), params and built-ins pass the core's input rules,
// each response answers the last request, and nothing steps after Done. It
// refuses anything it can't hand to the core exactly.

import { toAst } from "./ast.js";
import { _dafny, BigNumber, gen, Unsupported } from "./core.js";
import { ANSWERS, type CoreEvent, type Next, type Outcome, REASONS, type Response, type RunConfig, type Val } from "./step.js";

const { SkopeAst, SkopeStep, SkopeState, SkopeRun, SkopeValues, SkopeWellFormed, SkopeCheck } = gen;
type D = any;

const str = (s: unknown, what: string): D => {
  if (typeof s !== "string" || !s.isWellFormed()) throw new Unsupported(`${what} must be well-formed text, got ${JSON.stringify(s)}`);
  return _dafny.Seq.UnicodeFromString(s);
};
const unstr = (d: D): string => d.toVerbatimString(false);
const int = (n: unknown, what: string, min = Number.NEGATIVE_INFINITY): D => {
  if (!Number.isSafeInteger(n) || (n as number) < min)
    throw new Unsupported(`${what} must be an integer ≥ ${min}, got ${JSON.stringify(n)}`);
  return new BigNumber(n as number);
};
const bool = (b: unknown, what: string): boolean => {
  if (typeof b !== "boolean") throw new Unsupported(`${what} must be true or false, got ${JSON.stringify(b)}`);
  return b;
};
const some = (v: D) => SkopeAst.Option.create_Some(v);
const none = () => SkopeAst.Option.create_None();
const opt = <T>(d: D, f: (x: D) => T): T | null => (d.is_Some ? f(d.dtor_value) : null);

// A finite JS number as the exact rational of its decimal form.
function real(x: number): D {
  const [n, d] = new BigNumber(x).toFraction();
  return new _dafny.BigRational(n, d);
}
const unreal = (r: D): number => r.num.dividedBy(r.den).toNumber();

function val(v: unknown, what: string): D {
  if (typeof v === "string") return SkopeStep.Val.create_Str(str(v, what));
  return SkopeStep.Val.create_Int(int(v, what));
}
const unval = (d: D): Val => (d.is_Str ? unstr(d.dtor_s) : d.dtor_i.toNumber());

function valMap(r: Record<string, Val>, what: string): D {
  let m = _dafny.Map.Empty;
  for (const [k, v] of Object.entries(r ?? {})) m = m.update(str(k, what), val(v, `${what}.${k}`));
  return m;
}

function runConfig(cfg: RunConfig): D {
  if (cfg.mode !== "concrete" && cfg.mode !== "explore")
    throw new Unsupported(`mode must be concrete or explore, got ${JSON.stringify(cfg.mode)}`);
  // A dry-run flag that isn't a real boolean must not reach Dafny: `undefined` would run effects (P3).
  return SkopeStep.RunConfig.create_RunConfig(
    valMap(cfg.params, "params"),
    valMap(cfg.builtins, "builtins"),
    bool(cfg.dry, "dry"),
    cfg.mode === "concrete" ? SkopeStep.Mode.create_Concrete() : SkopeStep.Mode.create_Explore(),
  );
}

/** Params and built-ins that reach a command but fail the safe-value check (the host reports E-PARAM-UNSAFE). */
export function unsafeInputs(program: unknown, cfg: RunConfig): string[] {
  const p = toAst(program);
  const cmd = SkopeState.__default.CmdNames(p);
  const bad = (r: Record<string, Val>) =>
    Object.entries(r ?? {})
      .filter(([k, v]) => cmd.contains(str(k, "name")) && !SkopeWellFormed.__default.SafeValue(SkopeValues.__default.Show(val(v, k))))
      .map(([k]) => k);
  return [...bad(cfg.params), ...bad(cfg.builtins)];
}

function response(r: Response): D {
  const R = SkopeStep.Response;
  switch (r.kind) {
    case "none":
      return R.create_NoResponse();
    case "exec":
      return R.create_ExecResult(
        r.exit === null ? none() : some(int(r.exit, "exit")),
        str(r.stdout, "stdout"),
        str(r.stderrTail, "stderrTail"),
        bool(r.timedOut, "timedOut"),
      );
    case "answer": {
      const nums = [...Object.values(r.probs), r.unassigned];
      // A non-finite probability has no exact value, and the core would
      // reject the answer as invalid anyway (SPEC §6.1): same outcome.
      if (!nums.every((x) => typeof x === "number" && Number.isFinite(x))) {
        return R.create_AskFailed(SkopeStep.AskFailure.create_Unavailable(), str(r.backend, "backend"));
      }
      let m = _dafny.Map.Empty;
      for (const [k, x] of Object.entries(r.probs)) m = m.update(str(k, "option id"), real(x));
      return R.create_AskAnswer(m, real(r.unassigned), str(r.backend, "backend"), str(r.model, "model"), int(r.ms, "ms", 0));
    }
    case "ask_failed": {
      const F = SkopeStep.AskFailure;
      if (r.error !== "unavailable" && r.error !== "request_too_large")
        throw new Unsupported(`unknown ask failure ${JSON.stringify(r.error)}`);
      return R.create_AskFailed(r.error === "unavailable" ? F.create_Unavailable() : F.create_RequestTooLarge(), str(r.backend, "backend"));
    }
    case "page":
      return R.create_PageResult(bool(r.ok, "ok"));
    case "picked":
      return R.create_Picked(int(r.i, "picked", 0));
    case "deadline":
      return R.create_DeadlineExceeded();
  }
  throw new Unsupported(`unknown response ${JSON.stringify(r)}`);
}

// Each Dafny case is mapped explicitly; anything else is a bug, never a silent mislabel.
function oneOf<T extends string>(d: D, names: readonly T[], ctors: string[]): T {
  const i = ctors.findIndex((c) => d[`is_${c}`]);
  if (i < 0) throw new Error(`unknown value from the core: ${d}`);
  return names[i] as T;
}
const reason = (d: D) => oneOf(d, REASONS, ["Explicit", "GateFailed", "CommandFailed", "AskUnavailable", "Deadline"]);
const askKind = (d: D) => oneOf(d, ["choice", "yesno", "score"] as const, ["Choice", "YesNoKind", "ScoreKind"]);
const failure = (d: D) => oneOf(d, ["unavailable", "request_too_large"] as const, ["Unavailable", "RequestTooLarge"]);

function outcome(d: D): Outcome {
  if (d.is_Stopped) return { kind: "stopped" };
  if (d.is_Paged) return { kind: "paged" };
  if (d.is_Handoff) return { kind: "handoff", reason: reason(d.dtor_reason), detail: opt(d.dtor_detail, unstr) };
  throw new Error(`unknown outcome from the core: ${d}`);
}

function toNext(d: D): Next {
  if (d.is_Exec) {
    const exec = oneOf(d.dtor_kind, ["run", "do", "check"] as const, ["RunExec", "DoExec", "CheckExec"]);
    return { kind: "exec", cmd: unstr(d.dtor_cmd), exec, timeoutMs: d.dtor_timeoutMs.toNumber(), src: d.dtor_src.toNumber() };
  }
  if (d.is_AskNext) {
    const q = d.dtor_request;
    const context: Record<string, string> = {};
    for (const k of q.dtor_context.Keys.Elements) context[unstr(k)] = unstr(q.dtor_context.get(k));
    const request = {
      kind: askKind(q.dtor_kind),
      question: unstr(q.dtor_question),
      guidance: opt(q.dtor_guidance, unstr),
      options: [...q.dtor_options].map((o: D) => ({
        id: unstr(o.dtor_id),
        label: unstr(o.dtor_text),
        description: opt(o.dtor_description, unstr),
      })),
      context,
      // ask.timeout_ms is config the core doesn't see; the host sets it.
      timeout_ms: q.dtor_timeoutMs.toNumber(),
    };
    return { kind: "ask", request: request as Extract<Next, { kind: "ask" }>["request"], src: d.dtor_src.toNumber() };
  }
  if (d.is_PageNext) return { kind: "page", text: unstr(d.dtor_text), src: d.dtor_src.toNumber() };
  if (d.is_Choose) return { kind: "choose", n: d.dtor_n.toNumber() };
  if (d.is_Done) return { kind: "done", outcome: outcome(d.dtor_outcome) };
  throw new Error(`unknown request from the core: ${d}`);
}

function body(b: D): Record<string, unknown> {
  const exit = (e: D) => opt(e, (x) => x.toNumber());
  if (b.is_RunEv || b.is_CheckCmdEv) {
    return {
      event: b.is_RunEv ? "run" : "check_cmd",
      cmd: unstr(b.dtor_cmd),
      exit: exit(b.dtor_exit),
      timed_out: b.dtor_timedOut,
      after_would_do: b.dtor_afterWouldDo,
    };
  }
  if (b.is_CheckEv) {
    return {
      event: "check",
      expr: unstr(b.dtor_expr),
      left: opt(b.dtor_left, unstr),
      right: opt(b.dtor_right, unstr),
      result: opt(b.dtor_result, (x) => x),
      after_would_do: b.dtor_afterWouldDo,
    };
  }
  if (b.is_AskEv) {
    const probs = opt(b.dtor_probs, (m) => {
      const r: Record<string, number> = {};
      for (const k of m.Keys.Elements) r[unstr(k)] = unreal(m.get(k));
      return r;
    });
    const range = opt(b.dtor_range, (t) => [t[0].toNumber(), t[1].toNumber()] as [number, number]);
    const detail = opt(b.dtor_detail, failure);
    return {
      event: "ask",
      question: unstr(b.dtor_question),
      kind: askKind(b.dtor_kind),
      probs,
      chosen: opt(b.dtor_chosen, (c) => (c.is_ChosenId ? unstr(c.dtor_id) : c.dtor_level.toNumber())),
      confidence: opt(b.dtor_confidence, unreal),
      sure: b.dtor_sure.toNumber(),
      passed: b.dtor_passed,
      ...(range ? { range } : {}),
      ...(detail ? { detail } : {}),
      after_would_do: b.dtor_afterWouldDo,
    };
  }
  if (b.is_EffectStartEv) return { event: "effect_start", cmd: unstr(b.dtor_cmd) };
  if (b.is_EffectEndEv) return { event: "effect_end", cmd: unstr(b.dtor_cmd), exit: exit(b.dtor_exit), timed_out: b.dtor_timedOut };
  if (b.is_WouldDoEv) return { event: "would_do", cmd: unstr(b.dtor_cmd) };
  if (b.is_PageEv) return { event: "page", text: unstr(b.dtor_text), ok: b.dtor_ok };
  if (b.is_WouldPageEv) return { event: "would_page", text: unstr(b.dtor_text) };
  if (b.is_TransferEv) return { event: "transfer", from: unstr(b.dtor_from), to: unstr(b.dtor_to) };
  if (b.is_OutcomeEv) {
    const o = outcome(b.dtor_outcome);
    return {
      event: "outcome",
      outcome: o.kind,
      reason: o.kind === "handoff" ? o.reason : null,
      ask_calls: b.dtor_askCalls.toNumber(),
      effects: b.dtor_effects.toNumber(),
      dry_run: b.dtor_dry,
    };
  }
  throw new Error(`unknown event from the core: ${b}`);
}

function event(e: D): CoreEvent {
  const at = opt(e.dtor_at, (w) => ({ section: unstr(w.dtor_section), line: w.dtor_line.toNumber() }));
  return { at, ...body(e.dtor_body) } as CoreEvent;
}

/** One run of a program: Start, then step(response) until the next request is `done`. */
export class Interp {
  private state: D;
  private last: Next | null = null; // null before the first step

  constructor(program: unknown, cfg: RunConfig) {
    const p = toAst(program);
    const c = runConfig(cfg);
    const errors = [...SkopeCheck.__default.Lint(p)].map((e: D) => `${unstr(e.dtor_code)} at line ${e.dtor_src.toNumber()}`);
    if (errors.length > 0) throw new Unsupported(`the program doesn't lint clean: ${errors.join(", ")}`);
    if (!SkopeState.__default.InputsOk(p, c)) {
      const bad = unsafeInputs(program, cfg);
      throw new Unsupported(
        bad.length > 0
          ? `these reach a command and fail the safe-value check: ${bad.join(", ")}`
          : "params must be exactly the program's, and built-ins exactly host, run_id and skill",
      );
    }
    this.state = SkopeRun.__default.Start(p, c);
  }

  step(r: Response): { events: CoreEvent[]; next: Next } {
    const last = this.last;
    if (last?.kind === "done") throw new Error("step after the run is done");
    if (r.kind !== "deadline") {
      const ok = last === null ? r.kind === "none" : ANSWERS[last.kind].includes(r.kind);
      if (!ok) throw new Error(`a ${r.kind} response doesn't answer ${last === null ? "the start" : `a ${last.kind} request`}`);
      if (r.kind === "picked" && last?.kind === "choose" && !(Number.isSafeInteger(r.i) && r.i >= 0 && r.i < last.n)) {
        throw new Error(`picked ${r.i} is out of range for choose(${last.n})`);
      }
    }
    const res = SkopeRun.__default.Step(this.state, response(r));
    this.state = res[0];
    this.last = toNext(res[2]);
    return { events: [...res[1]].map(event), next: this.last };
  }

  /**
   * The handoff record's `variables` (SPEC §8.1): what the run bound, by run,
   * ask or for each, with its current value. Params and built-ins are left
   * out unless the run rebound the name.
   */
  variables(): Record<string, Val> {
    const out: Record<string, Val> = {};
    const vars = this.state.dtor_vars;
    for (const k of vars.Keys.Elements) {
      const b = vars.get(k).dtor_b;
      if (!b.dtor_origin.is_FromParam && !b.dtor_origin.is_FromBuiltin) out[unstr(k)] = unval(b.dtor_value);
    }
    return out;
  }

  /** An independent copy of the run, for the explore handler. Core states are immutable, so they're shared. */
  fork(): Interp {
    const copy: Interp = Object.create(Interp.prototype);
    copy.state = this.state;
    copy.last = this.last;
    return copy;
  }

  /**
   * The run's abstract state as a canonical string, for memoising explore
   * (SPEC §5.4): section, remaining work (position and loop iterations),
   * bound names with their values and origins, whether a request is
   * pending and of what kind, and after_would_do. The log and the counts
   * are left out. A pending request is determined by the rest.
   */
  key(): string {
    const s = this.state;
    const vars = [...s.dtor_vars.Keys.Elements]
      .map((k: D): [string, string] => [unstr(k), `${s.dtor_vars.get(k)}`])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return JSON.stringify([unstr(s.dtor_sec), `${s.dtor_tasks}`, vars, this.last?.kind ?? null, s.dtor_afterWouldDo]);
  }
}
