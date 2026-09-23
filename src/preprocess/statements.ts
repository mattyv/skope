// Per-keyword grammar (SPEC §3.4), built on the Cursor from grammar.ts.
// Each parser consumes `rest` (the text after the leading `**keyword**`,
// trimmed) and returns either the statement's fields or GRAMMAR_ERROR.
// Nested-list content (ask options, Score rubric, for-each body) isn't
// parsed here: the caller supplies it once the sibling list block is known.

import {
  type BracketRef,
  Cursor,
  type Else,
  eatOp,
  eatOperand,
  eatTarget,
  GRAMMAR_ERROR,
  type GrammarError,
  type Operand,
  type Part,
  parseElse,
  type SectionRefRaw,
  splitParts,
  type Target,
} from "./grammar.js";

type Resolve = (b: BracketRef) => SectionRefRaw;

interface RunParsed {
  cmd: Part[];
  as?: string;
  else: Else;
}
export function parseRun(rest: string, resolve: Resolve): RunParsed | GrammarError {
  const cur = new Cursor(rest);
  const cmd = cur.eatCodeSpan();
  if (cmd === null) return GRAMMAR_ERROR;
  let as: string | undefined;
  if (cur.eat(" as ")) {
    const name = cur.eatName();
    if (name === null) return GRAMMAR_ERROR;
    as = name;
  }
  const elseR = parseElse(cur, resolve);
  if (elseR === GRAMMAR_ERROR) return GRAMMAR_ERROR;
  if (!cur.atEnd()) return GRAMMAR_ERROR;
  return { cmd: splitParts(cmd), as, else: elseR };
}

export type DoBody = { cmd: Part[] } | { item: string };
interface DoParsed {
  do: DoBody;
  else: Else;
}
export function parseDo(rest: string, resolve: Resolve): DoParsed | GrammarError {
  const cur = new Cursor(rest);
  let doBody: DoBody;
  const cmd = cur.eatCodeSpan();
  if (cmd !== null) {
    doBody = { cmd: splitParts(cmd) };
  } else {
    const name = cur.eatName();
    if (name === null) return GRAMMAR_ERROR;
    doBody = { item: name };
  }
  const elseR = parseElse(cur, resolve);
  if (elseR === GRAMMAR_ERROR) return GRAMMAR_ERROR;
  if (!cur.atEnd()) return GRAMMAR_ERROR;
  return { do: doBody, else: elseR };
}

export type Cond = { succeeds: Part[] } | { cmp: { op: string; l: Operand; r: Operand } };
interface CheckParsed {
  cond: Cond;
  then: Target | null;
  else: Else;
}
export function parseCheck(rest: string, resolve: Resolve): CheckParsed | GrammarError {
  const cur = new Cursor(rest);
  const cond = parseCond(cur);
  if (cond === GRAMMAR_ERROR) return GRAMMAR_ERROR;

  if (cur.eat(" → ") || cur.eat(" -> ")) {
    const target = eatTarget(cur, resolve);
    if (target === null) return GRAMMAR_ERROR;
    const elseR = parseElse(cur, resolve);
    if (elseR === GRAMMAR_ERROR) return GRAMMAR_ERROR;
    if (!cur.atEnd()) return GRAMMAR_ERROR;
    return { cond, then: target, else: elseR };
  }
  const elseR = parseElse(cur, resolve);
  if (elseR === GRAMMAR_ERROR || elseR === null) return GRAMMAR_ERROR;
  if (!cur.atEnd()) return GRAMMAR_ERROR;
  return { cond, then: null, else: elseR };
}

function parseCond(cur: Cursor): Cond | GrammarError {
  const cmd = cur.eatCodeSpan();
  if (cmd !== null) {
    if (!cur.eat(" succeeds")) return GRAMMAR_ERROR;
    return { succeeds: splitParts(cmd) };
  }
  const l = eatOperand(cur);
  if (l === null) return GRAMMAR_ERROR;
  if (!cur.eat(" ")) return GRAMMAR_ERROR;
  const op = eatOp(cur);
  if (op === null) return GRAMMAR_ERROR;
  if (!cur.eat(" ")) return GRAMMAR_ERROR;
  const r = eatOperand(cur);
  if (r === null) return GRAMMAR_ERROR;
  return { cmp: { op, l, r } };
}

interface ForEachParsed {
  var: string;
  list: BracketRef;
}
export function parseForEach(rest: string): ForEachParsed | GrammarError {
  const cur = new Cursor(rest);
  const name = cur.eatName();
  if (name === null) return GRAMMAR_ERROR;
  if (!cur.eat(" in ")) return GRAMMAR_ERROR;
  const br = cur.eatBracketRef();
  if (!br) return GRAMMAR_ERROR;
  if (!cur.atEnd()) return GRAMMAR_ERROR;
  return { var: name, list: br };
}

