// The run flow end to end through the built CLI (SPEC §7, §8, §9): lock,
// runtime errors, config warnings, backend checks and redaction.

import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { runSkop, type SkopEvent } from "../acceptance/lib/cli.js";

const CLI = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

function skill(body: string, frontmatter = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "skop-skill-"));
  const path = join(dir, "SKILL.md");
  writeFileSync(path, `---\nname: tiny\ndescription: a test skill\nformat: 1\n${frontmatter}---\n\n## Main\nDo the thing.\n\n${body}\n`);
  return path;
}

function file(name: string, text: string, mode = 0o600): string {
  const path = join(mkdtempSync(join(tmpdir(), "skop-file-")), name);
  writeFileSync(path, text);
  chmodSync(path, mode);
  return path;
}

const find = (events: SkopEvent[], event: string, code?: string) =>
  events.find((e) => e.event === event && (code === undefined || e.code === code));

describe("run flow", () => {
  test("E-FAKE-UNMATCHED: a command --fake-exec has no answer for ends the run with error, exit 50", async () => {
    const r = await runSkop([skill("- **run** `df -h`\n- **stop**"), "--apply", "--fake-exec", file("c.yaml", "{}")]);
    expect(r.code).toBe(50);
    expect(find(r.events, "error", "E-FAKE-UNMATCHED")).toMatchObject({ stage: "runtime" });
    expect(r.events.at(-1)).toMatchObject({ event: "outcome", outcome: "error" });
  });

  test("real commands don't see the backend key, and its value is redacted from output (SPEC §4.4, §9)", async () => {
    const r = await runSkop([skill('- **run** `echo s3cr3t-value; test -z "$TYPESAFE_API_KEY"`\n- **stop**'), "--apply"], {
      env: { TYPESAFE_API_KEY: "s3cr3t-value" },
    });
    expect(r.code).toBe(0);
    expect(find(r.events, "run")).toMatchObject({ exit: 0, stdout_tail: "[REDACTED]\n" });
  });

  test("W-CONFIG-PERMS: a group-writable config is warned about, and the run goes on", async () => {
    const config = file("config.yaml", "ask:\n  backend: fake\n", 0o664);
    const r = await runSkop([skill("- **stop**"), "--apply", "--config", config]);
    expect(find(r.events, "warning", "W-CONFIG-PERMS")).toMatchObject({ stage: "args" });
    expect(r.stderr).toContain("W-CONFIG-PERMS");
    expect(r.code).toBe(0);
  });

  test("W-REDACT-OFF: turning off the built-in patterns is warned about on every run", async () => {
    const config = file("config.yaml", "ask:\n  backend: fake\nredact:\n  defaults: false\n");
    const r = await runSkop([skill("- **stop**"), "--dry-run", "--config", config]);
    expect(find(r.events, "warning", "W-REDACT-OFF")).toBeDefined();
    expect(r.code).toBe(0);
  });

  test("E-BACKEND-LIMIT: ask_context over jev's 30k tokens exits 40 before anything runs (SPEC §12.2)", async () => {
    const path = skill(
      "- **run** `df` as used\n- **ask** Given {used}, go on? · sure 80%\n  - [Other]\n  - [Third]\n\n## Other\nElse.\n\n- **stop**\n\n## Third\nOr this.\n\n- **stop**",
      "limits:\n  ask_context: 40k tokens\n",
    );
    const config = file("config.yaml", "jev:\n  model: jev-1.13.0\n  key_env: TYPESAFE_API_KEY\n");
    const r = await runSkop([path, "--apply", "--config", config], { env: { TYPESAFE_API_KEY: "k" } });
    expect(r.code).toBe(40);
    expect(find(r.events, "error", "E-BACKEND-LIMIT")).toBeDefined();
    expect(find(r.events, "run_start")).toBeUndefined();
  });

  test("E-CONFIG: a skill that asks needs a key for the configured backend", async () => {
    const path = skill(
      "- **run** `df` as used\n- **ask** Given {used}, go on? · sure 80%\n  - [Other]\n  - [Third]\n\n## Other\nElse.\n\n- **stop**\n\n## Third\nOr this.\n\n- **stop**",
    );
    const config = file("config.yaml", "jev:\n  model: jev-1.13.0\n  key_env: NO_SUCH_KEY_VAR\n");
    const r = await runSkop([path, "--apply", "--config", config]);
    expect(r.code).toBe(40);
    expect(find(r.events, "error", "E-CONFIG")).toBeDefined();
  });

  test("E-USAGE: an unknown flag, a missing flag value or a missing skill path exits 40, nothing runs (SPEC §7.1)", async () => {
    for (const args of [
      [skill("- **stop**"), "--apply", "--aply"],
      [skill("- **stop**"), "--apply", "--fake"],
      ["--apply"],
      ["a", "b", "--lint"],
    ]) {
      const r = await runSkop(args);
      expect(r.code, args.join(" ")).toBe(40);
      expect(r.events.map((e) => [e.event, e.code ?? e.outcome])).toEqual([
        ["error", "E-USAGE"],
        ["outcome", "invalid"],
      ]);
      expect(r.stderr).toContain("E-USAGE");
    }
  });

  test("E-USAGE: --trace without --verify", async () => {
    const r = await runSkop([skill("- **stop**"), "--trace", "t.jsonl"]);
    expect(r.code).toBe(40);
    expect(find(r.events, "error", "E-USAGE")).toBeDefined();
  });

  test("a pager failure prints the page to stderr and keeps the outcome (SPEC §4.2)", async () => {
    const config = file("config.yaml", "ask:\n  backend: fake\npager:\n  command: 'exit 1'\n");
    const r = await runSkop([skill('- **page** "disk is full"'), "--apply", "--config", config]);
    expect(r.code).toBe(10);
    expect(find(r.events, "page")).toMatchObject({ ok: false, text: "disk is full" });
    expect(r.stderr).toContain("disk is full");
  });

  test("a skill with no asks needs no backend key", async () => {
    const config = file("config.yaml", "jev:\n  model: jev-1.13.0\n  key_env: NO_SUCH_KEY_VAR\n");
    const r = await runSkop([skill("- **stop**"), "--apply", "--config", config]);
    expect(r.code).toBe(0);
    expect(r.events.map((e) => e.event)).toEqual(["run_start", "outcome"]);
  });

  test("E-PARAM-TYPE: an int param takes only a plain decimal integer", async () => {
    const path = skill("- **run** `echo {n}`\n- **stop**", "params:\n  n: 1\n");
    for (const v of ["1e3", "0x10", "1.5", "", "99999999999999999999"]) {
      const r = await runSkop([path, "--apply", "--param", `n=${v}`]);
      expect(find(r.events, "error", "E-PARAM-TYPE"), v).toBeDefined();
    }
  });

  test("--lint prints nothing for a clean skill: no run, no outcome", async () => {
    const r = await runSkop([skill("- **stop**"), "--lint"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
  });

  test("a dry-run handoff record says dry_run: true (SPEC §8.1)", async () => {
    const r = await runSkop([skill("- **hand off**"), "--dry-run"]);
    expect(r.code).toBe(20);
    expect(find(r.events, "handoff_record")).toMatchObject({ record: { dry_run: true, reason: "explicit", detail: null } });
  });

  test("the saved ask request fits limits.ask_context, keeping the end of the output (SPEC §6.3)", async () => {
    const path = skill(
      "- **run** `seq 1 50` as log\n- **ask** Given {log}, which? · sure 80%\n  - [Other]\n  - [Third]\n\n## Other\nElse.\n\n- **stop**\n\n## Third\nOr this.\n\n- **stop**",
      "limits:\n  ask_context: 3 tokens\n",
    );
    const answers = file("a.yaml", '{"line:13": {"s:other": 1, "s:third": 0}}');
    const r = await runSkop([path, "--apply", "--fake", answers]);
    expect(r.code).toBe(0);
    const request = JSON.parse(readFileSync(find(r.events, "ask")?.request_path as string, "utf8"));
    // 3 tokens is 12 chars: the last whole lines that fit.
    expect(request.context).toEqual({ log: "47\n48\n49\n50" });
  });

  test("an int --param override is typed and reaches the command", async () => {
    const path = skill("- **run** `echo {n}`\n- **stop**", "params:\n  n: 1\n");
    const r = await runSkop([path, "--apply", "--param", "n=42"]);
    expect(find(r.events, "run_start")).toMatchObject({ params: { n: "42" } });
    expect(find(r.events, "run")).toMatchObject({ cmd: "echo 42" });
  });
});

describe("lock (SPEC §7 step 3)", () => {
  function withLock(holder: object) {
    const runtime = mkdtempSync(join(tmpdir(), "skop-rt-"));
    mkdirSync(join(runtime, "skop"), { mode: 0o700 });
    writeFileSync(join(runtime, "skop", "tiny.lock"), JSON.stringify(holder));
    return { runtime, lock: join(runtime, "skop", "tiny.lock") };
  }

  test("locked: a live holder exits 30 with a locked event, no page", async () => {
    const { runtime } = withLock({ pid: process.pid, startTime: null });
    const r = await runSkop([skill("- **stop**"), "--apply"], { env: { XDG_RUNTIME_DIR: runtime } });
    expect(r.code).toBe(30);
    expect(find(r.events, "locked")).toMatchObject({ holder_pid: process.pid });
    expect(find(r.events, "page")).toBeUndefined();
    expect(r.events.at(-1)).toMatchObject({ event: "outcome", outcome: "locked" });
  });

  test("stale_lock: a dead holder exits 31, pages, and the lock is left alone", async () => {
    const { runtime, lock } = withLock({ pid: 2 ** 22 + 1, startTime: null });
    const r = await runSkop([skill("- **stop**"), "--apply"], { env: { XDG_RUNTIME_DIR: runtime } });
    expect(r.code).toBe(31);
    expect(find(r.events, "stale_lock")).toMatchObject({ path: lock, holder_pid: 2 ** 22 + 1 });
    expect(find(r.events, "page")).toMatchObject({ ok: true });
    expect(existsSync(lock)).toBe(true);
    expect(r.stderr).toContain(lock);
  });

  test("stale_lock in a dry run never pages: would_page instead", async () => {
    const { runtime } = withLock({ pid: 2 ** 22 + 1, startTime: null });
    const r = await runSkop([skill("- **stop**"), "--dry-run"], { env: { XDG_RUNTIME_DIR: runtime } });
    expect(r.code).toBe(31);
    expect(find(r.events, "page")).toBeUndefined();
    expect(find(r.events, "would_page")).toBeDefined();
  });

  test("the lock is released when the run ends", async () => {
    const runtime = mkdtempSync(join(tmpdir(), "skop-rt-"));
    const r = await runSkop([skill("- **stop**"), "--apply"], { env: { XDG_RUNTIME_DIR: runtime } });
    expect(r.code).toBe(0);
    expect(existsSync(join(runtime, "skop", "tiny.lock"))).toBe(false);
  });

  test("E-IO: a lock directory others can write to is refused, exit 50", async () => {
    const runtime = mkdtempSync(join(tmpdir(), "skop-rt-"));
    mkdirSync(join(runtime, "skop"));
    chmodSync(join(runtime, "skop"), 0o777);
    const r = await runSkop([skill("- **stop**"), "--apply"], { env: { XDG_RUNTIME_DIR: runtime } });
    expect(r.code).toBe(50);
    expect(find(r.events, "error", "E-IO")).toBeDefined();
  });
});

test("E-INTERRUPTED: SIGINT during a do stops it, releases the lock, exits 50 (SPEC §4.4)", async () => {
  const runtime = mkdtempSync(join(tmpdir(), "skop-rt-"));
  const env = { ...process.env, XDG_RUNTIME_DIR: runtime, XDG_CONFIG_HOME: runtime, XDG_STATE_HOME: runtime };
  const child = spawn(process.execPath, [CLI, skill("- **do** `sleep 30`\n- **stop**"), "--apply"], { env });
  let out = "";
  const started = Date.now();
  const code = await new Promise<number | null>((resolve) => {
    child.stdout.on("data", (d) => {
      out += d;
      // Twice: a second signal while skop is stopping must not cut the cleanup short.
      if (out.includes('"effect_start"') && !child.killed) {
        child.kill("SIGINT");
        child.kill("SIGINT");
      }
    });
    child.on("close", resolve);
  });
  const events = out
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  expect(code).toBe(50);
  expect(events.filter((e) => e.code === "E-INTERRUPTED")).toEqual([expect.objectContaining({ event: "error", stage: "runtime" })]);
  expect(events.at(-1)).toMatchObject({ event: "outcome", outcome: "error" });
  expect(existsSync(join(runtime, "skop", "tiny.lock"))).toBe(false);
  expect(Date.now() - started).toBeLessThan(20_000);
}, 30_000);
