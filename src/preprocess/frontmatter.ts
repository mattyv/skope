// Frontmatter parsing (SPEC §3.1). Duration/token units and per-field line
// numbers are decisions the contracts README makes explicit (durations in
// ms, `4k tokens` = 4000).

import { load as yamlLoad } from "js-yaml";
import type { ParseError } from "./errors.js";
import { mkErr } from "./errors.js";

export interface ParamDef {
  name: string;
  value: { str: string; src: number } | { int: number; src: number };
}

export interface Limits {
  run_timeout_ms: number;
  do_timeout_ms: number;
  deadline_ms: number;
  ask_context_tokens: number;
}

export interface Frontmatter {
  notRunnable: boolean;
  skill?: string;
  description?: string;
  entryName?: string;
  entryLine?: number;
  params: ParamDef[];
  limits: Limits;
  bodyStart: number; // 0-based index into `lines` where the body begins
}

function findLine(fmLines: string[], predicate: (line: string) => boolean): number | undefined {
  for (let i = 0; i < fmLines.length; i++) {
    if (predicate(fmLines[i] ?? "")) return i + 2; // fmLines[0] is absolute line 2
  }
  return undefined;
}

function parseDurationMs(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const m = /^(\d+)(s|m|h)$/.exec(s.trim());
  if (!m) return null;
  const mult = m[2] === "s" ? 1000 : m[2] === "m" ? 60_000 : 3_600_000;
  return Number(m[1]) * mult;
}

function parseTokens(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const m = /^(\d+)(k)?\s*tokens$/.exec(s.trim());
  if (!m) return null;
  return m[2] ? Number(m[1]) * 1000 : Number(m[1]);
}

export function parseFrontmatter(lines: string[], errors: ParseError[]): Frontmatter {
  const limits: Limits = { run_timeout_ms: 30_000, do_timeout_ms: 300_000, deadline_ms: 900_000, ask_context_tokens: 4000 };
  const result: Frontmatter = { notRunnable: false, params: [], limits, bodyStart: 0 };

  if ((lines[0] ?? "").trim() !== "---") {
    result.notRunnable = true;
    errors.push(mkErr("E-NOT-RUNNABLE", 1, "no `format: 1` in the frontmatter (the file has none)"));
    return result;
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? "").trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    errors.push(mkErr("E-FRONTMATTER", 1, "frontmatter isn't closed with `---`"));
    result.notRunnable = true;
    return result;
  }
  const fmLines = lines.slice(1, end);
  let doc: unknown;
  try {
    doc = yamlLoad(fmLines.join("\n"));
  } catch {
    errors.push(mkErr("E-FRONTMATTER", 1, "frontmatter isn't valid YAML"));
    result.notRunnable = true;
    return result;
  }
  result.bodyStart = end + 1;
  if (doc === null || typeof doc !== "object") {
    errors.push(mkErr("E-FRONTMATTER", 1, "frontmatter isn't a YAML mapping"));
    result.notRunnable = true;
    return result;
  }
  const fm = doc as Record<string, unknown>;

  if (fm.format !== 1) {
    result.notRunnable = true;
    errors.push(mkErr("E-NOT-RUNNABLE", 1, "no `format: 1` in the frontmatter"));
    return result;
  }

  if (typeof fm.name !== "string" || !/^[a-z0-9-]+$/.test(fm.name)) {
    errors.push(mkErr("E-FRONTMATTER", 1, "`name` is required and must match [a-z0-9-]+"));
  } else {
    result.skill = fm.name;
  }

  if (typeof fm.description !== "string" || fm.description.length === 0 || fm.description.includes("\n")) {
    errors.push(mkErr("E-FRONTMATTER", 1, "`description` is required and must be one line"));
  } else {
    result.description = fm.description;
  }

  if (fm.entry !== undefined) {
    if (typeof fm.entry !== "string") {
      errors.push(mkErr("E-FRONTMATTER", 1, "`entry` must be a string"));
    } else {
      result.entryName = fm.entry;
      result.entryLine = findLine(fmLines, (l) => /^entry:/.test(l)) ?? 1;
    }
  }

  if (fm.params !== undefined) {
    if (typeof fm.params !== "object" || fm.params === null) {
      errors.push(mkErr("E-FRONTMATTER", 1, "`params` must be a mapping"));
    } else {
      for (const [name, value] of Object.entries(fm.params as Record<string, unknown>)) {
        const line = findLine(fmLines, (l) => l.startsWith(`  ${name}:`)) ?? 1;
        if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
          errors.push(mkErr("E-FRONTMATTER", line, `param name "${name}" doesn't match [a-z_][a-z0-9_]*`));
          continue;
        }
        if (typeof value === "number" && Number.isInteger(value)) {
          result.params.push({ name, value: { int: value, src: line } });
        } else if (typeof value === "string") {
          result.params.push({ name, value: { str: value, src: line } });
        } else {
          errors.push(mkErr("E-FRONTMATTER", line, `param "${name}" must be an int or a string`));
        }
      }
    }
  }

  if (fm.limits !== undefined) {
    if (typeof fm.limits !== "object" || fm.limits === null) {
      errors.push(mkErr("E-FRONTMATTER", 1, "`limits` must be a mapping"));
    } else {
      const l = fm.limits as Record<string, unknown>;
      const durField = (key: string, target: keyof Limits) => {
        if (l[key] === undefined) return;
        const ms = parseDurationMs(l[key]);
        const line = findLine(fmLines, (line2) => line2.startsWith(`  ${key}:`)) ?? 1;
        if (ms === null) errors.push(mkErr("E-FRONTMATTER", line, `\`${key}\` isn't a valid duration (e.g. "30s")`));
        else limits[target] = ms;
      };
      durField("run_timeout", "run_timeout_ms");
      durField("do_timeout", "do_timeout_ms");
      durField("deadline", "deadline_ms");
      if (l.ask_context !== undefined) {
        const tokens = parseTokens(l.ask_context);
        const line = findLine(fmLines, (line2) => line2.startsWith("  ask_context:")) ?? 1;
        if (tokens === null) errors.push(mkErr("E-FRONTMATTER", line, '`ask_context` isn\'t a valid size (e.g. "4k tokens")'));
        else limits.ask_context_tokens = tokens;
      }
    }
  }

  return result;
}
