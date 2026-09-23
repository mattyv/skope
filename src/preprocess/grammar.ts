// Instruction-line grammar (SPEC §3.3, §3.4): the leading bold-span
// classifier, and a small hand-written recursive-descent parser per
// keyword. A combinator/regex-per-line approach was tried and discarded:
// the ELSE suffix is shared by six different forms and a Cursor makes that
// sharing trivial, where one regex per form duplicates it six times.

export const KEYWORDS = ["run", "do", "check", "ask", "for each", "if yes", "then", "page", "hand off", "stop"] as const;
export type Keyword = (typeof KEYWORDS)[number];

export interface LeadingBold {
  content: string;
  rest: string;
  endsWithColon: boolean;
}

/** Extracts a `**...**` span at the very start of `text`, if there is one. */
export function extractLeadingBold(text: string): LeadingBold | null {
  if (!text.startsWith("**")) return null;
  const close = text.indexOf("**", 2);
  if (close === -1) return null;
  const content = text.slice(2, close);
  if (content.length === 0) return null;
  let rest = text.slice(close + 2);
  let endsWithColon = false;
  if (content.endsWith(":")) {
    endsWithColon = true;
  } else if (rest.startsWith(":")) {
    endsWithColon = true;
    rest = rest.slice(1);
  }
  return { content, rest, endsWithColon };
}

export function matchKeyword(content: string): Keyword | null {
  const lc = content.toLowerCase();
  return (KEYWORDS as readonly string[]).includes(lc) ? (lc as Keyword) : null;
}

/** SPEC §3.3 rule 7: does this list item start with a real keyword (not a
 * `**Note:**`-style prose lead-in)? Used wherever instructions aren't
 * recognised, to flag E-MISPLACED. */
export function isKeywordLed(text: string): boolean {
  const bold = extractLeadingBold(text);
  if (!bold || bold.endsWithColon) return false;
  return matchKeyword(bold.content) !== null;
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

export class Cursor {
  pos = 0;
  constructor(public s: string) {}

  rest(): string {
    return this.s.slice(this.pos);
  }
  atEnd(): boolean {
    return this.pos >= this.s.length;
  }
  startsWith(lit: string): boolean {
    return this.s.startsWith(lit, this.pos);
  }
  eat(lit: string): boolean {
    if (this.startsWith(lit)) {
      this.pos += lit.length;
      return true;
    }
    return false;
  }
  eatCodeSpan(): string | null {
    if (this.s[this.pos] !== "`") return null;
    const close = this.s.indexOf("`", this.pos + 1);
    if (close === -1) return null;
    const content = this.s.slice(this.pos + 1, close);
    this.pos = close + 1;
    return content;
  }
  eatName(): string | null {
    const m = /^[a-z_][a-z0-9_]*/.exec(this.rest());
    if (!m) return null;
    this.pos += m[0].length;
    return m[0];
  }
  eatBracketRef(): { text: string; anchor?: string } | null {
    if (this.s[this.pos] !== "[") return null;
    const close = this.s.indexOf("]", this.pos + 1);
    if (close === -1) return null;
    const text = this.s.slice(this.pos + 1, close);
    if (text.length === 0) return null;
    let p = close + 1;
    let anchor: string | undefined;
    if (this.s.slice(p, p + 2) === "(#") {
      const closeParen = this.s.indexOf(")", p + 2);
      if (closeParen === -1) return null;
      anchor = this.s.slice(p + 2, closeParen);
      p = closeParen + 1;
    }
    this.pos = p;
    return { text, anchor };
  }
}

// --- SectionRef / Target / Else -----------------------------------------

export interface SectionRefRaw {
  section: string; // section id, computed by the caller from `text`
  anchor?: { given: string; expected: string };
}
export type BracketRef = { text: string; anchor?: string };

export type Target = { stop: Record<string, never> } | SectionRefRaw;
export type Else = null | { skip: Record<string, never> } | SectionRefRaw;

export function eatTarget(cur: Cursor, resolve: (b: BracketRef) => SectionRefRaw): Target | null {
  if (cur.eat("stop")) return { stop: {} };
  const br = cur.eatBracketRef();
  if (br) return resolve(br);
  return null;
}

export function parseElse(cur: Cursor, resolve: (b: BracketRef) => SectionRefRaw): Else | GrammarError {
  if (!cur.startsWith(" · else ")) return null;
  cur.eat(" · else ");
  if (cur.eat("skip")) return { skip: {} };
  const br = cur.eatBracketRef();
  if (br) return resolve(br);
  return GRAMMAR_ERROR;
}

// --- Operands / comparisons (§3.4 COND) ---------------------------------

export type Operand = { var: string } | { num: string };
const OPERATORS = ["<=", ">=", "==", "!=", "<", ">"] as const;

export function eatOperand(cur: Cursor): Operand | null {
  const varM = /^\{([a-z_][a-z0-9_]*)\}%?/.exec(cur.rest());
  if (varM) {
    cur.pos += varM[0].length;
    return { var: varM[1] ?? "" };
  }
  const numM = /^-?[0-9]+(\.[0-9]+)?%?/.exec(cur.rest());
  if (numM) {
    cur.pos += numM[0].length;
    const raw = numM[0];
    return { num: raw.endsWith("%") ? raw.slice(0, -1) : raw };
  }
  return null;
}

export function eatOp(cur: Cursor): string | null {
  for (const op of OPERATORS) if (cur.eat(op)) return op;
  return null;
}
