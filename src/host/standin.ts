// DELETE ME when stream C's src/interp.ts lands (PLAN.md §7).
//
// A stand-in interpreter with the same interface as src/interp.ts (Interp:
// constructor(program, cfg), step(response), variables()), so the host loop
// and CLI can be built before the real core. It covers only run, do, check,
// section-option ask, then, page, hand off and stop, with no proofs and
// only as much validation as the host tests need.

import type { CoreProgram, Parts, Section, Stmt } from "../contracts.gen.js";
import type { AskRequest, CoreEvent, Next, Outcome, Response, RunConfig, Val, Where } from "../step.js";

type Out = { events: CoreEvent[]; next: Next };
type Target = { stop: Record<string, never> } | { section: string } | { skip: Record<string, never> } | null;

class DeadlineHit {
  constructor(readonly at: Where) {}
}

const SAFE = /^[A-Za-z0-9._/:@%+=,-]+$/;

/** Params and built-ins that reach a command but fail the safe-value check. */
export function unsafeInputs(program: unknown, cfg: RunConfig): string[] {
  const inCmd = new Set<string>();
  JSON.stringify(program, (k, v) => {
    if (k === "cmd" || k === "succeeds") for (const part of v as Parts) if ("var" in part) inCmd.add(part.var);
    return v;
  });
  return Object.entries({ ...cfg.params, ...cfg.builtins })
    .filter(([k, v]) => inCmd.has(k) && !(SAFE.test(String(v)) && !String(v).startsWith("-")))
    .map(([k]) => k);
}

export class Interp {
  private vars = new Map<string, { v: Val; run: boolean }>();
  private g: Generator<Out, Out, Response>;
  private done = false;
  private events: CoreEvent[] = [];
  private askCalls = 0;
  private effects = 0;
  private afterWouldDo = false;

  constructor(
    private p: CoreProgram,
    private cfg: RunConfig,
  ) {
    for (const [k, v] of Object.entries({ ...cfg.params, ...cfg.builtins })) this.vars.set(k, { v, run: false });
    this.g = this.run();
  }

  step(r: Response): Out {
    if (this.done) throw new Error("step after the run is done");
    const out = this.g.next(r).value;
    this.done = out.next.kind === "done";
    return out;
  }

  fork(): Interp {
    throw new Error("the stand-in can't explore: --verify and --explain need the real core");
  }

  key(): string {
    return this.fork() as never;
  }

  variables(): Record<string, Val> {
    return Object.fromEntries([...this.vars].filter(([, b]) => b.run).map(([k, b]) => [k, b.v]));
  }

  private text(parts: Parts, question = false): string {
    return parts
      .map((x) => {
        if ("lit" in x) return x.lit;
        const b = this.vars.get(x.var);
        if (question && b?.run) return `\`${x.var}\``;
        return b ? String(b.v) : "(unavailable)";
      })
      .join("");
  }

  private emit(at: Where | null, e: object) {
    this.events.push({ at, ...e } as CoreEvent);
  }

  private *req(next: Next, at: Where): Generator<Out, Response, Response> {
    const events = this.events;
    this.events = [];
    const r = yield { events, next };
    if (r.kind === "deadline") throw new DeadlineHit(at);
    return r;
  }

  private finish(outcome: Outcome, at: Where): Out {
    this.emit(at, {
      event: "outcome",
      outcome: outcome.kind,
      reason: outcome.kind === "handoff" ? outcome.reason : null,
      ask_calls: this.askCalls,
      effects: this.effects,
      dry_run: this.cfg.dry,
    });
    const events = this.events;
    this.events = [];
    return { events, next: { kind: "done", outcome } };
  }

  private *run(): Generator<Out, Out, Response> {
    // The first step's response (none) is dropped by the generator protocol.
    let id = this.p.entry.section;
    let at: Where = { section: "", line: this.p.entry.src };
    try {
      for (;;) {
        const sec = this.p.sections[id] as Section;
        let to: Target | undefined;
        for (const st of sec.body as Stmt[]) {
          at = { section: sec.name, line: st.src };
          to = yield* this.exec(st, at);
          if (to !== undefined) break;
        }
        if (to === undefined || to === null || "skip" in to) throw new Error(`stand-in: fell off ${sec.name}`);
        if ("stop" in to) return this.finish({ kind: "stopped" }, at);
        if (to.section === "#paged") return this.finish({ kind: "paged" }, at);
        if (to.section === "#handoff") return this.finish({ kind: "handoff", reason: "explicit", detail: null }, at);
        if (to.section.startsWith("#")) {
          const reason = to.section.slice(1) as "gate_failed" | "command_failed" | "ask_unavailable";
          return this.finish({ kind: "handoff", reason, detail: null }, at);
        }
        this.emit(at, { event: "transfer", from: sec.name, to: (this.p.sections[to.section] as Section).name });
        id = to.section;
      }
    } catch (e) {
      if (e instanceof DeadlineHit) return this.finish({ kind: "handoff", reason: "deadline", detail: null }, e.at);
      throw e;
    }
  }

