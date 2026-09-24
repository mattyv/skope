// Core program JSON (contracts/core-program.schema.json) to Dafny's SkopAst
// values (core/Ast.dfy), and back. Streams B and C build on this; the
// round trip in tests/ast.test.ts proves nothing is dropped or rewritten.
//
// Compiled Dafny checks nothing at run time, so every field is checked
// here: an unknown key, a wrong type or a number Dafny can't hold exactly
// is an Unsupported error, never a silent rewrite.

import type { CoreProgram } from "./contracts.gen.js";
import { _dafny, BigNumber, gen, Unsupported } from "./core.js";

const { SkopAst } = gen;
type J = Record<string, unknown>;
// A Dafny value. The generated code has no types.
type D = any;

const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);

function obj(v: unknown, at: string, required: string[], optional: string[] = []): J {
  if (!isObj(v)) throw new Unsupported(`${at}: expected an object, got ${JSON.stringify(v)}`);
  for (const k of required) if (!(k in v)) throw new Unsupported(`${at}: missing ${k}`);
  for (const k of Object.keys(v)) {
    if (!required.includes(k) && !optional.includes(k)) throw new Unsupported(`${at}: unexpected field ${k}`);
  }
  return v;
}

// The one key of a tagged union such as {"run": …} or {"skip": {}}.
function tag(v: unknown, at: string, allowed: string[], extra: string[] = []): [string, J] {
  if (!isObj(v)) throw new Unsupported(`${at}: expected an object, got ${JSON.stringify(v)}`);
  const keys = Object.keys(v).filter((k) => !extra.includes(k));
  const k = keys[0];
  if (keys.length !== 1 || k === undefined || !allowed.includes(k)) {
    throw new Unsupported(`${at}: expected exactly one of ${allowed.join(", ")}, got ${keys.join(", ") || "none"}`);
  }
  return [k, v];
}

function str(v: unknown, at: string): D {
  if (typeof v !== "string") throw new Unsupported(`${at}: expected text, got ${JSON.stringify(v)}`);
  if (!v.isWellFormed()) throw new Unsupported(`${at}: text isn't well-formed Unicode`);
  return _dafny.Seq.UnicodeFromString(v);
}

function int(v: unknown, at: string, min = Number.NEGATIVE_INFINITY): D {
  if (!Number.isSafeInteger(v) || (v as number) < min)
    throw new Unsupported(`${at}: expected an integer ≥ ${min}, got ${JSON.stringify(v)}`);
  return new BigNumber(v as number);
}
const nat = (v: unknown, at: string) => int(v, at, 0);

// NAME (SPEC §3.4): every variable, binding and param.
function name(v: unknown, at: string): D {
  if (typeof v !== "string" || !/^[a-z_][a-z0-9_]*$/.test(v)) throw new Unsupported(`${at}: not a name: ${JSON.stringify(v)}`);
  return str(v, at);
}

function seq<T>(v: unknown, at: string, f: (x: unknown, at: string) => T): D {
  if (!Array.isArray(v)) throw new Unsupported(`${at}: expected a list`);
  // A loop, not Seq.of(...items): spreading a long list overflows the stack.
  const out = new _dafny.Seq();
  for (const [i, x] of v.entries()) out.push(f(x, `${at}[${i}]`));
  return out;
}

function map(v: unknown, at: string, f: (x: unknown, at: string) => D, key = str): D {
  if (!isObj(v)) throw new Unsupported(`${at}: expected an object`);
  let m = _dafny.Map.Empty;
  for (const [k, x] of Object.entries(v)) m = m.update(key(k, at), f(x, `${at}.${k}`));
  return m;
}

const some = (v: D) => SkopAst.Option.create_Some(v);
const none = () => SkopAst.Option.create_None();

function parts(v: unknown, at: string): D {
  return seq(v, at, (p, at) => {
    const [k, o] = tag(p, at, ["lit", "var"]);
    return k === "lit" ? SkopAst.Part.create_Lit(str(o.lit, at)) : SkopAst.Part.create_Var(name(o.var, at));
  });
}