interface IfYesParsed {
  run?: { cmd: Part[] };
  do?: DoBody;
  else: Else;
}
export function parseIfYes(rest: string, resolve: Resolve): IfYesParsed | GrammarError {
  const cur = new Cursor(rest);
  let run: { cmd: Part[] } | undefined;
  let doBody: DoBody | undefined;
  if (cur.eat("run ")) {
    const cmd = cur.eatCodeSpan();
    if (cmd === null) return GRAMMAR_ERROR;
    run = { cmd: splitParts(cmd) };
  } else if (cur.eat("do ")) {
    const cmd = cur.eatCodeSpan();
    if (cmd !== null) doBody = { cmd: splitParts(cmd) };
    else {
      const name = cur.eatName();
      if (name === null) return GRAMMAR_ERROR;
      doBody = { item: name };
    }
  } else {
    return GRAMMAR_ERROR;
  }
  const elseR = parseElse(cur, resolve);
  if (elseR === GRAMMAR_ERROR) return GRAMMAR_ERROR;
  if (!cur.atEnd()) return GRAMMAR_ERROR;
  return { run, do: doBody, else: elseR };
}

export function parseThen(rest: string, resolve: Resolve): SectionRefRaw | GrammarError {
  const cur = new Cursor(rest);
  const br = cur.eatBracketRef();
  if (!br) return GRAMMAR_ERROR;
  if (!cur.atEnd()) return GRAMMAR_ERROR;
  return resolve(br);
}

export function parsePage(rest: string): Part[] | GrammarError {
  if (rest[0] !== '"') return GRAMMAR_ERROR;
  const close = rest.lastIndexOf('"');
  if (close <= 0) return GRAMMAR_ERROR;
  const content = rest.slice(1, close);
  if (rest.slice(close + 1).trim() !== "") return GRAMMAR_ERROR;
  return splitParts(content);
}

export function parseNoArg(rest: string): true | GrammarError {
  return rest.trim() === "" ? true : GRAMMAR_ERROR;
}

// --- ask ---------------------------------------------------------------

type AskForm = "sections" | "yesno" | "one_of" | "score";
interface AskParsed {
  question: Part[];
  sure: number;
  else: Else;
  form: AskForm;
  yesnoAs?: string;
  oneOfList?: BracketRef;
  oneOfAs?: string;
  scoreLow?: number;
  scoreHigh?: number;
  scoreAs?: string;
}

function findQEnd(s: string): number {
  const candidates = [s.indexOf(" → "), s.indexOf(" -> "), s.indexOf(" · ")].filter((i) => i !== -1);
  return candidates.length === 0 ? -1 : Math.min(...candidates);
}

export function parseAsk(rest: string, resolve: Resolve): AskParsed | GrammarError {
  const qEnd = findQEnd(rest);
  if (qEnd === -1) return GRAMMAR_ERROR;
  const qText = rest.slice(0, qEnd);
  if (qText.length === 0) return GRAMMAR_ERROR;

  const cur = new Cursor(rest);
  cur.pos = qEnd;

  let form: AskForm;
  let yesnoAs: string | undefined;
  let oneOfList: BracketRef | undefined;
  let oneOfAs: string | undefined;
  let scoreLow: number | undefined;
  let scoreHigh: number | undefined;
  let scoreAs: string | undefined;

  if (cur.eat(" → ") || cur.eat(" -> ")) {
    if (cur.eat("yes | no")) {
      form = "yesno";
      if (cur.eat(" as ")) {
        const n = cur.eatName();
        if (n === null) return GRAMMAR_ERROR;
        yesnoAs = n;
      }
    } else if (cur.startsWith("one of ")) {
      cur.eat("one of ");
      const br = cur.eatBracketRef();
      if (!br) return GRAMMAR_ERROR;
      if (!cur.eat(" as ")) return GRAMMAR_ERROR;
      const n = cur.eatName();
      if (n === null) return GRAMMAR_ERROR;
      form = "one_of";
      oneOfList = br;
      oneOfAs = n;
    } else {
      const m = /^(\d+) to (\d+) as ([a-z_][a-z0-9_]*)/.exec(cur.rest());
      if (!m) return GRAMMAR_ERROR;
      cur.pos += m[0].length;
      form = "score";
      scoreLow = Number(m[1]);
      scoreHigh = Number(m[2]);
      scoreAs = m[3];
    }
  } else {
    form = "sections";
  }

  if (!cur.eat(" · sure ")) return GRAMMAR_ERROR;
  const sureM = /^(\d+)%/.exec(cur.rest());
  if (!sureM) return GRAMMAR_ERROR;
  const sure = Number(sureM[1]);
  if (sure < 0 || sure > 100) return GRAMMAR_ERROR;
  cur.pos += sureM[0].length;

  const elseR = parseElse(cur, resolve);
  if (elseR === GRAMMAR_ERROR) return GRAMMAR_ERROR;
  if (!cur.atEnd()) return GRAMMAR_ERROR;

  return { question: splitParts(qText), sure, else: elseR, form, yesnoAs, oneOfList, oneOfAs, scoreLow, scoreHigh, scoreAs };
}
