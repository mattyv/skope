// Per-keyword grammar (SPEC §3.4), on the Cursor from grammar.ts. Each parser
// takes the text after the leading `**keyword**` and returns the statement's
// fields or GRAMMAR_ERROR. Nested lists (ask options, for-each
// body) aren't parsed here; the caller has them.

import { type BracketRef, Cursor, GRAMMAR_ERROR, type GrammarError, type Part, splitParts, T } from "./grammar.js";

export type Ref = { section: string; anchor?: { given: string; expected: string } };
export type Resolve = (b: BracketRef) => Ref;
export type Else = null | { skip: Record<string, never> } | Ref;
export type DoBody = { cmd: Part[] } | { item: string };
export type Operand = { var: string } | { num: string };
export type Op = "<" | "<=" | ">" | ">=" | "==" | "!=";
export type Cond = { succeeds: Part[] } | { cmp: { op: Op; l: Operand; r: Operand } };

const fail = (): GrammarError => GRAMMAR_ERROR;

/** `[ELSE]` then the end of the text; the parsers' common tail. */
function elseThenEnd(cur: Cursor, resolve: Resolve): Else | GrammarError {
  let e: Else = null;
  if (cur.eat(T.else)) {
    if (cur.eat(T.skip)) e = { skip: {} };
    else {
      const br = cur.bracketRef();
      if (!br) return GRAMMAR_ERROR;
      e = resolve(br);
    }
  }
  return cur.atEnd() ? e : GRAMMAR_ERROR;
}

/** ` as NAME`: the name, or null when there's no ` as `. */
function optionalAs(cur: Cursor): string | null | GrammarError {
  return cur.eat(T.as) ? (cur.name() ?? GRAMMAR_ERROR) : null;
}

/** ` as NAME`, which must be there. */
function requiredAs(cur: Cursor): string | GrammarError {
  return optionalAs(cur) ?? GRAMMAR_ERROR;
}

function cmdOrItem(cur: Cursor): DoBody | null {
  const cmd = cur.codeSpan();
  if (cmd !== null) return { cmd: splitParts(cmd) };
  const name = cur.name();
  return name === null ? null : { item: name };
}

export function parseRun(rest: string, resolve: Resolve) {
  const cur = new Cursor(rest);
  if (!cur.eat(T.sp)) return fail();
  const cmd = cur.codeSpan();
  if (cmd === null) return fail();
  const as = optionalAs(cur);
  const e = as === GRAMMAR_ERROR ? as : elseThenEnd(cur, resolve);
  if (as === GRAMMAR_ERROR || e === GRAMMAR_ERROR) return fail();
  return { run: { cmd: splitParts(cmd), ...(as === null ? {} : { as }) }, else: e };
}

export function parseDo(rest: string, resolve: Resolve) {
  const cur = new Cursor(rest);
  if (!cur.eat(T.sp)) return fail();
  const body = cmdOrItem(cur);
  if (body === null) return fail();
  const e = elseThenEnd(cur, resolve);
  if (e === GRAMMAR_ERROR) return fail();
  return { do: body, else: e };
}

function operand(cur: Cursor): Operand | null {
  const v = cur.match(T.varOperand);
  if (v) return { var: v[1] as string };
  const n = cur.match(T.numOperand);
  return n ? { num: n[1] as string } : null; // the `%` is decoration (SPEC §3.4)
}

export function parseCheck(rest: string, resolve: Resolve) {
  const cur = new Cursor(rest);
  if (!cur.eat(T.sp)) return fail();
  let cond: Cond;
  const cmd = cur.codeSpan();
  if (cmd !== null) {
    if (!cur.eat(T.succeeds)) return fail();
    cond = { succeeds: splitParts(cmd) };
  } else {
    const l = operand(cur);
    const op = l && cur.eat(T.sp) ? (cur.match(T.op)?.[0] as Op | undefined) : undefined;
    const r = op && cur.eat(T.sp) ? operand(cur) : null;
    if (!l || !op || !r) return fail();
    cond = { cmp: { op, l, r } };
  }
  let then: { stop: Record<string, never> } | Ref | null = null;
  if (cur.eat(T.arrow)) {
    if (cur.eat(T.stop)) then = { stop: {} };
    else {
      const br = cur.bracketRef();
      if (!br) return fail();
      then = resolve(br);
    }
  }
  const e = elseThenEnd(cur, resolve);
  if (e === GRAMMAR_ERROR || (then === null && e === null)) return fail();
  return { check: { cond, then, else: e } };
}