function anchor(v: unknown, at: string): D {
  const a = obj(v, at, ["given", "expected"]);
  return SkopAst.Anchor.create_Anchor(str(a.given, at), str(a.expected, at));
}

function ref(v: unknown, at: string): D {
  const r = obj(v, at, ["section"], ["anchor"]);
  return SkopAst.SectionRef.create_SectionRef(str(r.section, at), "anchor" in r ? some(anchor(r.anchor, `${at}.anchor`)) : none());
}

function els(v: unknown, at: string): D {
  if (v === null) return SkopAst.Else.create_NoElse();
  if (isObj(v) && "skip" in v) {
    obj(v, at, ["skip"]);
    obj(v.skip, `${at}.skip`, []);
    return SkopAst.Else.create_Skip();
  }
  return SkopAst.Else.create_ElseTo(ref(v, at));
}

function target(v: unknown, at: string): D {
  if (isObj(v) && "stop" in v) {
    obj(v, at, ["stop"]);
    obj(v.stop, `${at}.stop`, []);
    return SkopAst.Target.create_StopTarget();
  }
  return SkopAst.Target.create_To(ref(v, at));
}

function doBody(v: unknown, at: string): D {
  const [k, o] = tag(v, at, ["cmd", "item"]);
  return k === "cmd" ? SkopAst.DoBody.create_DoCmd(parts(o.cmd, `${at}.cmd`)) : SkopAst.DoBody.create_DoItem(name(o.item, at));
}

const OPS: Record<string, string> = { "<": "Lt", "<=": "Le", ">": "Gt", ">=": "Ge", "==": "Eq", "!=": "Ne" };

function operand(v: unknown, at: string): D {
  const [k, o] = tag(v, at, ["var", "num"]);
  return k === "var" ? SkopAst.Operand.create_VarOp(name(o.var, at)) : SkopAst.Operand.create_Num(str(o.num, at));
}

function cond(v: unknown, at: string): D {
  const [k, o] = tag(v, at, ["succeeds", "cmp"]);
  if (k === "succeeds") return SkopAst.Cond.create_Succeeds(parts(o.succeeds, `${at}.succeeds`));
  const c = obj(o.cmp, `${at}.cmp`, ["op", "l", "r"]);
  const op = typeof c.op === "string" ? OPS[c.op] : undefined;
  if (!op) throw new Unsupported(`${at}: unknown comparison ${JSON.stringify(c.op)}`);
  return SkopAst.Cond.create_Cmp(SkopAst.CmpOp[`create_${op}`](), operand(c.l, `${at}.l`), operand(c.r, `${at}.r`));
}

function askForm(a: J, at: string): D {
  const [k, o] = tag(a, at, ["sections", "yesno", "one_of", "score"], ["question", "sure", "else"]);
  switch (k) {
    case "sections":
      return SkopAst.AskForm.create_Sections(
        seq(o.sections, `${at}.sections`, (x, at) => {
          const s = obj(x, at, ["src", "section"], ["anchor"]);
          const { src, ...r } = s;
          return SkopAst.AskOption.create_AskOption(nat(src, at), ref(r, at));
        }),
      );
    case "yesno":
      return SkopAst.AskForm.create_YesNo(name(obj(o.yesno, `${at}.yesno`, ["as"]).as, at));
    case "one_of": {
      const x = obj(o.one_of, `${at}.one_of`, ["list", "as"]);
      return SkopAst.AskForm.create_OneOf(ref(x.list, `${at}.one_of.list`), name(x.as, at));
    }
    default: {
      const x = obj(o.score, `${at}.score`, ["low", "high", "rubric", "as"]);
      const rubric = seq(x.rubric, `${at}.score.rubric`, (y, at) => {
        const r = obj(y, at, ["src", "level", "text"]);
        return SkopAst.RubricLine.create_RubricLine(nat(r.src, at), int(r.level, at), str(r.text, at));
      });
      return SkopAst.AskForm.create_Score(int(x.low, at), int(x.high, at), rubric, name(x.as, at));
    }
  }
}

