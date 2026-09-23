// Config loading (SPEC §9): `$XDG_CONFIG_HOME/skop/config.yaml`. A missing
// file at the default path means all defaults. Anything else wrong is
// E-CONFIG, never a silent default: an unreadable file, a --config path
// that doesn't exist, invalid YAML, an unknown key at any level, a wrong
// type or out-of-range value, or the selected backend with no config block.

import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { compilePattern } from "./redact.js";

// js-yaml ships no type declarations for this project's TS setup; treated
// as untyped at the boundary, like the generated Dafny code in core.ts.
const require = createRequire(import.meta.url);
const loadYaml: (s: string) => unknown = require("js-yaml").load;

export class ConfigError extends Error {
  readonly code = "E-CONFIG";
}

export type Backend = "jev" | "openrouter" | "fake";

export interface Config {
  ask: { backend: Backend; timeout_ms: number; retries: number };
  jev?: { model: string; key_env: string };
  openrouter?: { model: string; key_env: string; min_mass: number };
  pager?: { command: string; timeout_ms: number };
  redact: { defaults: boolean; patterns: string[] };
  on_handoff: "page" | "none";
  state_dir: string;
}

/** An XDG base directory: the variable if it's an absolute path (relative ones are ignored, per the XDG spec), else `~/<fallback>`. */
function xdgBase(name: string, fallback: string): string {
  const v = process.env[name];
  return v && isAbsolute(v) ? v : join(homedir(), fallback);
}

export function defaultConfigPath(): string {
  return join(xdgBase("XDG_CONFIG_HOME", ".config"), "skop", "config.yaml");
}

function fail(message: string): never {
  throw new ConfigError(message);
}

type Obj = Record<string, unknown>;
const MAX_MS = 2 ** 31 - 1;

/** A mapping with no keys but `allowed`. */
function mapping(v: unknown, what: string, allowed: readonly string[]): Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail(`${what} must be a mapping`);
  for (const k of Object.keys(v)) if (!allowed.includes(k)) fail(`unknown key ${what === "config" ? k : `${what}.${k}`}`);
  return v as Obj;
}
const str = (v: unknown, what: string): string => (typeof v === "string" && v.length > 0 ? v : fail(`${what} must be a non-empty string`));
const bool = (v: unknown, what: string): boolean => (typeof v === "boolean" ? v : fail(`${what} must be true or false`));
function int(v: unknown, what: string, min: number, max: number): number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max
    ? v
    : fail(`${what} must be an integer from ${min} to ${max}`);
}
const ms = (v: unknown, what: string) => int(v, what, 1, MAX_MS);

/** `state_dir` (SPEC §9): a leading `$XDG_STATE_HOME` or `~` is expanded, and the result must be absolute. */
function expandStateDir(v: string): string {
  const xdg = /^\$XDG_STATE_HOME(?=\/|$)/.exec(v);
  const p = xdg
    ? join(xdgBase("XDG_STATE_HOME", ".local/state"), v.slice(xdg[0].length))
    : /^~(?=\/|$)/.test(v)
      ? join(homedir(), v.slice(1))
      : v;
  return isAbsolute(p) ? p : fail(`state_dir must be an absolute path, got ${v}`);
}

/** Reads the file once; null when it's missing and missing is allowed. */
function readConfigFile(path: string, missingOk: boolean, warn: (message: string) => void): string | null {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT" && missingOk) return null;
    fail(`can't read config at ${path}: ${(err as Error).message}`);
  }
  try {
    // pager.command runs through sh, so whoever can write this file can
    // run commands as skop. World-writable is refused; a looser group or
    // another owner is warned about (SSH-style, root counts as trusted).
    const st = fstatSync(fd);
    if (!st.isFile()) fail(`config path isn't a file: ${path}`);
    if (st.mode & 0o002) fail(`config at ${path} is world-writable; anyone could set pager.command`);
    if (st.mode & 0o020) warn(`config at ${path} is group-writable; its group can set pager.command`);
    const euid = process.geteuid?.();
    if (euid !== undefined && st.uid !== euid && st.uid !== 0)
      warn(`config at ${path} is owned by uid ${st.uid}, not ${euid}; its owner can set pager.command`);
    return readFileSync(fd, "utf8");
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    fail(`can't read config at ${path}: ${(err as Error).message}`);
  } finally {
    closeSync(fd);
  }
}