export function parseForEach(rest: string) {
  const cur = new Cursor(rest);
  if (!cur.eat(T.sp)) return fail();
  const name = cur.name();
  if (name === null || !cur.eat(T.in)) return fail();
  const list = cur.bracketRef();
  if (!list || !cur.atEnd()) return fail();
  return { var: name, list };
}

export function parseIfYes(rest: string, resolve: Resolve) {
  const cur = new Cursor(rest);
  if (!cur.eat(T.sp)) return fail();
  let inline: { run: { cmd: Part[] } } | { do: DoBody };
  if (cur.eat(T.runInline)) {
    const cmd = cur.codeSpan();
    if (cmd === null) return fail();
    inline = { run: { cmd: splitParts(cmd) } };
  } else if (cur.eat(T.doInline)) {
    const body = cmdOrItem(cur);
    if (body === null) return fail();
    inline = { do: body };
  } else return fail();
  const e = elseThenEnd(cur, resolve);
  if (e === GRAMMAR_ERROR) return fail();
  return { ...inline, else: e };
}

export function parseThen(rest: string, resolve: Resolve): Ref | GrammarError {
  const cur = new Cursor(rest);
  if (!cur.eat(T.sp)) return fail();
  const br = cur.bracketRef();
  return br && cur.atEnd() ? resolve(br) : fail();
}

export function parsePage(rest: string): Part[] | GrammarError {
  const m = /^ +"(.*)"$/s.exec(rest);
  return m ? splitParts(m[1] as string) : fail();
}

export function parseNoArg(rest: string): true | GrammarError {
  return rest === "" ? true : fail();
}

// --- ask ---------------------------------------------------------------

export type AskForm = { sections: true } | { yesno: { as: string } } | { one_of: { list: BracketRef; as: string } };

/** An integer the core can hold exactly (SPEC §5.1: JSON numbers). */
const safeInt = (s: string | undefined): number | null => {
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
};

/** What follows ` → ` in an ask: `yes | no` or `one of [L]`. */
function askForm(cur: Cursor): AskForm | GrammarError {
  if (cur.eat(T.yesNo)) {
    const as = optionalAs(cur);
    return as === GRAMMAR_ERROR ? as : { yesno: { as: as ?? "_yn" } };
  }
  if (cur.eat(T.oneOf)) {
    const list = cur.bracketRef();
    const as = list ? requiredAs(cur) : GRAMMAR_ERROR;
    return list && as !== GRAMMAR_ERROR ? { one_of: { list, as } } : GRAMMAR_ERROR;
  }
  return GRAMMAR_ERROR;
}

export function parseAsk(rest: string, resolve: Resolve) {
  const cur = new Cursor(rest);
  if (!cur.eat(T.sp)) return fail();
  // Q runs to the first ` → `, ` -> ` or ` · `, and may contain none of them (SPEC §3.4).
  const qEnd = / +(?:→|->) +| +· /g;
  qEnd.lastIndex = cur.pos;
  const end = qEnd.exec(rest)?.index ?? -1;
  if (end === -1) return fail();
  const q = rest.slice(cur.pos, end);
  if (q === "" || q.includes("→") || q.includes("->")) return fail();
  cur.pos = end;

  let form: AskForm | GrammarError = { sections: true };
  if (cur.eat(T.arrow)) form = askForm(cur);
  if (form === GRAMMAR_ERROR) return fail();

  const sureM = cur.match(T.sure);
  const sure = safeInt(sureM?.[1]);
  if (sure === null || sure > 100) return fail();
  const e = elseThenEnd(cur, resolve);
  if (e === GRAMMAR_ERROR) return fail();
  return { question: splitParts(q), sure, else: e, form };
}
