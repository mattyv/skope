// Frontmatter and skope block parsing (SPEC §3.1). The frontmatter holds only
// Agent Skills keys, so the file stays a valid skill anywhere skills are
// uploaded; skope's own settings live in a ```skope block in the intro, where
// an agent reading the skill can see them too (agents never see frontmatter).
// Durations are in ms and `4k tokens` is 4000 (contracts/README.md). Every
// error points at its field's line.

import { load as yamlLoad } from "js-yaml";
import type { ParseError } from "./errors.js";
import { mkErr } from "./errors.js";
import { sectionId } from "./slug.js";

export type ParamValue = { str: string; src: number } | { int: number; src: number };

export interface Limits {
  run_timeout_ms: number;
  do_timeout_ms: number;
  deadline_ms: number;
  ask_context_tokens: number;
}

export interface Frontmatter {
  notRunnable: boolean;
  skill?: string;
  entry?: { section: string; src: number };
  params: [string, ParamValue][];
  /** Params limited to a fixed set of values (SPEC §3.1), the default among them. */
  choices: Record<string, (string | number)[]>;
  limits: Limits;
  bodyStart: number; // 0-based index into `lines` where the body begins
  /** The intro, outside the skope block, says the file is a skope skill (W-NO-SKOPE-NOTE otherwise). */
  noted: boolean;
  /** The skope block's opening line, 1-based. */
  blockLine: number;
}

/** What the Agent Skills spec allows in frontmatter; claude.ai rejects any other key. */
const SPEC_KEYS = ["name", "description", "license", "compatibility", "metadata", "allowed-tools"];
/** What the skope block holds. */
const SKOPE_KEYS = ["format", "entry", "params", "limits"];

const DURATIONS: Record<string, keyof Limits> = { run_timeout: "run_timeout_ms", do_timeout: "do_timeout_ms", deadline: "deadline_ms" };
const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };

/** A positive integer the core can hold exactly, or null. */
const positive = (n: number): number | null => (Number.isSafeInteger(n) && n >= 1 ? n : null);

/** Every duration is 1 ms to 2^31 − 1 ms (SPEC §4.4), the longest a Node timer can wait. */
const MAX_MS = 2 ** 31 - 1;

function parseDurationMs(s: unknown): number | null {
  const m = typeof s === "string" ? /^(\d+)(s|m|h)$/.exec(s.trim()) : null;
  const ms = m ? positive(Number(m[1]) * (UNIT_MS[m[2] as string] as number)) : null;
  return ms !== null && ms <= MAX_MS ? ms : null;
}

function parseTokens(s: unknown): number | null {
  const m = typeof s === "string" ? /^(\d+)(k)? *tokens$/.exec(s.trim()) : null;
  return m ? positive(Number(m[1]) * (m[2] ? 1000 : 1)) : null;
}

/** The 1-based line of each top-level key (`name`) and of each key one level
 * under it (`params.mount`), from a YAML block whose first line is line
 * `first`. Block style only; flow-style values fall back to their parent's line. */
function keyLines(fmLines: string[], first: number): Map<string, number> {
  const KEY = /^( *)(?:"([^"]*)"|'([^']*)'|([^\s#'"][^:#]*?)) *:(?: |$)/;
  const lines = new Map<string, number>();
  let parent: string | null = null;
  let childIndent: number | null = null;
  fmLines.forEach((l, i) => {
    const m = KEY.exec(l);
    if (!m) return;
    const indent = (m[1] as string).length;
    const key = (m[2] ?? m[3] ?? m[4]) as string;
    if (indent === 0) {
      parent = key;
      childIndent = null;
      lines.set(key, i + first);
    } else if (parent !== null) {
      childIndent ??= indent;
      if (indent === childIndent && !lines.has(`${parent}.${key}`)) lines.set(`${parent}.${key}`, i + first);
    }
  });
  return lines;
}

const isMapping = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A YAML mapping from `yamlLines`, whose first line is line `first`, or null after reporting why not. */
function loadMapping(yamlLines: string[], first: number, what: string, errors: ParseError[]): Record<string, unknown> | null {
  let doc: unknown;
  try {
    doc = yamlLoad(yamlLines.join("\n"));
  } catch (e) {
    const line = (e as { mark?: { line?: number } }).mark?.line;
    const last = first + Math.max(yamlLines.length - 1, 0);
    errors.push(mkErr("E-FRONTMATTER", typeof line === "number" ? Math.min(line + first, last) : first, `${what} isn't valid YAML`));
    return null;
  }
  if (doc === undefined || doc === null) return {};
  if (!isMapping(doc)) {
    errors.push(mkErr("E-FRONTMATTER", first, `${what} isn't a YAML mapping`));
    return null;
  }
  return doc;
}