function stmt(v: unknown, at: string): D {
  const [k, s] = tag(v, at, ["run", "do", "check", "ask", "for_each", "if_yes", "then", "page", "hand_off", "stop"], ["src", "else"]);
  const src = nat(s.src, `${at}.src`);
  const where = `${at} (line ${s.src})`;
  const hasElse = ["run", "do"].includes(k);
  obj(s, where, hasElse ? ["src", k, "else"] : ["src", k]);
  switch (k) {
    case "run": {
      const r = obj(s.run, `${where}.run`, ["cmd"], ["as"]);
      return SkopAst.Stmt.create_Run(
        src,
        parts(r.cmd, `${where}.run.cmd`),
        "as" in r ? some(name(r.as, where)) : none(),
        els(s.else, `${where}.else`),
      );
    }
    case "do":
      return SkopAst.Stmt.create_Do(src, doBody(s.do, `${where}.do`), els(s.else, `${where}.else`));
    case "check": {
      const c = obj(s.check, `${where}.check`, ["cond", "then", "else"]);
      // SPEC §3.4: `check COND` needs a target, an else, or both.
      if (c.then === null && c.else === null) throw new Unsupported(`${where}: a check needs a target or an else`);
      const onTrue = c.then === null ? none() : some(target(c.then, `${where}.check.then`));
      return SkopAst.Stmt.create_Check(src, cond(c.cond, `${where}.check.cond`), onTrue, els(c.else, `${where}.check.else`));
    }
    case "ask": {
      const a = obj(s.ask, `${where}.ask`, ["question", "sure", "else"], ["sections", "yesno", "one_of", "score"]);
      const sure = nat(a.sure, `${where}.ask.sure`);
      if (sure.gt(100)) throw new Unsupported(`${where}: sure must be 0–100`);
      return SkopAst.Stmt.create_Ask(
        src,
        parts(a.question, `${where}.ask.question`),
        sure,
        askForm(a, `${where}.ask`),
        els(a.else, `${where}.ask.else`),
      );
    }
    case "for_each": {
      const f = obj(s.for_each, `${where}.for_each`, ["var", "list", "body"]);
      return SkopAst.Stmt.create_ForEach(
        src,
        name(f.var, where),
        ref(f.list, `${where}.for_each.list`),
        seq(f.body, `${where}.for_each.body`, stmt),
      );
    }
    case "if_yes": {
      const y = obj(s.if_yes, `${where}.if_yes`, ["else"], ["run", "do"]);
      const [which] = tag(y, `${where}.if_yes`, ["run", "do"], ["else"]);
      if (which === "run") {
        const r = obj(y.run, `${where}.if_yes.run`, ["cmd"]);
        return SkopAst.Stmt.create_IfYesRun(src, parts(r.cmd, `${where}.if_yes.run.cmd`), els(y.else, `${where}.if_yes.else`));
      }
      return SkopAst.Stmt.create_IfYesDo(src, doBody(y.do, `${where}.if_yes.do`), els(y.else, `${where}.if_yes.else`));
    }
    case "then":
      return SkopAst.Stmt.create_Then(src, ref(s.then, `${where}.then`));
    case "page":
      return SkopAst.Stmt.create_Page(src, parts(s.page, `${where}.page`));
    case "hand_off":
      obj(s.hand_off, `${where}.hand_off`, []);
      return SkopAst.Stmt.create_HandOff(src);
    default:
      obj(s.stop, `${where}.stop`, []);
      return SkopAst.Stmt.create_Stop(src);
  }
}

function item(v: unknown, at: string): D {
  const [k, i] = tag(v, at, ["action", "value"], ["src"]);
  obj(i, at, ["src", k]);
  const src = nat(i.src, `${at}.src`);
  if (k === "value") return SkopAst.Item.create_Value(src, str(i.value, at));
  const a = obj(i.action, `${at}.action`, ["label", "cmd"]);
  return SkopAst.Item.create_Action(src, str(a.label, at), parts(a.cmd, `${at}.action.cmd`));
}

