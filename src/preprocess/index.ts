// The preprocessor (SPEC §2, §3): Markdown skill -> core program JSON. Parses
// only; every semantic check (references resolve, taint, bound names, ...)
// is the core's job (SPEC §5.1).
//
// Its one safety property (SPEC §3.3 rules 4 and 7): a list item that starts
// with a keyword is an instruction or an error, never prose. Block structure
// comes from markdown-it (blocks.ts), so what runs is what renders.

import type { CoreProgram, List, OtherSection, Section, Stmt } from "../contracts.gen.js";
import { type Block, type Item, isPlainText, parseBlocks, plainText } from "./blocks.js";
import { mkErr, type ParseError } from "./errors.js";
import { parseFrontmatter } from "./frontmatter.js";
import { type BracketRef, Cursor, classifyLead, GRAMMAR_ERROR, KEYWORDS, leadingKeyword, splitParts, suggestKeyword } from "./grammar.js";
import { githubSlug, sectionId } from "./slug.js";
import {
  parseAsk,
  parseCheck,
  parseDo,
  parseForEach,
  parseIfYes,
  parseNoArg,
  parsePage,
  parseRun,
  parseThen,
  type Ref,
} from "./statements.js";

export type PreprocessResult =
  | {
      program: CoreProgram;
      warnings: ParseError[] /** Params limited to fixed values (SPEC §3.1). */;
      choices: Record<string, (string | number)[]>;
    }
  | { errors: ParseError[] };

export function preprocess(markdown: string): PreprocessResult {
  try {
    return new Preprocessor().run(markdown);
  } catch (e) {
    // A parser bug degrades to a reported error instead of crashing the
    // caller. The fuzz test fails if it's ever reached.
    return { errors: [mkErr("E-INTERNAL", 1, `preprocessor crashed: ${e instanceof Error ? e.message : String(e)}`)] };
  }
}

interface RawSection {
  name: string;
  src: number;
  id: string | null; // null when the heading has no slug or repeats one
  blocks: Block[];
}

const hasKeywordItem = (blocks: Block[]) => blocks.some((b) => b.kind === "list" && b.items.some((i) => leadingKeyword(i.text)));
const lists = (blocks: Block[]) => blocks.filter((b): b is Block & { kind: "list" } => b.kind === "list");

class Preprocessor {
  errors: ParseError[] = [];
  headings = new Map<string, string>(); // section id -> heading text
  listRefs = new Set<string>(); // ids used in list position: `for each … in [X]`, `one of [X]`

  err(code: string, line: number, message: string): void {
    this.errors.push(mkErr(code, line, message));
  }

  run(markdown: string): PreprocessResult {
    const lines = markdown
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n")
      .split("\n");
    const fm = parseFrontmatter(lines, this.errors);
    if (fm.notRunnable) return { errors: this.errors };

    const parsed = parseBlocks(lines.slice(fm.bodyStart).join("\n"), fm.bodyStart);
    if (parsed.tooDeep !== null) {
      this.err("E-NESTED-LIST", parsed.tooDeep, "lists and blockquotes nest too deeply to read reliably");
    }

    // Split at top-level `##` headings (setext too); anything before the first is prose.
    const raws: RawSection[] = [];
    const preamble: Block[] = [];
    for (const b of parsed.blocks) {
      if (b.kind === "heading" && b.level === 2) raws.push({ name: b.text.trim(), src: b.line, id: null, blocks: [] });
      else (raws.at(-1)?.blocks ?? preamble).push(b);
    }
    this.scanMisplaced(preamble);

    // Names first, so a link's anchor is checked against the heading it
    // resolves to (SPEC §3.4) whatever order sections come in.
    for (const rs of raws) {
      const id = sectionId(rs.name);
      if (id === "s:") this.err("E-SECTION-NAME", rs.src, `"${rs.name}" has no letters or digits, so it has no id`);
      else if (this.headings.has(id)) this.err("E-DUP-SECTION", rs.src, `"${rs.name}" has the same slug as an earlier section`);
      else {
        this.headings.set(id, rs.name);
        rs.id = id;
      }
    }

    // Instruction sections first: they say which sections are used as lists.
    const built = new Map<RawSection, Section | OtherSection>();
    const instruction = raws.filter((rs) => hasKeywordItem(rs.blocks));
    for (const rs of instruction) built.set(rs, this.instructionSection(rs));
    for (const rs of raws) if (!built.has(rs)) built.set(rs, this.otherSection(rs));

    if (this.errors.length > 0) return { errors: this.errors };

    const first = instruction.find((rs) => rs.id !== null);
    // A defaulted entry with no instruction section names an id no heading
    // can have (slugs never start with `_`), so the core reports it unresolved.
    const entry = fm.entry ?? (first ? { section: first.id as string, src: first.src } : { section: "s:_entry", src: 1 });
    const program: CoreProgram = {
      skill: fm.skill as string,
      format: 1,
      entry,
      params: Object.fromEntries(fm.params), // own properties, even for `__proto__`
      limits: fm.limits,
      sections: Object.fromEntries(raws.flatMap((rs) => (rs.id === null ? [] : [[rs.id, built.get(rs) as Section | OtherSection]]))),
    };
    // Agents never see frontmatter, so the intro is where they learn this is a skope skill.
    const warnings = fm.noted
      ? []
      : [mkErr("W-NO-SKOPE-NOTE", fm.blockLine, "the intro doesn't say this is a skope skill; agents reading it won't know (SPEC §3.1)")];
    return { program, warnings, choices: fm.choices };
  }

