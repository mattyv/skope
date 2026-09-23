// Redaction (SPEC §9), applied before anything leaves the machine. Built-in
// patterns are on unless `redact.defaults: false`, which is reported via
// `usingDefaults` so the caller can log W-REDACT-OFF.

const REPLACEMENT = "[REDACTED]";

// Order matters: the private-key block is multi-line, so it's matched
// before anything that could otherwise slice into it.
const BUILTINS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /AKIA[0-9A-Z]{16}/g,
  /bearer\s+\S+/gi,
  /eyJ[\w-]+\.[\w-]+\.[\w-]+/g,
  /(password|passwd|secret|token|api[_-]?key)\s*[=:]\s*\S+/gi,
  /:\/\/[^/\s:@]+:[^/\s@]+@/g,
];

export interface RedactOptions {
  defaults?: boolean;
  patterns?: string[];
}

export interface Redactor {
  usingDefaults: boolean;
  redact(text: string): string;
}

export function buildRedactor(opts: RedactOptions = {}): Redactor {
  const usingDefaults = opts.defaults !== false;
  const patterns = [...(usingDefaults ? BUILTINS : []), ...(opts.patterns ?? []).map((p) => new RegExp(p, "g"))];
  return {
    usingDefaults,
    redact(text: string): string {
      return patterns.reduce((t, re) => t.replace(re, REPLACEMENT), text);
    },
  };
}
