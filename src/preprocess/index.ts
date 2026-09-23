// The preprocessor (SPEC §2, §3): Markdown skill -> core program JSON. Parses
// only; every semantic check (references resolve, taint, bound names, ...)
// is the core's job (SPEC §5.1).

import type { CoreProgram, List, OtherSection, ParamValue, Section, Stmt } from "../contracts.gen.js";
import { type Block, type ListBlock, type ListItem, parseBlockquoteInner, parseBlocks } from "./blocks.js";
import type { ParseError } from "./errors.js";
import { mkErr } from "./errors.js";
import { parseFrontmatter } from "./frontmatter.js";
import {
  type BracketRef,
  Cursor,
  extractLeadingBold,
  GRAMMAR_ERROR,
  isKeywordLed,
  matchKeyword,
  type SectionRefRaw,
  splitParts,
} from "./grammar.js";
import { githubSlug, sectionId } from "./slug.js";
import { parseAsk, parseCheck, parseDo, parseForEach, parseIfYes, parseNoArg, parsePage, parseRun, parseThen } from "./statements.js";

export type PreprocessResult = { program: CoreProgram } | { errors: ParseError[] };

export function preprocess(markdown: string, _file: string): PreprocessResult {
  try {
    return run(markdown);
  } catch (e) {
    // ponytail: a defensive catch-all so a parser bug degrades to a
    // reported error instead of crashing the caller (fuzz-tested). Anything
    // caught here is, by definition, a preprocessor bug to fix.
    return { errors: [mkErr("E-INTERNAL", 1, `preprocessor crashed: ${e instanceof Error ? e.message : String(e)}`)] };
  }
}

function run(markdown: string): PreprocessResult {
  const lines = markdown.split("\n");
  const errors: ParseError[] = [];

  const fm = parseFrontmatter(lines, errors);
  if (fm.notRunnable) return { errors };

  const resolve = (b: BracketRef): SectionRefRaw => {
    const ref: SectionRefRaw = { section: sectionId(b.text) };
    if (b.anchor !== undefined) ref.anchor = { given: b.anchor, expected: githubSlug(b.text) };
    return ref;
  };

  const blocks = parseBlocks(lines, fm.bodyStart, lines.length);

  interface RawSection {
    name: string;
    src: number;
    blocks: Block[];
    isInstruction: boolean;
  }
  const rawSections: RawSection[] = [];
  let current: RawSection | null = null;

  for (const b of blocks) {
    if (b.type === "heading" && b.level === 2) {
      current = { name: b.text, src: b.line, blocks: [], isInstruction: false };
      rawSections.push(current);
      continue;
    }
    if (b.type === "heading") continue; // level 1 or 3+: doesn't split a section
    if (b.type === "blockquote") {
      checkMisplaced(parseBlockquoteInner(lines, b.start, b.end), errors);
      continue;
    }
    if (current) {
      current.blocks.push(b);
    } else if (b.type === "list") {
      checkMisplaced([b], errors); // before the first section
    }
  }

  for (const rs of rawSections) {
    const firstList = rs.blocks.find((b): b is ListBlock => b.type === "list");
    rs.isInstruction = firstList !== undefined && (firstList.items[0]?.text ?? "").startsWith("**");
  }

  // Duplicate sections (SPEC §3.4: same slug, case-insensitive).
  const seenSlugs = new Set<string>();
  const sections: Record<string, Section | OtherSection> = {};
  for (const rs of rawSections) {
    const id = sectionId(rs.name);
    if (seenSlugs.has(id)) {
      errors.push(mkErr("E-DUP-SECTION", rs.src, `"${rs.name}" has the same slug as an earlier section`));
      continue;
    }
    seenSlugs.add(id);
    sections[id] = rs.isInstruction ? buildInstructionSection(rs, resolve, errors) : buildOtherSection(rs, errors);
  }

  // entry: from frontmatter, or the first instruction section by default.
  let entrySection: string;
  let entrySrc: number;
  if (fm.entryName !== undefined) {
    entrySection = sectionId(fm.entryName);
    entrySrc = fm.entryLine ?? 1;
  } else {
    const first = rawSections.find((rs) => rs.isInstruction);
    if (first) {
      entrySection = sectionId(first.name);
      entrySrc = first.src;
    } else {
      entrySection = "s:entry";
      entrySrc = 1;
    }
  }

  if (errors.length > 0) return { errors };

  const params: Record<string, ParamValue> = {};
  for (const p of fm.params) params[p.name] = p.value;

  const program: CoreProgram = {
    skill: fm.skill as string,
    format: 1,
    entry: { section: entrySection, src: entrySrc },
    params,
    limits: fm.limits,
    sections,
  };
  anchorsToHeadings(program);
  return { program };
}