const FENCE = /^(`{3,}|~{3,})\s*skope\s*$/;
// A level-2 heading ends the intro; setext `---` underlines aren't worth the ambiguity with rules.
const H2 = /^ {0,3}##(?:\s|$)/;

export function parseFrontmatter(lines: string[], errors: ParseError[]): Frontmatter {
  const limits: Limits = { run_timeout_ms: 30_000, do_timeout_ms: 300_000, deadline_ms: 900_000, ask_context_tokens: 4000 };
  const result: Frontmatter = { notRunnable: true, params: [], choices: {}, limits, bodyStart: 0, noted: false, blockLine: 1 };

  if ((lines[0] ?? "").trim() !== "---") {
    errors.push(mkErr("E-NOT-RUNNABLE", 1, "no ```skope block with `format: 1` (the file has no frontmatter either)"));
    return result;
  }
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end === -1) {
    errors.push(mkErr("E-FRONTMATTER", 1, "frontmatter isn't closed with `---`"));
    return result;
  }
  const fmLines = lines.slice(1, end);
  const fm = loadMapping(fmLines, 2, "frontmatter", errors);
  if (fm === null) return result;

  // The skope block: the intro's ```skope fence, before the first `##` section.
  let intro = lines.length;
  for (let i = end + 1; i < lines.length; i++)
    if (H2.test(lines[i] as string)) {
      intro = i;
      break;
    }
  const open = lines.findIndex((l, i) => i > end && i < intro && FENCE.test(l));
  if (open === -1) {
    const moved = SKOPE_KEYS.filter((k) => Object.hasOwn(fm, k));
    errors.push(
      mkErr(
        "E-NOT-RUNNABLE",
        1,
        moved.length > 0
          ? `${moved.map((k) => `\`${k}\``).join(", ")} ${moved.length > 1 ? "are" : "is"} in the frontmatter: move ${moved.length > 1 ? "them" : "it"} into a \`\`\`skope block after the title (SPEC §3.1), since agents never see frontmatter and claude.ai rejects unknown frontmatter keys`
          : "no ```skope block with `format: 1` before the first section",
      ),
    );
    return result;
  }
  const fence = (FENCE.exec(lines[open] as string) as RegExpExecArray)[1] as string;
  const closeAt = lines.findIndex(
    (l, i) => i > open && l.trim().startsWith(fence[0] as string) && /^(`{3,}|~{3,})$/.test(l.trim()) && l.trim().length >= fence.length,
  );
  if (closeAt === -1) {
    errors.push(mkErr("E-FRONTMATTER", open + 1, "the skope block isn't closed"));
    return result;
  }
  const again = lines.findIndex((l, i) => i > closeAt && i < intro && FENCE.test(l));
  if (again !== -1) {
    errors.push(mkErr("E-FRONTMATTER", again + 1, "a skill has one skope block"));
    return result;
  }
  const blockLines = lines.slice(open + 1, closeAt);
  const block = loadMapping(blockLines, open + 2, "the skope block", errors);
  if (block === null) return result;
  if (block.format !== 1) {
    errors.push(mkErr("E-FRONTMATTER", open + 1, "the skope block needs `format: 1`"));
    return result;
  }
  result.notRunnable = false;
  result.bodyStart = end + 1;
  result.blockLine = open + 1;
  result.noted = lines.some((l, i) => i > end && i < intro && (i < open || i > closeAt) && /\bskope\b/i.test(l));

  const fmAt = keyLines(fmLines, 2);
  const at = keyLines(blockLines, open + 2);
  const lineOf = (key: string, parent?: string) => at.get(key) ?? (parent === undefined ? undefined : at.get(parent)) ?? open + 1;
  const bad = (key: string, message: string, parent?: string) => errors.push(mkErr("E-FRONTMATTER", lineOf(key, parent), message));
  const badFm = (key: string, message: string) => errors.push(mkErr("E-FRONTMATTER", fmAt.get(key) ?? 1, message));

  for (const key of Object.keys(fm)) {
    if (SPEC_KEYS.includes(key)) continue;
    if (SKOPE_KEYS.includes(key)) badFm(key, `\`${key}\` goes in the skope block, not the frontmatter (SPEC §3.1)`);
    else
      badFm(
        key,
        `\`${key}\` isn't an Agent Skills frontmatter key, so claude.ai rejects the skill (allowed: ${SPEC_KEYS.join(", ")}); put your own data under \`metadata\``,
      );
  }
  for (const key of Object.keys(block))
    if (!SKOPE_KEYS.includes(key)) bad(key, `unknown key \`${key}\` in the skope block (${SKOPE_KEYS.join(", ")})`);

  if (typeof fm.name === "string" && /^[a-z0-9-]+$/.test(fm.name)) result.skill = fm.name;
  else badFm("name", "`name` is required and must match [a-z0-9-]+");

  if (typeof fm.description !== "string" || fm.description.trim() === "" || fm.description.includes("\n")) {
    badFm("description", "`description` is required and must be one line");
  }

  const doc = block;
  if (doc.entry !== undefined) {
    const section = typeof doc.entry === "string" ? sectionId(doc.entry) : "s:";
    if (section === "s:") bad("entry", "`entry` must name a section");
    else result.entry = { section, src: lineOf("entry") };
  }

  if (doc.params !== undefined) {
    if (!isMapping(doc.params)) bad("params", "`params` must be a mapping");
    else {
      for (const [name, value] of Object.entries(doc.params)) {
        const src = lineOf(`params.${name}`, "params");
        const scalar = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v)) || typeof v === "string";
        if (!/^[a-z_][a-z0-9_]*$/.test(name)) bad(`params.${name}`, `param name "${name}" doesn't match [a-z_][a-z0-9_]*`, "params");
        else if (isMapping(value)) {
          // `name: { default: x, choices: [x, y] }`: the param can only be one of its choices.
          const { default: d, choices, ...rest } = value;
          const extra = Object.keys(rest);
          if (extra.length > 0) bad(`params.${name}`, `param "${name}" has unknown key ${extra[0]} (default, choices)`, "params");
          else if (!Array.isArray(choices) || choices.length === 0 || !choices.every(scalar))
            bad(`params.${name}`, `param "${name}": choices must be a non-empty list of strings or integers`, "params");
          else if (!scalar(d)) bad(`params.${name}`, `param "${name}" needs a default, a string or an integer`, "params");
          else if (!choices.every((c) => typeof c === typeof d))
            bad(`params.${name}`, `param "${name}": every choice must be the same type as its default`, "params");
          else if (!choices.includes(d)) bad(`params.${name}`, `param "${name}": its default ${d} isn't one of its choices`, "params");
          else {
            result.params.push([name, typeof d === "number" ? { int: d, src } : { str: d as string, src }]);
            result.choices[name] = [...new Set(choices as (string | number)[])];
          }
        } else if (typeof value === "number" && Number.isSafeInteger(value)) result.params.push([name, { int: value, src }]);
        else if (typeof value === "string") result.params.push([name, { str: value, src }]);
        else bad(`params.${name}`, `param "${name}" must be a string or an integer within ±(2^53 − 1)`, "params");
      }
    }
  }

  if (doc.limits !== undefined) {
    if (!isMapping(doc.limits)) bad("limits", "`limits` must be a mapping");
    else {
      for (const [key, value] of Object.entries(doc.limits)) {
        const target = Object.hasOwn(DURATIONS, key) ? DURATIONS[key] : undefined;
        const n = target ? parseDurationMs(value) : key === "ask_context" ? parseTokens(value) : null;
        if (n !== null) limits[target ?? "ask_context_tokens"] = n;
        else if (target)
          bad(`limits.${key}`, `\`${key}\` must be a duration from 1s to 596h (2^31 − 1 ms), like "30s", "5m" or "1h"`, "limits");
        else if (key === "ask_context") bad(`limits.${key}`, '`ask_context` must be a positive size, like "4k tokens"', "limits");
        else bad(`limits.${key}`, `unknown limit \`${key}\` (run_timeout, do_timeout, deadline, ask_context)`, "limits");
      }
    }
  }
  return result;
}
