// Config loading (SPEC §9): $XDG_CONFIG_HOME/skop/config.yaml, defaults
// filled in, and E-CONFIG when the file is unreadable or invalid.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ConfigError, defaultConfigPath, loadConfig } from "../../src/runner/config.js";

let dir: string;
function freshDir() {
  dir = mkdtempSync(join(tmpdir(), "skop-config-test-"));
  return dir;
}
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function write(name: string, contents: string) {
  const p = join(freshDir(), name);
  writeFileSync(p, contents);
  return p;
}

describe("loadConfig (SPEC §9)", () => {
  test("loads a full config with the shape in the spec", () => {
    const p = write(
      "config.yaml",
      [
        "ask:",
        "  backend: jev",
        "  timeout_ms: 2000",
        "  retries: 1",
        "jev:",
        "  model: jev-1.13.0",
        "  key_env: TYPESAFE_API_KEY",
        "pager:",
        "  command: notify-send",
        "  timeout_ms: 10000",
        "redact:",
        "  defaults: true",
        "  patterns:",
        "    - 'myco-[0-9a-f]{32}'",
        "on_handoff: page",
        "state_dir: /tmp/skop-state",
        "",
      ].join("\n"),
    );
    const cfg = loadConfig(p);
    expect(cfg.ask).toEqual({ backend: "jev", timeout_ms: 2000, retries: 1 });
    expect(cfg.jev).toEqual({ model: "jev-1.13.0", key_env: "TYPESAFE_API_KEY" });
    expect(cfg.pager).toEqual({ command: "notify-send", timeout_ms: 10000 });
    expect(cfg.redact).toEqual({ defaults: true, patterns: ["myco-[0-9a-f]{32}"] });
    expect(cfg.on_handoff).toBe("page");
    expect(cfg.state_dir).toBe("/tmp/skop-state");
  });

  test("a missing config file loads all spec defaults", () => {
    const cfg = loadConfig(join(freshDir(), "does-not-exist.yaml"));
    expect(cfg.ask).toEqual({ backend: "jev", timeout_ms: 2000, retries: 1 });
    expect(cfg.redact).toEqual({ defaults: true, patterns: [] });
    expect(cfg.on_handoff).toBe("page");
  });

  test("a config path that is a directory is E-CONFIG (unreadable)", () => {
    const d = freshDir();
    expect(() => loadConfig(d)).toThrow(ConfigError);
    try {
      loadConfig(d);
      expect.unreachable();
    } catch (e) {
      expect((e as ConfigError).code).toBe("E-CONFIG");
    }
  });

  test("malformed YAML is E-CONFIG (invalid)", () => {
    const p = write("config.yaml", "ask: [this is not\n  valid: yaml::: -\n");
    expect(() => loadConfig(p)).toThrow(ConfigError);
  });

  test("ask.retries outside 0-3 is E-CONFIG (SPEC §6.2)", () => {
    const p = write("config.yaml", "ask:\n  retries: 4\n");
    expect(() => loadConfig(p)).toThrow(ConfigError);
  });

  test("ask.retries negative is E-CONFIG", () => {
    const p = write("config.yaml", "ask:\n  retries: -1\n");
    expect(() => loadConfig(p)).toThrow(ConfigError);
  });

  test("an unknown ask.backend is E-CONFIG", () => {
    const p = write("config.yaml", "ask:\n  backend: not-a-backend\n");
    expect(() => loadConfig(p)).toThrow(ConfigError);
  });

  test("a wrong-typed field is E-CONFIG", () => {
    const p = write("config.yaml", "ask:\n  timeout_ms: 'soon'\n");
    expect(() => loadConfig(p)).toThrow(ConfigError);
  });

  test("an invalid on_handoff value is E-CONFIG", () => {
    const p = write("config.yaml", "on_handoff: maybe\n");
    expect(() => loadConfig(p)).toThrow(ConfigError);
  });

  test("an invalid custom redact pattern is E-CONFIG", () => {
    const p = write("config.yaml", "redact:\n  patterns:\n    - '(unclosed'\n");
    expect(() => loadConfig(p)).toThrow(ConfigError);
  });

  test("defaultConfigPath honours XDG_CONFIG_HOME", () => {
    const prev = process.env.XDG_CONFIG_HOME;
    try {
      process.env.XDG_CONFIG_HOME = "/xdg-config";
      expect(defaultConfigPath()).toBe("/xdg-config/skop/config.yaml");
    } finally {
      if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prev;
    }
  });

  test("defaultConfigPath falls back when XDG_CONFIG_HOME is unset", () => {
    const prev = process.env.XDG_CONFIG_HOME;
    try {
      delete process.env.XDG_CONFIG_HOME;
      expect(defaultConfigPath().endsWith("/skop/config.yaml")).toBe(true);
    } finally {
      if (prev !== undefined) process.env.XDG_CONFIG_HOME = prev;
    }
  });
});