/**
 * Loads the config. `path` is the `--config` argument: when given, it
 * must exist. Without it, the default path is used and may be missing.
 * `warn` gets non-fatal findings, such as a group-writable file.
 */
export function loadConfig(path?: string, warn: (message: string) => void = () => {}): Config {
  const cfg: Config = {
    ask: { backend: "jev", timeout_ms: 2000, retries: 1 },
    redact: { defaults: true, patterns: [] },
    on_handoff: "page",
    state_dir: join(xdgBase("XDG_STATE_HOME", ".local/state"), "skop"),
  };
  const file = path ?? defaultConfigPath();
  const text = readConfigFile(file, path === undefined, warn);
  if (text === null) return cfg;

  let parsed: unknown;
  try {
    parsed = loadYaml(text);
  } catch (err) {
    fail(`invalid YAML in ${file}: ${(err as Error).message}`);
  }
  const doc = mapping(parsed ?? {}, "config", ["ask", "jev", "openrouter", "pager", "redact", "on_handoff", "state_dir"]);

  if (doc.ask !== undefined) {
    const a = mapping(doc.ask, "ask", ["backend", "timeout_ms", "retries"]);
    if (a.backend !== undefined) {
      const b = str(a.backend, "ask.backend");
      if (b !== "jev" && b !== "openrouter" && b !== "fake") fail(`ask.backend must be jev, openrouter or fake, got ${b}`);
      cfg.ask.backend = b;
    }
    if (a.timeout_ms !== undefined) cfg.ask.timeout_ms = ms(a.timeout_ms, "ask.timeout_ms");
    if (a.retries !== undefined) cfg.ask.retries = int(a.retries, "ask.retries", 0, 3);
  }

  if (doc.jev !== undefined) {
    const j = mapping(doc.jev, "jev", ["model", "key_env"]);
    cfg.jev = { model: str(j.model, "jev.model"), key_env: str(j.key_env, "jev.key_env") };
  }

  if (doc.openrouter !== undefined) {
    const o = mapping(doc.openrouter, "openrouter", ["model", "key_env", "min_mass"]);
    const m = o.min_mass ?? 0.5;
    if (typeof m !== "number" || !(m > 0 && m <= 1)) fail("openrouter.min_mass must be a number greater than 0 and at most 1");
    cfg.openrouter = { model: str(o.model, "openrouter.model"), key_env: str(o.key_env, "openrouter.key_env"), min_mass: m };
  }

  if (cfg.ask.backend !== "fake" && cfg[cfg.ask.backend] === undefined) {
    fail(`ask.backend is ${cfg.ask.backend}, but the config has no ${cfg.ask.backend} block`);
  }

  if (doc.pager !== undefined) {
    const p = mapping(doc.pager, "pager", ["command", "timeout_ms"]);
    cfg.pager = {
      command: str(p.command, "pager.command"),
      timeout_ms: p.timeout_ms === undefined ? 10000 : ms(p.timeout_ms, "pager.timeout_ms"),
    };
  }

  if (doc.redact !== undefined) {
    const r = mapping(doc.redact, "redact", ["defaults", "patterns"]);
    if (r.defaults !== undefined) cfg.redact.defaults = bool(r.defaults, "redact.defaults");
    if (r.patterns !== undefined) {
      if (!Array.isArray(r.patterns)) fail("redact.patterns must be a list");
      cfg.redact.patterns = r.patterns.map((p, i) => {
        const s = str(p, `redact.patterns[${i}]`);
        try {
          compilePattern(s);
        } catch (err) {
          fail(`redact.patterns[${i}] isn't a valid pattern: ${(err as Error).message}`);
        }
        return s;
      });
    }
  }

  if (doc.on_handoff !== undefined) {
    const h = str(doc.on_handoff, "on_handoff");
    if (h !== "page" && h !== "none") fail(`on_handoff must be page or none, got ${h}`);
    cfg.on_handoff = h;
  }

  if (doc.state_dir !== undefined)
    cfg.state_dir = expandStateDir(typeof doc.state_dir === "string" ? doc.state_dir : fail("state_dir must be a string"));

  return cfg;
}