// A link's `#anchor` must be the GitHub slug of the heading its text
// resolves to (SPEC §3.4), so `[Clean_Up](#clean-up)` finds `## Clean up`.
// References are built before every heading is known, so this runs last;
// a reference to no section keeps the slug of its own text.
function anchorsToHeadings(program: CoreProgram): void {
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    if (v === null || typeof v !== "object") return;
    const o = v as { section?: unknown; anchor?: { expected: string } };
    if (typeof o.section === "string" && o.anchor) {
      const target = program.sections[o.section];
      if (target) o.anchor.expected = githubSlug(target.name);
    }
    for (const x of Object.values(o)) visit(x);
  };
  visit(program.sections);
}

// --- misplaced-instruction scan (SPEC §3.3 rule 7) ----------------------

function checkMisplaced(blocks: Block[], errors: ParseError[]): void {
  for (const b of blocks) {
    if (b.type !== "list") continue;
    for (const item of b.items) {
      if (isKeywordLed(item.text)) {
        errors.push(mkErr("E-MISPLACED", item.line, "an instruction-looking item where instructions aren't recognised"));
      }
      if (item.children) checkMisplaced([item.children], errors);
    }
  }
}

// --- instruction sections -------------------------------------------------

function guidance(blocks: Block[]): string | null {
  let beforeList: string | null = null;
  let anywhere: string | null = null;
  let seenList = false;
  for (const b of blocks) {
    if (b.type === "list") {
      seenList = true;
      continue;
    }
    if (b.type === "paragraph") {
      if (anywhere === null) anywhere = inlinePlainText(b.text);
      if (!seenList && beforeList === null) beforeList = inlinePlainText(b.text);
    }
  }
  return beforeList ?? anywhere;
}

function inlinePlainText(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]/g, "$1");
}

function buildInstructionSection(
  rs: { name: string; src: number; blocks: Block[] },
  resolve: (b: BracketRef) => SectionRefRaw,
  errors: ParseError[],
): Section {
  const body: Stmt[] = [];
  for (const b of rs.blocks) {
    if (b.type !== "list") continue;
    body.push(...parseInstructionItems(b.items, resolve, errors));
  }
  return { name: rs.name, src: rs.src, guidance: guidance(rs.blocks), body };
}

function parseInstructionItems(items: ListItem[], resolve: (b: BracketRef) => SectionRefRaw, errors: ParseError[]): Stmt[] {
  const out: Stmt[] = [];
  for (const item of items) {
    const s = processInstructionItem(item, resolve, errors);
    if (s) out.push(s);
  }
  return out;
}

function checkNestedDisallowed(item: ListItem, errors: ParseError[]): void {
  if (item.children) {
    errors.push(mkErr("E-NESTED-LIST", item.children.line, "a nested list isn't allowed under this instruction"));
  }
}

