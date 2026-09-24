// Instruction-line grammar (SPEC §3.3, §3.4): the leading-bold classifier,
// and a Cursor the per-keyword parsers in statements.ts share. A regex per
// form was tried and discarded: the ELSE suffix is shared by six forms, and
// a Cursor makes that sharing trivial.

import { sectionId } from "./slug.js";

export const KEYWORDS = ["run", "do", "check", "ask", "for each", "if yes", "then", "page", "hand off", "stop"] as const;
export type Keyword = (typeof KEYWORDS)[number];

export type Lead =
  | { kind: "keyword"; keyword: Keyword; colon: boolean; rest: string }
  | { kind: "note" } // bold ending in `:`, e.g. `**Note:**`: prose
  | { kind: "unknown"; content: string; html?: true }; // any other bold: E-UNKNOWN-BOLD

/** Classifies an item by its leading `**bold**` or `__bold__` span (SPEC §3.3
 * rule 3), or returns null when the item doesn't start with bold. Emphasis
 * markers just inside the bold (`***run***`, `**_run_**`) don't hide a
 * keyword. */
export function classifyLead(text: string): Lead | null {
  // HTML bold renders like **bold** but isn't skope's bold: an error, not a
  // silent prose item (SPEC §3.3 rule 3).
  const html = /^<(b|strong)>(.*?)<\/\1>/i.exec(text);
  if (html) return { kind: "unknown", content: html[2] ?? "", html: true };
  const delim = text.slice(0, 2);
  if (delim !== "**" && delim !== "__") return null;
  const close = text.indexOf(delim, 3);
  if (close === -1) return null;
  const content = text.slice(2, close);
  const rest = text.slice(close + 2);
  const bare = content.replace(/^[*_]+|[*_]+$/g, "");
  const colon = bare.endsWith(":") || rest.startsWith(":");
  const word = (bare.endsWith(":") ? bare.slice(0, -1) : bare).toLowerCase();
  const keyword = KEYWORDS.find((k) => k === word);
  if (keyword) return { kind: "keyword", keyword, colon, rest };
  // A misspelt multi-word keyword with a colon (`**for_each:**`) is still a
  // typo, not a note: it normalises to a keyword.
  const squashed = word.replace(/[\s_-]+/g, "");
  if (colon && KEYWORDS.some((k) => k.replace(/ /g, "") === squashed)) return { kind: "unknown", content };
  return colon ? { kind: "note" } : { kind: "unknown", content };
}

/** The keyword an item starts with, colon or not (SPEC §3.3 rules 3 and 7). */
export function leadingKeyword(text: string): Keyword | null {
  const lead = classifyLead(text);
  return lead?.kind === "keyword" ? lead.keyword : null;
}

/** "did you mean **for each**?" for a near-miss keyword (SPEC §3.3 rule 5),
 * after normalising case, `_`, `-` and spacing; "" when nothing is close. */
export function suggestKeyword(content: string): string {
  const norm = content
    .toLowerCase()
    .replace(/[*_:]+/g, " ")
    .replace(/[-\s]+/g, " ")
    .trim();
  let best: { k: Keyword; d: number } | null = null;
  for (const k of KEYWORDS) {
    const d = Math.min(distance(norm, k), distance(norm.replace(/ /g, ""), k.replace(/ /g, "")));
    if (best === null || d < best.d) best = { k, d };
  }
  return best && best.d <= 2 && best.d < norm.length ? `; did you mean **${best.k}**?` : "";
}

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length] as number;
}

// --- Parts (interpolation) -------------------------------------------------

export type Part = { lit: string } | { var: string };
const VAR = /\{([a-z_][a-z0-9_]*)\}/g;

export function splitParts(text: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const m of text.matchAll(VAR)) {
    const index = m.index ?? 0;
    if (index > last) parts.push({ lit: text.slice(last, index) });
    parts.push({ var: m[1] ?? "" });
    last = index + m[0].length;
  }
  if (last < text.length || parts.length === 0) parts.push({ lit: text.slice(last) });
  return parts;
}

// --- Cursor ------------------------------------------------------------

export const GRAMMAR_ERROR = Symbol("grammar_error");
export type GrammarError = typeof GRAMMAR_ERROR;
export type BracketRef = { text: string; anchor?: string };

// Token separators (SPEC §3.4: whitespace between tokens is one or more spaces).
export const T = {
  sp: / +/y,
  arrow: / +(?:→|->) +/y,
  else: / +· +else +/y,
  sure: / +· +sure +(\d+)%/y,
  as: / +as +/y,
  in: / +in +/y,
  succeeds: / +succeeds/y,
  oneOf: /one +of +/y,
  score: /(\d+) +to +(\d+)/y,
  yesNo: /yes \| no/y,
  op: /<=|>=|==|!=|<|>/y,
  varOperand: /\{([a-z_][a-z0-9_]*)\}%?/y,
  numOperand: /(-?[0-9]+(?:\.[0-9]+)?)%?/y,
  name: /[a-z_][a-z0-9_]*/y,
  stop: /stop/y,
  skip: /skip/y,
  runInline: /run +/y,
  doInline: /do +/y,
};

export class Cursor {
  pos = 0;
  constructor(readonly s: string) {}

  atEnd(): boolean {
    return this.pos >= this.s.length;
  }
  /** Matches a sticky regex here, and moves past it on success. */
  match(re: RegExp): RegExpExecArray | null {
    re.lastIndex = this.pos;
    const m = re.exec(this.s);
    if (m) this.pos = re.lastIndex;
    return m;
  }
  eat(re: RegExp): boolean {
    return this.match(re) !== null;
  }
  name(): string | null {
    return this.match(T.name)?.[0] ?? null;
  }
  /** One CommonMark code span: a run of n backticks, closed by a run of
   * exactly n; one space is stripped from each end if both have one. */
  codeSpan(): string | null {
    const open = /`+/y;
    open.lastIndex = this.pos;
    const o = open.exec(this.s);
    if (!o) return null;
    const run = /`+/g;
    run.lastIndex = open.lastIndex;
    for (let c = run.exec(this.s); c; c = run.exec(this.s)) {
      if (c[0].length !== o[0].length) continue;
      let content = this.s.slice(open.lastIndex, c.index);
      if (/^ .*[^ ].* $/s.test(content)) content = content.slice(1, -1);
      this.pos = run.lastIndex;
      return content;
    }
    return null;
  }
  /** `[text]` or `[text](#anchor)`; the text must have a slug (SPEC §3.4). */
  bracketRef(): BracketRef | null {
    const m = /\[([^\]]+)\](?:\(#([^)]*)\))?/y;
    m.lastIndex = this.pos;
    const r = m.exec(this.s);
    if (!r || sectionId(r[1] as string) === "s:") return null;
    this.pos = m.lastIndex;
    return r[2] === undefined ? { text: r[1] as string } : { text: r[1] as string, anchor: r[2] };
  }
}
