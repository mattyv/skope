// A --test scenario's expect.yaml, checked by hand against
// contracts/expect.schema.json, as the fake files are (src/runner/fakes.ts);
// tests/runner/expect.test.ts checks the two agree.

export interface Expect {
  outcome?: "stopped" | "paged" | "handoff";
  exit?: number;
  path?: string[];
  path_prefix?: string[];
  asks?: Record<string, { chosen: string | number }>;
  page_contains?: string;
  handoff_reason?: "explicit" | "gate_failed" | "command_failed" | "ask_unavailable" | "deadline";
  max_ask_calls?: number;
  live?: { runs?: number; min_hit_rate?: number; min_margin?: number };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown) => typeof v === "number" && !(v % 1) && !Number.isNaN(v);
const nonEmpty = (v: unknown) => typeof v === "string" && v.length > 0;
const KEYS = ["outcome", "exit", "path", "path_prefix", "asks", "page_contains", "handoff_reason", "max_ask_calls", "live"];
const REASONS = ["explicit", "gate_failed", "command_failed", "ask_unavailable", "deadline"];

/** Why `doc` isn't a valid expect.yaml, or null if it is. */
export function expectError(doc: unknown): string | null {
  if (!isObj(doc)) return "the file must be a mapping";
  const extra = Object.keys(doc).find((k) => !KEYS.includes(k));
  if (extra !== undefined) return `unknown key ${extra}`;
  if (!["outcome", "exit", "path", "path_prefix"].some((k) => k in doc)) return "set at least one of outcome, exit, path or path_prefix";
  if ("path" in doc && "path_prefix" in doc) return "set path or path_prefix, not both";
  if ("outcome" in doc && !["stopped", "paged", "handoff"].includes(doc.outcome as string))
    return "outcome must be stopped, paged or handoff";
  if ("exit" in doc && !isInt(doc.exit)) return "exit must be an integer";
  for (const k of ["path", "path_prefix"])
    if (k in doc && !(Array.isArray(doc[k]) && (doc[k] as unknown[]).length > 0 && (doc[k] as unknown[]).every(nonEmpty)))
      return `${k} must be a list of section names`;
  if ("asks" in doc) {
    if (!isObj(doc.asks)) return "asks must be a mapping";
    for (const [key, a] of Object.entries(doc.asks)) {
      if (key === "") return "an asks key must not be empty";
      if (!isObj(a) || !("chosen" in a) || Object.keys(a).length !== 1) return `asks.${key} must have exactly chosen`;
      if (typeof a.chosen !== "string" && !isInt(a.chosen)) return `asks.${key}.chosen must be a label or a Score level`;
    }
  }
  if ("page_contains" in doc && !nonEmpty(doc.page_contains)) return "page_contains must be text";
  if ("handoff_reason" in doc && !REASONS.includes(doc.handoff_reason as string))
    return `handoff_reason must be one of ${REASONS.join(", ")}`;
  if ("max_ask_calls" in doc && !(isInt(doc.max_ask_calls) && (doc.max_ask_calls as number) >= 0))
    return "max_ask_calls must be a whole number of 0 or more";
  if ("live" in doc) {
    const l = doc.live;
    if (!isObj(l)) return "live must be a mapping";
    const lx = Object.keys(l).find((k) => !["runs", "min_hit_rate", "min_margin"].includes(k));
    if (lx !== undefined) return `unknown key live.${lx}`;
    if ("runs" in l && !(isInt(l.runs) && (l.runs as number) >= 1)) return "live.runs must be a whole number of 1 or more";
    if ("min_hit_rate" in l && !(typeof l.min_hit_rate === "number" && l.min_hit_rate >= 0 && l.min_hit_rate <= 1))
      return "live.min_hit_rate must be from 0 to 1";
    if ("min_margin" in l && typeof l.min_margin !== "number") return "live.min_margin must be a number";
  }
  return null;
}
