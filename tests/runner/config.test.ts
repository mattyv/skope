// Config loading (SPEC §9): $XDG_CONFIG_HOME/skop/config.yaml, defaults
// filled in, and E-CONFIG for everything else that's wrong: never a silent
// default.

import { chmodSync, chownSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ConfigError, defaultConfigPath, loadConfig } from "../../src/runner/config.js";

let dir: string;
const savedEnv = { ...process.env };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "skop-config-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const k of ["XDG_CONFIG_HOME", "XDG_STATE_HOME"]) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function write(contents: string, name = "config.yaml") {
  const p = join(dir, name);
  writeFileSync(p, contents, { mode: 0o600 });
  return p;
}

const FAKE = "ask:\n  backend: fake\n";

function configError(p: string | undefined): ConfigError {
  try {
    loadConfig(p);
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    expect((e as ConfigError).code).toBe("E-CONFIG");
    return e as ConfigError;
  }
  throw new Error("expected E-CONFIG");
}

describe("loadConfig (SPEC §9)", () => {
  test("loads a full config with the shape in the spec", () => {
    const p = write(
      [
        "ask:",
        "  backend: jev",
        "  timeout_ms: 2000",
        "  retries: 1",
        "jev:",
        "  model: jev-1.13.0",
        "  key_env: TYPESAFE_API_KEY",
        "openrouter:",
        "  model: some/model",
        "  key_env: OPENROUTER_API_KEY",
        "  min_mass: 0.7",
        "pager:",
        "  command: notify-send",
        "  timeout_ms: 9000",
        "redact:",
        "  defaults: true",
        "  patterns:",
        "    - 'myco-[0-9a-f]{32}'",
        "on_handoff: none",
        "state_dir: /tmp/skop-state",
        "",
      ].join("\n"),
    );
    const cfg = loadConfig(p);
    expect(cfg.ask).toEqual({ backend: "jev", timeout_ms: 2000, retries: 1 });
    expect(cfg.jev).toEqual({ model: "jev-1.13.0", key_env: "TYPESAFE_API_KEY" });
    expect(cfg.openrouter).toEqual({ model: "some/model", key_env: "OPENROUTER_API_KEY", min_mass: 0.7 });
    expect(cfg.pager).toEqual({ command: "notify-send", timeout_ms: 9000 });
    expect(cfg.redact).toEqual({ defaults: true, patterns: ["myco-[0-9a-f]{32}"] });
    expect(cfg.on_handoff).toBe("none");
    expect(cfg.state_dir).toBe("/tmp/skop-state");
  });

  test("a missing config file at the default path loads all spec defaults", () => {
    process.env.XDG_CONFIG_HOME = dir;
    process.env.XDG_STATE_HOME = "/xdg-state";
    const cfg = loadConfig();
    expect(cfg.ask).toEqual({ backend: "jev", timeout_ms: 2000, retries: 1 });
    expect(cfg.redact).toEqual({ defaults: true, patterns: [] });
    expect(cfg.on_handoff).toBe("page");
    expect(cfg.state_dir).toBe("/xdg-state/skop");
  });

  test("the default path, when it exists, is read", () => {
    process.env.XDG_CONFIG_HOME = dir;
    mkdirSync(join(dir, "skop"));
    write(`${FAKE}on_handoff: none\n`, "skop/config.yaml");
    expect(loadConfig().on_handoff).toBe("none");
  });

  test("an explicit --config path that doesn't exist is E-CONFIG (P2-10)", () => {
    expect(configError(join(dir, "does-not-exist.yaml")).message).toMatch(/does-not-exist/);
  });

  test("a config path that is a directory is E-CONFIG (unreadable)", () => {
    configError(dir);
  });

  test.skipIf(process.getuid?.() === 0)("an unreadable config file is E-CONFIG", () => {
    const p = write(FAKE);
    chmodSync(p, 0);
    configError(p);
  });

  test("malformed YAML is E-CONFIG (invalid)", () => {
    configError(write("ask: [this is not\n  valid: yaml::: -\n"));
  });

  test("a document that isn't a mapping is E-CONFIG", () => {
    configError(write("- a\n- b\n"));
  });

  test.each([
    ["top level", `${FAKE}colour: blue\n`],
    ["ask", "ask:\n  backend: fake\n  timeout: 5\n"],
    ["jev", `${FAKE}jev:\n  model: m\n  key_env: K\n  url: http://x\n`],
    ["openrouter", `${FAKE}openrouter:\n  model: m\n  key_env: K\n  minmass: 0.5\n`],
    ["pager", `${FAKE}pager:\n  command: cat\n  timeout: 5\n`],
    ["redact", `${FAKE}redact:\n  default: false\n`],
  ])("an unknown key (%s) is E-CONFIG (P2-11)", (_where, yaml) => {
    configError(write(yaml));
  });

  test.each([
    ["jev (named)", "ask:\n  backend: jev\n"],
    ["jev (the default)", "on_handoff: page\n"],
    ["openrouter", "ask:\n  backend: openrouter\n"],
  ])("S6: the selected backend without its config block still loads; a run that asks checks it: %s", (_what, yaml) => {
    const c = loadConfig(write(yaml));
    expect(c.jev).toBeUndefined();
    expect(c.openrouter).toBeUndefined();
  });

  test("the fake backend needs no block", () => {
    expect(loadConfig(write(FAKE)).ask.backend).toBe("fake");
  });

  test("ask.retries outside 0-3 is E-CONFIG (SPEC §6.2)", () => {
    configError(write("ask:\n  backend: fake\n  retries: 4\n"));
    configError(write("ask:\n  backend: fake\n  retries: -1\n"));
    configError(write("ask:\n  backend: fake\n  retries: 1.5\n"));
  });

  test("an unknown ask.backend is E-CONFIG", () => {
    configError(write("ask:\n  backend: not-a-backend\n"));
  });

  test("a wrong-typed field is E-CONFIG", () => {
    configError(write("ask:\n  backend: fake\n  timeout_ms: 'soon'\n"));
    configError(write(`${FAKE}redact:\n  defaults: 'no'\n`));
    configError(write(`${FAKE}pager:\n  command: 5\n`));
  });

  test.each([
    ["ask.timeout_ms 0", "ask:\n  backend: fake\n  timeout_ms: 0\n"],
    ["ask.timeout_ms 2^31", "ask:\n  backend: fake\n  timeout_ms: 2147483648\n"],
    ["pager.timeout_ms 0", `${FAKE}pager:\n  command: cat\n  timeout_ms: 0\n`],
    ["pager.timeout_ms 2^31", `${FAKE}pager:\n  command: cat\n  timeout_ms: 2147483648\n`],
  ])("a timeout out of 1..2^31-1 ms is E-CONFIG (P2-7): %s", (_what, yaml) => {
    configError(write(yaml));
  });

  test("the largest timeout, 2^31-1 ms, is accepted", () => {
    const cfg = loadConfig(write(`ask:\n  backend: fake\n  timeout_ms: 2147483647\npager:\n  command: cat\n  timeout_ms: 2147483647\n`));
    expect(cfg.ask.timeout_ms).toBe(2 ** 31 - 1);
    expect(cfg.pager?.timeout_ms).toBe(2 ** 31 - 1);
  });

  test("pager.timeout_ms defaults to 10000", () => {
    expect(loadConfig(write(`${FAKE}pager:\n  command: cat\n`)).pager).toEqual({ command: "cat", timeout_ms: 10000 });
  });

  test("openrouter.min_mass defaults to 0.5", () => {
    expect(loadConfig(write(`${FAKE}openrouter:\n  model: m\n  key_env: K\n`)).openrouter?.min_mass).toBe(0.5);
  });

  test.each(["'0.5'", "0", "-0.1", "1.5", ".nan", "true"])("openrouter.min_mass %s is E-CONFIG: a number with 0 < m <= 1", (v) => {
    configError(write(`${FAKE}openrouter:\n  model: m\n  key_env: K\n  min_mass: ${v}\n`));
  });

  test("openrouter.min_mass of 1 is accepted", () => {
    expect(loadConfig(write(`${FAKE}openrouter:\n  model: m\n  key_env: K\n  min_mass: 1\n`)).openrouter?.min_mass).toBe(1);
  });

  test("an invalid on_handoff value is E-CONFIG", () => {
    configError(write(`${FAKE}on_handoff: maybe\n`));
  });

  test("an invalid custom redact pattern is E-CONFIG", () => {
    configError(write(`${FAKE}redact:\n  patterns:\n    - '(unclosed'\n`));
  });

  test("a custom redact pattern that matches the empty string is E-CONFIG", () => {
    expect(configError(write(`${FAKE}redact:\n  patterns:\n    - 'x*'\n`)).message).toMatch(/empty/);
  });

  test("a custom redact pattern may start with (?i)", () => {
    expect(loadConfig(write(`${FAKE}redact:\n  patterns:\n    - '(?i)myco-[0-9a-f]{4}'\n`)).redact.patterns).toEqual([
      "(?i)myco-[0-9a-f]{4}",
    ]);
  });

  describe("state_dir (P2-12)", () => {
    test("a leading $XDG_STATE_HOME is expanded", () => {
      process.env.XDG_STATE_HOME = "/xs";
      expect(loadConfig(write(`${FAKE}state_dir: $XDG_STATE_HOME/skop\n`)).state_dir).toBe("/xs/skop");
    });

    test("an unset or relative XDG_STATE_HOME means ~/.local/state (XDG spec)", () => {
      delete process.env.XDG_STATE_HOME;
      expect(loadConfig(write(`${FAKE}state_dir: $XDG_STATE_HOME/skop\n`)).state_dir).toBe(join(homedir(), ".local/state/skop"));
      process.env.XDG_STATE_HOME = "relative/state";
      expect(loadConfig(write(`${FAKE}state_dir: $XDG_STATE_HOME/skop\n`)).state_dir).toBe(join(homedir(), ".local/state/skop"));
      expect(loadConfig(write(FAKE)).state_dir).toBe(join(homedir(), ".local/state/skop"));
    });

    test("a leading ~ is expanded", () => {
      expect(loadConfig(write(`${FAKE}state_dir: ~/skop-state\n`)).state_dir).toBe(join(homedir(), "skop-state"));
      expect(loadConfig(write(`${FAKE}state_dir: "~"\n`)).state_dir).toBe(homedir());
    });

    test.each(["relative/dir", "$XDG_STATE_HOMEX/skop", "~other/x", "''"])(
      "a state_dir that isn't absolute after expansion is E-CONFIG: %s",
      (v) => {
        process.env.XDG_STATE_HOME = "/xs";
        configError(write(`${FAKE}state_dir: ${v}\n`));
      },
    );
  });

  describe("file permissions (pager.command runs through sh)", () => {
    test("a world-writable config file is E-CONFIG", () => {
      const p = write(FAKE);
      chmodSync(p, 0o666);
      expect(configError(p).message).toMatch(/writable/);
    });

    test("a group-writable config file loads, with a warning", () => {
      const p = write(FAKE);
      chmodSync(p, 0o660);
      const warnings: string[] = [];
      expect(loadConfig(p, (w) => warnings.push(w)).ask.backend).toBe("fake");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/group-writable/);
    });

    test("a private config file loads with no warning", () => {
      const warnings: string[] = [];
      loadConfig(write(FAKE), (w) => warnings.push(w));
      expect(warnings).toEqual([]);
    });

    test.skipIf(process.getuid?.() !== 0)("a config file owned by another user loads, with a warning (needs root to set up)", () => {
      const p = write(FAKE);
      chownSync(p, 12345, 12345);
      const warnings: string[] = [];
      loadConfig(p, (w) => warnings.push(w));
      expect(warnings.join("\n")).toMatch(/owned by uid 12345/);
    });
  });
});

describe("defaultConfigPath", () => {
  test("honours XDG_CONFIG_HOME", () => {
    process.env.XDG_CONFIG_HOME = "/xdg-config";
    expect(defaultConfigPath()).toBe("/xdg-config/skop/config.yaml");
  });

  test("falls back to ~/.config when XDG_CONFIG_HOME is unset or relative (XDG spec)", () => {
    delete process.env.XDG_CONFIG_HOME;
    expect(defaultConfigPath()).toBe(join(homedir(), ".config/skop/config.yaml"));
    process.env.XDG_CONFIG_HOME = "relative/config";
    expect(defaultConfigPath()).toBe(join(homedir(), ".config/skop/config.yaml"));
  });
});