  /** Runs one statement: undefined to carry on, or where to go. */
  private *exec(st: Stmt, at: Where): Generator<Out, Target | undefined, Response> {
    const failed = (els: Target): Target | undefined => (els === null ? { section: "#command_failed" } : "skip" in els ? undefined : els);
    const awd = this.afterWouldDo;
    if ("run" in st) {
      const cmd = this.text(st.run.cmd);
      const r = yield* this.req({ kind: "exec", cmd, exec: "run", timeoutMs: this.p.limits.run_timeout_ms, src: st.src }, at);
      if (r.kind !== "exec") throw new Error("stand-in: expected an exec result");
      this.emit(at, { event: "run", cmd, exit: r.exit, timed_out: r.timedOut, after_would_do: awd });
      if (r.exit !== 0) return failed(st.else as Target);
      if (st.run.as) this.vars.set(st.run.as, { v: r.stdout.trim(), run: true });
      return undefined;
    }
    if ("do" in st) {
      if (!("cmd" in st.do)) throw new Error("stand-in: do item isn't supported");
      const cmd = this.text(st.do.cmd);
      if (this.cfg.dry) {
        this.afterWouldDo = true;
        this.emit(at, { event: "would_do", cmd });
        return undefined;
      }
      this.effects++;
      this.emit(at, { event: "effect_start", cmd });
      const r = yield* this.req({ kind: "exec", cmd, exec: "do", timeoutMs: this.p.limits.do_timeout_ms, src: st.src }, at);
      if (r.kind !== "exec") throw new Error("stand-in: expected an exec result");
      this.emit(at, { event: "effect_end", cmd, exit: r.exit, timed_out: r.timedOut });
      return r.exit === 0 ? undefined : failed(st.else as Target);
    }
    if ("check" in st) {
      const c = st.check;
      let result: boolean;
      if ("succeeds" in c.cond) {
        const cmd = this.text(c.cond.succeeds);
        const r = yield* this.req({ kind: "exec", cmd, exec: "check", timeoutMs: this.p.limits.run_timeout_ms, src: st.src }, at);
        if (r.kind !== "exec") throw new Error("stand-in: expected an exec result");
        this.emit(at, { event: "check_cmd", cmd, exit: r.exit, timed_out: r.timedOut, after_would_do: awd });
        if (r.timedOut) return failed(c.else as Target);
        result = r.exit === 0;
      } else {
        const { op, l, r } = c.cond.cmp;
        const val = (o: typeof l) =>
          "num" in o
            ? o.num
            : String(this.vars.get(o.var)?.v ?? "")
                .replace(/%$/, "")
                .trim();
        const [a, b] = [Number(val(l)), Number(val(r))];
        const show = (o: typeof l) => ("num" in o ? o.num : `{${o.var}}`);
        const ok = Number.isFinite(a) && Number.isFinite(b);
        const cmp = { "<": a < b, "<=": a <= b, ">": a > b, ">=": a >= b, "==": a === b, "!=": a !== b }[op];
        this.emit(at, {
          event: "check",
          expr: `${show(l)} ${op} ${show(r)}`,
          left: ok ? val(l) : null,
          right: ok ? val(r) : null,
          result: ok ? cmp : null,
          after_would_do: awd,
        });
        if (!ok) return failed(c.else as Target);
        result = cmp;
      }
      if (result) return c.then ? (c.then as Target) : undefined;
      return c.else === null || "skip" in c.else ? undefined : (c.else as Target);
    }
    if ("ask" in st) {
      const a = st.ask as { question: Parts; sure: number; else: Target; sections?: { section: string }[] };
      if (!a.sections) throw new Error("stand-in: only section-option asks are supported");
      const sec = (id: string) => this.p.sections[id] as Section;
      const request = {
        kind: "choice" as const,
        question: this.text(a.question, true),
        guidance: sec(this.idOf(at.section)).guidance ?? null,
        options: a.sections.map((o) => ({ id: o.section, label: sec(o.section).name, description: sec(o.section).guidance ?? null })),
        context: Object.fromEntries(
          a.question.flatMap((x) => ("var" in x && this.vars.get(x.var)?.run ? [[x.var, String(this.vars.get(x.var)?.v)]] : [])),
        ),
        timeout_ms: 0,
      };
      this.askCalls++;
      const r = yield* this.req({ kind: "ask", request: request as AskRequest, src: st.src }, at);
      const base = { event: "ask", question: request.question, kind: "choice", sure: a.sure, after_would_do: awd };
      const ids = request.options.map((o) => o.id);
      const valid =
        r.kind === "answer" &&
        Object.keys(r.probs).length === ids.length &&
        ids.every((i) => typeof r.probs[i] === "number") &&
        Math.abs(ids.reduce((s, i) => s + (r.probs[i] as number), r.unassigned) - 1) <= 1e-3;
      if (r.kind !== "answer" || !valid) {
        this.emit(at, { ...base, probs: null, chosen: null, confidence: null, passed: false, detail: "unavailable" });
        return { section: "#ask_unavailable" };
      }
      const sorted = [...ids].sort((x, y) => (r.probs[y] as number) - (r.probs[x] as number));
      const top = sorted[0] as string;
      const conf = r.probs[top] as number;
      const passed = conf * 100 >= a.sure && sorted.slice(1).every((i) => (r.probs[i] as number) + r.unassigned < conf);
      this.emit(at, { ...base, probs: r.probs, chosen: top, confidence: conf, passed });
      if (passed) return { section: top };
      return a.else === null ? { section: "#gate_failed" } : a.else;
    }
    if ("then" in st) return st.then as Target;
    if ("page" in st) {
      const text = this.text(st.page);
      if (this.cfg.dry) {
        this.emit(at, { event: "would_page", text });
      } else {
        const r = yield* this.req({ kind: "page", text, src: st.src }, at);
        this.emit(at, { event: "page", text, ok: r.kind === "page" && r.ok });
      }
      return { section: "#paged" };
    }
    if ("hand_off" in st) return { section: "#handoff" };
    if ("stop" in st) return { stop: {} };
    throw new Error(`stand-in: unsupported statement at line ${st.src}`);
  }

  private idOf(name: string): string {
    return Object.keys(this.p.sections).find((k) => (this.p.sections[k] as Section).name === name) as string;
  }
}