  resolve = (b: BracketRef): Ref => {
    const section = sectionId(b.text);
    if (b.anchor === undefined) return { section };
    return { section, anchor: { given: b.anchor, expected: githubSlug(this.headings.get(section) ?? b.text) } };
  };

  resolveList = (b: BracketRef): Ref => {
    const ref = this.resolve(b);
    this.listRefs.add(ref.section);
    return ref;
  };

  /** SPEC §3.3 rule 7: a keyword item anywhere instructions aren't recognised. */
  scanMisplaced(blocks: Block[]): void {
    for (const b of blocks) {
      if (b.kind === "quote") this.scanMisplaced(b.blocks);
      if (b.kind !== "list") continue;
      for (const item of b.items) {
        if (leadingKeyword(item.text)) this.err("E-MISPLACED", item.line, "a keyword item where instructions aren't recognised");
        this.scanMisplaced(item.blocks);
      }
    }
  }

  // --- instruction sections -----------------------------------------------

  instructionSection(rs: RawSection): Section {
    const body: Stmt[] = [];
    for (const b of rs.blocks) {
      if (b.kind === "list") body.push(...this.instructions(b.items));
      else this.scanMisplaced([b]);
    }
    // Guidance (SPEC §3.2): the first paragraph before the first list, else the first anywhere.
    const firstList = rs.blocks.findIndex((b) => b.kind === "list");
    const isPara = (b: Block) => b.kind === "paragraph";
    const para = (rs.blocks.slice(0, firstList === -1 ? undefined : firstList).find(isPara) ?? rs.blocks.find(isPara)) as
      | (Block & { kind: "paragraph" })
      | undefined;
    return { name: rs.name, src: rs.src, guidance: para ? plainText(para.inline) : null, body };
  }

  instructions(items: Item[]): Stmt[] {
    return items.flatMap((item) => this.instruction(item) ?? []);
  }

  instruction(item: Item): Stmt | null {
    const lead = classifyLead(item.text);
    if (lead?.kind !== "keyword") {
      if (lead?.kind === "unknown") {
        this.err("E-UNKNOWN-BOLD", item.line, unknownBold(lead));
      }
      this.scanMisplaced(item.blocks); // prose, subject to rule 7
      return null;
    }
    const { keyword, rest } = lead;
    const grammarError = (form: string) => {
      this.err(
        "E-GRAMMAR",
        item.line,
        lead.colon ? `**${keyword}** is a keyword, so it can't take a ':'` : `**${keyword}** must be ${form}`,
      );
      return null;
    };
    if (lead.colon) return grammarError("");

    const nested = lists(item.blocks);
    this.scanMisplaced(item.blocks.filter((b) => b.kind !== "list"));
    const noNested = () => {
      if (nested[0]) this.err("E-NESTED-LIST", nested[0].line, `**${keyword}** doesn't take a nested list`);
    };
    const src = item.line;
    switch (keyword) {
      case "run": {
        const r = parseRun(rest, this.resolve);
        if (r === GRAMMAR_ERROR) return grammarError("`**run** CMD [as NAME] [ELSE]`");
        noNested();
        return { src, ...r };
      }
      case "do": {
        const r = parseDo(rest, this.resolve);
        if (r === GRAMMAR_ERROR) return grammarError("`**do** CMD [ELSE]` or `**do** NAME [ELSE]`");
        noNested();
        return { src, ...r };
      }
      case "check": {
        const r = parseCheck(rest, this.resolve);
        if (r === GRAMMAR_ERROR) return grammarError("`**check** COND → TARGET [ELSE]` or `**check** COND ELSE`");
        noNested();
        return { src, ...r };
      }
      case "ask": {
        const r = parseAsk(rest, this.resolve);
        if (r === GRAMMAR_ERROR) return grammarError("one of the §3.4 ask forms, ending `· sure N%`");
        const ask = { question: r.question, sure: r.sure, else: r.else };
        const children = nested.flatMap((l) => l.items);
        if ("sections" in r.form) return { src, ask: { ...ask, sections: this.options(children) } };
        if ("score" in r.form) return { src, ask: { ...ask, score: { ...r.form.score, rubric: this.rubric(children) } } };
        noNested();
        if ("yesno" in r.form) return { src, ask: { ...ask, yesno: r.form.yesno } };
        return { src, ask: { ...ask, one_of: { list: this.resolveList(r.form.one_of.list), as: r.form.one_of.as } } };
      }
      case "for each": {
        const r = parseForEach(rest);
        if (r === GRAMMAR_ERROR) return grammarError("`**for each** NAME in [LIST]`");
        const list = this.resolveList(r.list);
        return { src, for_each: { var: r.var, list, body: nested.flatMap((l) => this.instructions(l.items)) } };
      }
      case "if yes": {
        const r = parseIfYes(rest, this.resolve);
        if (r === GRAMMAR_ERROR) return grammarError("`**if yes** run CMD [ELSE]` or `**if yes** do (CMD|NAME) [ELSE]`");
        noNested();
        return { src, if_yes: r };
      }
      case "then": {
        const r = parseThen(rest, this.resolve);
        if (r === GRAMMAR_ERROR) return grammarError("`**then** [SECTION]`");
        noNested();
        return { src, then: r };
      }
      case "page": {
        const r = parsePage(rest);
        if (r === GRAMMAR_ERROR) return grammarError('`**page** "text"`');
        noNested();
        return { src, page: r };
      }
      case "hand off":
      case "stop": {
        if (parseNoArg(rest) === GRAMMAR_ERROR) return grammarError(`\`**${keyword}**\` with nothing after it`);
        noNested();
        return keyword === "stop" ? { src, stop: {} } : { src, hand_off: {} };
      }
    }
  }