function processInstructionItem(item: ListItem, resolve: (b: BracketRef) => SectionRefRaw, errors: ParseError[]): Stmt | null {
  const bold = extractLeadingBold(item.text);
  if (!bold || bold.endsWithColon) {
    if (item.children) checkMisplaced([item.children], errors); // prose, subject to rule 7
    return null;
  }
  const kw = matchKeyword(bold.content);
  if (!kw) {
    errors.push(mkErr("E-UNKNOWN-BOLD", item.line, `"${bold.content}" isn't a keyword`));
    if (item.children) checkMisplaced([item.children], errors);
    return null;
  }
  const rest = bold.rest.trim();

  switch (kw) {
    case "run": {
      const r = parseRun(rest, resolve);
      checkNestedDisallowed(item, errors);
      if (r === GRAMMAR_ERROR) {
        errors.push(mkErr("E-GRAMMAR", item.line, "**run** doesn't match `**run** CMD [as NAME] [ELSE]`"));
        return null;
      }
      const run: Stmt = { src: item.line, run: { cmd: r.cmd, ...(r.as !== undefined ? { as: r.as } : {}) }, else: r.else };
      return run;
    }
    case "do": {
      const r = parseDo(rest, resolve);
      checkNestedDisallowed(item, errors);
      if (r === GRAMMAR_ERROR) {
        errors.push(mkErr("E-GRAMMAR", item.line, "**do** doesn't match `**do** (CMD|NAME) [ELSE]`"));
        return null;
      }
      return { src: item.line, do: r.do, else: r.else } as Stmt;
    }
    case "check": {
      const r = parseCheck(rest, resolve);
      checkNestedDisallowed(item, errors);
      if (r === GRAMMAR_ERROR) {
        errors.push(mkErr("E-GRAMMAR", item.line, "**check** doesn't match its grammar"));
        return null;
      }
      return { src: item.line, check: { cond: r.cond, then: r.then, else: r.else } } as Stmt;
    }
    case "ask": {
      const r = parseAsk(rest, resolve);
      if (r === GRAMMAR_ERROR) {
        errors.push(mkErr("E-GRAMMAR", item.line, "**ask** doesn't match its grammar"));
        checkNestedDisallowed(item, errors);
        return null;
      }
      if (r.form === "sections") {
        const options = parseOptionsList(item.children, resolve, errors);
        return { src: item.line, ask: { question: r.question, sure: r.sure, else: r.else, sections: options } } as Stmt;
      }
      if (r.form === "score") {
        const rubric = parseRubricList(item.children, errors);
        return {
          src: item.line,
          ask: {
            question: r.question,
            sure: r.sure,
            else: r.else,
            score: { low: r.scoreLow as number, high: r.scoreHigh as number, as: r.scoreAs as string, rubric },
          },
        } as Stmt;
      }
      checkNestedDisallowed(item, errors);
      if (r.form === "yesno") {
        return {
          src: item.line,
          ask: { question: r.question, sure: r.sure, else: r.else, yesno: { as: r.yesnoAs ?? "_yn" } },
        } as Stmt;
      }
      return {
        src: item.line,
        ask: {
          question: r.question,
          sure: r.sure,
          else: r.else,
          one_of: { list: resolve(r.oneOfList as BracketRef), as: r.oneOfAs as string },
        },
      } as Stmt;
    }
    case "for each": {
      const r = parseForEach(rest);
      if (r === GRAMMAR_ERROR) {
        errors.push(mkErr("E-GRAMMAR", item.line, "**for each** doesn't match `**for each** NAME in [LIST]`"));
        return null;
      }
      const body = item.children ? parseInstructionItems(item.children.items, resolve, errors) : [];
      return { src: item.line, for_each: { var: r.var, list: resolve(r.list), body } } as Stmt;
    }
    case "if yes": {
      const r = parseIfYes(rest, resolve);
      checkNestedDisallowed(item, errors);
      if (r === GRAMMAR_ERROR) {
        errors.push(mkErr("E-GRAMMAR", item.line, "**if yes** doesn't match its grammar"));
        return null;
      }
      return { src: item.line, if_yes: { ...(r.run ? { run: r.run } : {}), ...(r.do ? { do: r.do } : {}), else: r.else } } as Stmt;
    }
    case "then": {
      const r = parseThen(rest, resolve);
      checkNestedDisallowed(item, errors);
      if (r === GRAMMAR_ERROR) {
        errors.push(mkErr("E-GRAMMAR", item.line, "**then** doesn't match `**then** [SECTION]`"));
        return null;
      }
      return { src: item.line, then: r } as Stmt;
    }
    case "page": {
      const r = parsePage(rest);
      checkNestedDisallowed(item, errors);
      if (r === GRAMMAR_ERROR) {
        errors.push(mkErr("E-GRAMMAR", item.line, "**page** doesn't match `**page** QUOTED`"));
        return null;
      }
      return { src: item.line, page: r } as Stmt;
    }
    case "hand off": {
      checkNestedDisallowed(item, errors);
      if (parseNoArg(rest) === GRAMMAR_ERROR) {
        errors.push(mkErr("E-GRAMMAR", item.line, "**hand off** takes no text"));
        return null;
      }
      return { src: item.line, hand_off: {} } as Stmt;
    }
    case "stop": {
      checkNestedDisallowed(item, errors);
      if (parseNoArg(rest) === GRAMMAR_ERROR) {
        errors.push(mkErr("E-GRAMMAR", item.line, "**stop** takes no text"));
        return null;
      }
      return { src: item.line, stop: {} } as Stmt;
    }
  }
}

