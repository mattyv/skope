// Frontmatter parsing (SPEC §3.1). Durations are in ms and `4k tokens` is
// 4000 (contracts/README.md). Every error points at its field's line.

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
  limits: Limits;
  bodyStart: number; // 0-based index into `lines` where the body begins
}

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
 * under it (`params.mount`), from the frontmatter's own lines. Block style
 * only; flow-style values fall back to their parent's line. */
function keyLines(fmLines: string[]): Map<string, number> {
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
      lines.set(key, i + 2); // fmLines[0] is line 2
    } else if (parent !== null) {
      childIndent ??= indent;
      if (indent === childIndent && !lines.has(`${parent}.${key}`)) lines.set(`${parent}.${key}`, i + 2);
    }
  });
  return lines;
}

const isMapping = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseFrontmatter(lines: string[], errors: ParseError[]): Frontmatter {
  const limits: Limits = { run_timeout_ms: 30_000, do_timeout_ms: 300_000, deadline_ms: 900_000, ask_context_tokens: 4000 };
  const result: Frontmatter = { notRunnable: true, params: [], limits, bodyStart: 0 };

  if ((lines[0] ?? "").trim() !== "---") {
    errors.push(mkErr("E-NOT-RUNNABLE", 1, "no `format: 1` in the frontmatter (the file has none)"));
    return result;
  }
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end === -1) {
    errors.push(mkErr("E-FRONTMATTER", 1, "frontmatter isn't closed with `---`"));
    return result;
  }
  const fmLines = lines.slice(1, end);
  let doc: unknown;
  try {
    doc = yamlLoad(fmLines.join("\n"));
  } catch (e) {
    const line = (e as { mark?: { line?: number } }).mark?.line;
    errors.push(mkErr("E-FRONTMATTER", typeof line === "number" ? Math.min(line + 2, end) : 1, "frontmatter isn't valid YAML"));
    return result;
  }
  if (!isMapping(doc)) {
    errors.push(mkErr("E-FRONTMATTER", 1, "frontmatter isn't a YAML mapping"));
    return result;
  }
  if (doc.format !== 1) {
    errors.push(mkErr("E-NOT-RUNNABLE", 1, "no `format: 1` in the frontmatter"));
    return result;
  }
  result.notRunnable = false;
  result.bodyStart = end + 1;
  const at = keyLines(fmLines);
  const lineOf = (key: string, parent?: string) => at.get(key) ?? (parent === undefined ? undefined : at.get(parent)) ?? 1;
  const bad = (key: string, message: string, parent?: string) => errors.push(mkErr("E-FRONTMATTER", lineOf(key, parent), message));

  if (typeof doc.name === "string" && /^[a-z0-9-]+$/.test(doc.name)) result.skill = doc.name;
  else bad("name", "`name` is required and must match [a-z0-9-]+");

  if (typeof doc.description !== "string" || doc.description.trim() === "" || doc.description.includes("\n")) {
    bad("description", "`description` is required and must be one line");
  }

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
        if (!/^[a-z_][a-z0-9_]*$/.test(name)) bad(`params.${name}`, `param name "${name}" doesn't match [a-z_][a-z0-9_]*`, "params");
        else if (typeof value === "number" && Number.isSafeInteger(value)) result.params.push([name, { int: value, src }]);
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
        else if (target) bad(`limits.${key}`, `\`${key}\` must be a duration from 1s to 596h (2^31 − 1 ms), like "30s", "5m" or "1h"`, "limits");
        else if (key === "ask_context") bad(`limits.${key}`, '`ask_context` must be a positive size, like "4k tokens"', "limits");
        else bad(`limits.${key}`, `unknown limit \`${key}\` (run_timeout, do_timeout, deadline, ask_context)`, "limits");
      }
    }
  }
  return result;
}