function section(v: unknown, at: string): D {
  if (isObj(v) && "body" in v) {
    const s = obj(v, at, ["name", "src", "guidance", "body"]);
    const guidance = s.guidance === null ? none() : some(str(s.guidance, `${at}.guidance`));
    return SkopAst.Section.create_Instructions(str(s.name, at), nat(s.src, `${at}.src`), guidance, seq(s.body, `${at}.body`, stmt));
  }
  const s = obj(v, at, ["name", "src", "lists"]);
  const lists = seq(s.lists, `${at}.lists`, (l, at) => {
    const x = obj(l, at, ["src", "items"]);
    return SkopAst.List.create_List(nat(x.src, `${at}.src`), seq(x.items, `${at}.items`, item));
  });
  return SkopAst.Section.create_Other(str(s.name, at), nat(s.src, `${at}.src`), lists);
}

function param(v: unknown, at: string): D {
  const [k, p] = tag(v, at, ["str", "int"], ["src"]);
  obj(p, at, ["src", k]);
  const src = nat(p.src, `${at}.src`);
  return k === "str" ? SkopAst.Param.create_PStr(str(p.str, at), src) : SkopAst.Param.create_PInt(int(p.int, at), src);
}

/** Core program JSON to a SkopAst.Program. Throws Unsupported on anything the contract doesn't allow. */
export function toAst(json: CoreProgram | unknown): D {
  const p = obj(json, "program", ["skill", "format", "entry", "params", "limits", "sections"]);
  if (p.format !== 1) throw new Unsupported(`program: format must be 1, got ${JSON.stringify(p.format)}`);
  const e = obj(p.entry, "entry", ["section", "src"]);
  const l = obj(p.limits, "limits", ["run_timeout_ms", "do_timeout_ms", "deadline_ms", "ask_context_tokens"]);
  return SkopAst.Program.create_Program(
    str(p.skill, "skill"),
    SkopAst.Entry.create_Entry(str(e.section, "entry"), nat(e.src, "entry.src")),
    map(p.params, "params", param, name),
    SkopAst.Limits.create_Limits(
      nat(l.run_timeout_ms, "limits"),
      nat(l.do_timeout_ms, "limits"),
      nat(l.deadline_ms, "limits"),
      nat(l.ask_context_tokens, "limits"),
    ),
    map(p.sections, "sections", section),
  );
}

// ---- back to JSON, so tests can prove the round trip is exact ----

const S = (d: D): string => d.toVerbatimString(false);
const N = (d: D): number => d.toNumber();
const opt = <T>(d: D, f: (x: D) => T): T | undefined => (d.is_Some ? f(d.dtor_value) : undefined);
const arr = <T>(d: D, f: (x: D) => T): T[] => [...d].map(f);
function obj2(d: D, f: (x: D) => unknown): J {
  const out: J = {};
  for (const k of d.Keys.Elements) out[S(k)] = f(d.get(k));
  return out;
}

const partsJ = (d: D) => arr(d, (p) => (p.is_Lit ? { lit: S(p.dtor_s) } : { var: S(p.dtor_name) }));
function refJ(d: D): J {
  const a = opt(d.dtor_anchor, (x) => ({ given: S(x.dtor_given), expected: S(x.dtor_expected) }));
  return a ? { section: S(d.dtor_id), anchor: a } : { section: S(d.dtor_id) };
}
const elsJ = (d: D) => (d.is_NoElse ? null : d.is_Skip ? { skip: {} } : refJ(d.dtor_ref));
const doJ = (d: D) => (d.is_DoCmd ? { cmd: partsJ(d.dtor_cmd) } : { item: S(d.dtor_item) });
const OPS_BACK = Object.fromEntries(Object.entries(OPS).map(([k, v]) => [v, k]));
const operandJ = (d: D) => (d.is_VarOp ? { var: S(d.dtor_name) } : { num: S(d.dtor_text) });

function formJ(d: D): J {
  if (d.is_Sections) return { sections: arr(d.dtor_options, (o) => ({ src: N(o.dtor_src), ...refJ(o.dtor_ref) })) };
  if (d.is_YesNo) return { yesno: { as: S(d.dtor_binding) } };
  if (d.is_OneOf) return { one_of: { list: refJ(d.dtor_list), as: S(d.dtor_binding) } };
  const rubric = arr(d.dtor_rubric, (r) => ({ src: N(r.dtor_src), level: N(r.dtor_level), text: S(r.dtor_text) }));
  return { score: { low: N(d.dtor_low), high: N(d.dtor_high), rubric, as: S(d.dtor_binding) } };
}