function parseOptionsList(
  children: ListBlock | null,
  resolve: (b: BracketRef) => SectionRefRaw,
  errors: ParseError[],
): { src: number; section: string; anchor?: { given: string; expected: string } }[] {
  if (!children) return [];
  const out: { src: number; section: string; anchor?: { given: string; expected: string } }[] = [];
  for (const item of children.items) {
    const cur = new Cursor(item.text.trim());
    const br = cur.eatBracketRef();
    if (!br || !cur.atEnd()) {
      errors.push(mkErr("E-OPTION-ITEM", item.line, "an option item must be exactly one [Section] link"));
      continue;
    }
    const ref = resolve(br);
    out.push({ src: item.line, section: ref.section, ...(ref.anchor ? { anchor: ref.anchor } : {}) });
  }
  return out;
}

function parseRubricList(children: ListBlock | null, errors: ParseError[]): { src: number; level: number; text: string }[] {
  if (!children) return [];
  const out: { src: number; level: number; text: string }[] = [];
  for (const item of children.items) {
    const m = /^(\d+):\s(.+)$/.exec(item.text);
    if (!m) {
      errors.push(mkErr("E-RUBRIC-ITEM", item.line, "a rubric line must be `INT: text`"));
      continue;
    }
    out.push({ src: item.line, level: Number(m[1]), text: m[2] as string });
  }
  return out;
}

// --- data / prose sections -------------------------------------------------

function buildOtherSection(rs: { name: string; src: number; blocks: Block[] }, errors: ParseError[]): OtherSection {
  const lists = rs.blocks.filter((b): b is ListBlock => b.type === "list").map((lb) => parseDataList(lb, errors));
  return { name: rs.name, src: rs.src, lists };
}

function parseDataList(lb: ListBlock, errors: ParseError[]): List {
  const items: List["items"] = [];
  for (const item of lb.items) {
    const parsed = parseDataItemText(item.text);
    if (parsed.kind === "action") {
      items.push({ src: item.line, action: { label: parsed.label, cmd: splitParts(parsed.cmd) } });
    } else if (parsed.kind === "value") {
      items.push({ src: item.line, value: parsed.value });
    } else {
      errors.push(mkErr("E-DATA-ITEM", item.line, "must be plain text, or `Label — \\`command\\``"));
    }
    if (item.children) checkMisplaced([item.children], errors);
  }
  return { src: lb.items[0]?.line ?? lb.line, items };
}

type DataItemParsed = { kind: "action"; label: string; cmd: string } | { kind: "value"; value: string } | { kind: "error" };

function parseDataItemText(text: string): DataItemParsed {
  const emdash = text.indexOf("—");
  const hyphenSep = text.indexOf(" - ");
  const sep = emdash !== -1 ? { idx: emdash, len: 1 } : hyphenSep !== -1 ? { idx: hyphenSep, len: 3 } : null;
  if (sep) {
    const label = text.slice(0, sep.idx).trim();
    const rest = text.slice(sep.idx + sep.len).trim();
    const m = /^`([^`]*)`$/.exec(rest);
    if (label.length > 0 && m) return { kind: "action", label, cmd: m[1] as string };
    return { kind: "error" };
  }
  if (/[`*[\]]/.test(text)) return { kind: "error" };
  return { kind: "value", value: text.trim() };
}