  /** Items of a strict nested list (options, rubric): each must match `form`
   * exactly and have nothing nested; anything nested is still scanned. */
  strictItems<T>(items: Item[], code: string, message: string, form: (item: Item) => T | null): T[] {
    return items.flatMap((item) => {
      const parsed = item.blocks.length === 0 ? form(item) : null;
      if (parsed === null) this.err(code, item.line, message);
      this.scanMisplaced(item.blocks);
      return parsed === null ? [] : [parsed];
    });
  }

  options(items: Item[]) {
    return this.strictItems(items, "E-OPTION-ITEM", "an option item must be exactly one [Section] link", (item) => {
      const cur = new Cursor(item.text);
      const br = cur.bracketRef();
      return br && cur.atEnd() ? { src: item.line, ...this.resolve(br) } : null;
    });
  }

  rubric(items: Item[]) {
    return this.strictItems(items, "E-RUBRIC-ITEM", "a rubric line must be `INT: text`", (item) => {
      const m = /^(\d+): +(.+)$/s.exec(item.text);
      const level = Number(m?.[1]);
      return m && Number.isSafeInteger(level) ? { src: item.line, level, text: m[2] as string } : null;
    });
  }

  // --- other sections (SPEC §3.2, §3.6) ------------------------------------

  /** A section with no instructions. Used as a list, its items are held to
   * §3.6 (E-DATA-ITEM); otherwise it's prose, and `lists` keeps only the
   * items that happen to be data items, leaving out lists with none. */
  otherSection(rs: RawSection): OtherSection {
    const strict = rs.id !== null && this.listRefs.has(rs.id);
    this.scanMisplaced(rs.blocks);
    const out: List[] = [];
    for (const list of lists(rs.blocks)) {
      const items = list.items.flatMap((item) => {
        const d = item.blocks.length === 0 ? dataItem(item) : null;
        if (d === null && strict) this.err("E-DATA-ITEM", item.line, "a data item must be plain text, or `Label — `command``");
        return d === null ? [] : [d];
      });
      if (strict || items.length > 0) out.push({ src: list.line, items });
    }
    return { name: rs.name, src: rs.src, lists: out };
  }
}

function dataItem(item: Item): List["items"][number] | null {
  const { text, line: src } = item;
  const sep = /—/.exec(text) ?? / - /.exec(text); // an em dash wins over ` - `
  if (sep) {
    const label = text.slice(0, sep.index).trim();
    const cur = new Cursor(text.slice(sep.index + sep[0].length).trim());
    const cmd = cur.codeSpan();
    return label && isPlainText(label) && cmd !== null && cur.atEnd() ? { src, action: { label, cmd: splitParts(cmd) } } : null;
  }
  return text && isPlainText(text) ? { src, value: text } : null;
}

/** The E-UNKNOWN-BOLD message: HTML bold is named as such, with the skope spelling when it's a keyword. */
function unknownBold(lead: { content: string; html?: true }): string {
  if (!lead.html) return `**${lead.content}** isn't a keyword${suggestKeyword(lead.content)}`;
  const keyword = KEYWORDS.find((k) => k === lead.content.trim().toLowerCase());
  return keyword ? `HTML bold isn't skope bold; use **${keyword}**` : `HTML bold isn't skope bold${suggestKeyword(lead.content)}`;
}
