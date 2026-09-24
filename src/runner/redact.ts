// Redaction (SPEC §9), applied before anything leaves the machine or is
// logged. Built-in patterns are on unless `redact.defaults: false`, which
// is reported via `usingDefaults` so the caller can log W-REDACT-OFF.
//
// Anyone who can write a log line can write to this input (SPEC §11), so
// every built-in runs in linear time: each can start only at a boundary
// (a lookbehind), and no two unbounded repeats can trade characters.

const REPLACEMENT = "[REDACTED]";

const KEY_BEGIN = "-----BEGIN [A-Z ]*PRIVATE KEY-----";
const KEY_END = "-----END [A-Z ]*PRIVATE KEY-----";

// Order matters: private-key blocks span lines, so they go first, before
// anything that could slice into them. The key-value pattern is the spec's,
// anchored at the start of the name, with the name taken atomically (the
// `(?=(…))\1` idiom): the spec's `[a-z_]*(kw)[a-z_]*` backtracks
// quadratically over a long name.
const BUILTINS: RegExp[] = [
  // A complete block. The body can't contain another BEGIN, so a scan from
  // a BEGIN with no END stops at the next BEGIN.
  new RegExp(`${KEY_BEGIN}(?:(?!-----BEGIN )[\\s\\S])*?${KEY_END}`, "g"),
  // Every BEGIN left has no END: redact to the end of the text.
  new RegExp(`${KEY_BEGIN}[\\s\\S]*`),
  // Every END left has no BEGIN: redact from the start of the text.
  new RegExp(`^[\\s\\S]*${KEY_END}`),
  /AKIA[0-9A-Z]{16}/g,
  /bearer\s+\S+/gi,
  /(?<![\w-])eyJ[\w-]+\.[\w-]+\.[\w-]+/g,
  /(?<![a-z_])(?=([a-z_]*?(?:password|passwd|secret|token|api[_-]?key)[a-z_]*))\1["']?\s*[=:]\s*(?:"[^"]*"|'[^']*'|\S+)/gi,
  /:\/\/[^/\s:@]+:[^/\s@]+@/g,
];

/**
 * Compiles a custom pattern (SPEC §9): a leading `(?i)` becomes the `i`
 * flag, and a pattern that can match the empty string is rejected, since it
 * would redact nothing and mark every position. Throws on either problem.
 */
export function compilePattern(pattern: string): RegExp {
  const ci = pattern.startsWith("(?i)");
  const re = new RegExp(ci ? pattern.slice(4) : pattern, ci ? "gi" : "g");
  // Probes for an empty match: at the start, the end, and between word and
  // non-word characters, which covers anchors, lookarounds and \b.
  for (const probe of ["", "a", " ", "a b", "-a-", "A1_\n"]) {
    for (const m of probe.matchAll(re)) if (m[0] === "") throw new Error(`pattern can match the empty string: ${pattern}`);
  }
  return re;
}

const escapeLiteral = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface RedactOptions {
  defaults?: boolean;
  /** Custom patterns from `redact.patterns`, already validated by the config. */
  patterns?: string[];
  /** Values redacted literally: the backend key variables' values (SPEC §4.4). */
  literals?: string[];
}

export interface Redactor {
  usingDefaults: boolean;
  /**
   * Redacts the whole text. `truncated`: the capture cap cut the start, so
   * the partial first line is dropped first (SPEC §9).
   */
  redact(text: string, opts?: { truncated?: boolean }): string;
  /** Redacts the whole text, then keeps at most the last `maxBytes` bytes. */
  redactedTail(text: string, maxBytes: number, truncated?: boolean): string;
}

export function buildRedactor(opts: RedactOptions = {}): Redactor {
  const usingDefaults = opts.defaults !== false;
  const patterns = [
    // Literals first, before another pattern rewrites part of a key.
    ...(opts.literals ?? []).filter((s) => s.length > 0).map((s) => new RegExp(escapeLiteral(s), "g")),
    ...(usingDefaults ? BUILTINS : []),
    ...(opts.patterns ?? []).map(compilePattern),
  ];
  const redact = (text: string, o: { truncated?: boolean } = {}) => {
    const t = o.truncated ? text.slice(text.indexOf("\n") + 1 || text.length) : text;
    return patterns.reduce((acc, re) => acc.replace(re, REPLACEMENT), t);
  };
  return {
    usingDefaults,
    redact,
    redactedTail: (text, maxBytes, truncated = false) => tailBytes(redact(text, { truncated }), maxBytes),
  };
}

/**
 * Every string in a JSON value redacted, keys left as they are. For what
 * leaves skope as a whole (events, the handoff record); values used to run
 * commands are never passed through this.
 */
export function redactDeep<T>(r: Redactor, value: T): T {
  const walk = (v: unknown): unknown =>
    typeof v === "string"
      ? r.redact(v)
      : Array.isArray(v)
        ? v.map(walk)
        : v !== null && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
          : v;
  return walk(value) as T;
}

/** The last `maxBytes` bytes of `text` as UTF-8, starting on a character boundary. */
export function tailBytes(text: string, maxBytes: number): string {
  const b = Buffer.from(text, "utf8");
  if (b.length <= maxBytes) return text;
  let start = b.length - maxBytes;
  while (start < b.length && ((b[start] as number) & 0xc0) === 0x80) start++;
  return b.subarray(start).toString("utf8");
}
