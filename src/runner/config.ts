// Config loading (SPEC §9): `$XDG_CONFIG_HOME/skop/config.yaml`, with the
// OS temp/home fallback for XDG_CONFIG_HOME. Missing entirely means all
// defaults; present but unreadable or invalid is E-CONFIG.

import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

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

export function defaultConfigPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "skop", "config.yaml");
}

function defaultStateDir(): string {
  const xdg = process.env.XDG_STATE_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".local", "state");
  return join(base, "skop");
}

function fail(message: string): never {
  throw new ConfigError(message);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, what: string): string => (typeof v === "string" ? v : fail(`${what} must be a string`));
const bool = (v: unknown, what: string): boolean => (typeof v === "boolean" ? v : fail(`${what} must be a boolean`));
const int = (v: unknown, what: string): number => (typeof v === "number" && Number.isInteger(v) ? v : fail(`${what} must be an integer`));

export function loadConfig(path: string): Config {
  const defaults: Config = {
    ask: { backend: "jev", timeout_ms: 2000, retries: 1 },
    redact: { defaults: true, patterns: [] },
    on_handoff: "page",
    state_dir: defaultStateDir(),
  };

  let stat: ReturnType<typeof statSync> | undefined;
  try {
    stat = statSync(path);
  } catch {
    return defaults; // no config file: all defaults.
  }
  if (!stat.isFile()) fail(`config path isn't a file: ${path}`);

  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new ConfigError(`can't read config at ${path}: ${(err as Error).message}`);
  }

  let doc: unknown;
  try {
    doc = loadYaml(text);
  } catch (err) {
    throw new ConfigError(`invalid YAML in ${path}: ${(err as Error).message}`);
  }
  if (doc === null || doc === undefined) return defaults;
  if (!isObj(doc)) fail(`config must be a YAML mapping: ${path}`);

  const cfg: Config = structuredClone(defaults);

  if ("ask" in doc) {
    const a = doc.ask;
    if (!isObj(a)) fail("ask must be a mapping");
    if ("backend" in a) {
      const b = str(a.backend, "ask.backend");
      if (b !== "jev" && b !== "openrouter" && b !== "fake") fail(`ask.backend must be jev, openrouter or fake, got ${b}`);
      cfg.ask.backend = b;
    }
    if ("timeout_ms" in a) cfg.ask.timeout_ms = int(a.timeout_ms, "ask.timeout_ms");
    if ("retries" in a) {
      const r = int(a.retries, "ask.retries");
      if (r < 0 || r > 3) fail(`ask.retries must be 0-3, got ${r}`);
      cfg.ask.retries = r;
    }
  }

  if ("jev" in doc) {
    const j = doc.jev;
    if (!isObj(j)) fail("jev must be a mapping");
    cfg.jev = { model: str(j.model, "jev.model"), key_env: str(j.key_env, "jev.key_env") };
  }

  if ("openrouter" in doc) {
    const o = doc.openrouter;
    if (!isObj(o)) fail("openrouter must be a mapping");
    cfg.openrouter = {
      model: str(o.model, "openrouter.model"),
      key_env: str(o.key_env, "openrouter.key_env"),
      min_mass: "min_mass" in o ? Number(o.min_mass) : 0.5,
    };
    if (Number.isNaN(cfg.openrouter.min_mass)) fail("openrouter.min_mass must be a number");
  }

  if ("pager" in doc) {
    const p = doc.pager;
    if (!isObj(p)) fail("pager must be a mapping");
    cfg.pager = { command: str(p.command, "pager.command"), timeout_ms: "timeout_ms" in p ? int(p.timeout_ms, "pager.timeout_ms") : 10000 };
  }

  if ("redact" in doc) {
    const r = doc.redact;
    if (!isObj(r)) fail("redact must be a mapping");
    if ("defaults" in r) cfg.redact.defaults = bool(r.defaults, "redact.defaults");
    if ("patterns" in r) {
      if (!Array.isArray(r.patterns)) fail("redact.patterns must be a list");
      cfg.redact.patterns = r.patterns.map((p, i) => {
        const s = str(p, `redact.patterns[${i}]`);
        try {
          new RegExp(s);
        } catch (err) {
          fail(`redact.patterns[${i}] isn't a valid pattern: ${(err as Error).message}`);
        }
        return s;
      });
    }
  }

  if ("on_handoff" in doc) {
    const h = str(doc.on_handoff, "on_handoff");
    if (h !== "page" && h !== "none") fail(`on_handoff must be page or none, got ${h}`);
    cfg.on_handoff = h;
  }

  if ("state_dir" in doc) cfg.state_dir = str(doc.state_dir, "state_dir");

  return cfg;
}