function stmtJ(d: D): J {
  const src = N(d.dtor_src);
  if (d.is_Run) {
    const b = opt(d.dtor_binding, S);
    return { src, run: b === undefined ? { cmd: partsJ(d.dtor_cmd) } : { cmd: partsJ(d.dtor_cmd), as: b }, else: elsJ(d.dtor_els) };
  }
  if (d.is_Do) return { src, do: doJ(d.dtor_action), else: elsJ(d.dtor_els) };
  if (d.is_Check) {
    const c = d.dtor_cond;
    const cond = c.is_Succeeds
      ? { succeeds: partsJ(c.dtor_cmd) }
      : {
          cmp: {
            op: OPS_BACK[Object.keys(OPS_BACK).find((k) => c.dtor_op[`is_${k}`]) as string],
            l: operandJ(c.dtor_l),
            r: operandJ(c.dtor_r),
          },
        };
    const onTrue = opt(d.dtor_onTrue, (t) => (t.is_StopTarget ? { stop: {} } : refJ(t.dtor_ref)));
    return { src, check: { cond, then: onTrue ?? null, else: elsJ(d.dtor_els) } };
  }
  if (d.is_Ask)
    return { src, ask: { question: partsJ(d.dtor_question), sure: N(d.dtor_sure), else: elsJ(d.dtor_els), ...formJ(d.dtor_form) } };
  if (d.is_ForEach) return { src, for_each: { var: S(d.dtor_loopVar), list: refJ(d.dtor_list), body: arr(d.dtor_body, stmtJ) } };
  if (d.is_IfYesRun) return { src, if_yes: { run: { cmd: partsJ(d.dtor_cmd) }, else: elsJ(d.dtor_els) } };
  if (d.is_IfYesDo) return { src, if_yes: { do: doJ(d.dtor_action), else: elsJ(d.dtor_els) } };
  if (d.is_Then) return { src, then: refJ(d.dtor_ref) };
  if (d.is_Page) return { src, page: partsJ(d.dtor_text) };
  if (d.is_HandOff) return { src, hand_off: {} };
  return { src, stop: {} };
}

function sectionJ(d: D): J {
  if (d.is_Instructions) {
    return { name: S(d.dtor_name), src: N(d.dtor_src), guidance: opt(d.dtor_guidance, S) ?? null, body: arr(d.dtor_body, stmtJ) };
  }
  const lists = arr(d.dtor_lists, (l) => ({
    src: N(l.dtor_src),
    items: arr(l.dtor_items, (i) =>
      i.is_Value
        ? { src: N(i.dtor_src), value: S(i.dtor_value) }
        : { src: N(i.dtor_src), action: { label: S(i.dtor_text), cmd: partsJ(i.dtor_cmd) } },
    ),
  }));
  return { name: S(d.dtor_name), src: N(d.dtor_src), lists };
}

/** A SkopAst.Program back to core program JSON. */
export function fromAst(d: D): CoreProgram {
  const l = d.dtor_limits;
  return {
    skill: S(d.dtor_skill),
    format: 1,
    entry: { section: S(d.dtor_entry.dtor_section), src: N(d.dtor_entry.dtor_src) },
    params: obj2(d.dtor_params, (p) => (p.is_PStr ? { str: S(p.dtor_s), src: N(p.dtor_src) } : { int: N(p.dtor_i), src: N(p.dtor_src) })),
    limits: {
      run_timeout_ms: N(l.dtor_runTimeoutMs),
      do_timeout_ms: N(l.dtor_doTimeoutMs),
      deadline_ms: N(l.dtor_deadlineMs),
      ask_context_tokens: N(l.dtor_askContextTokens),
    },
    sections: obj2(d.dtor_sections, sectionJ),
  } as CoreProgram;
}
