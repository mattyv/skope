// The run flow end to end through the built CLI (SPEC §7, §8, §9): lock,
// runtime errors, config warnings, backend checks and redaction.

import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
    // A warning about a run that goes ahead comes after run_start and carries its run_id (SPEC §10).
    expect(r.events.map((e) => e.event)).toEqual(["run_start", "warning", "outcome"]);
    expect(find(r.events, "warning")?.run_id).toBe(find(r.events, "run_start")?.run_id);
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

  // C0 and C1 controls except \n and \t: OSC title, clear screen, BEL, CR, NUL, CSI (U+009B), DEL.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: finding them is the point.
  const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

  test("S5: control characters from command output never reach the pager, the page event or stderr", async () => {
    const sent = join(mkdtempSync(join(tmpdir(), "skop-pager-")), "page.txt");
    const config = file("config.yaml", `ask:\n  backend: fake\npager:\n  command: 'cat > ${sent}; exit 1'\n`);
    const cmd = "printf 'a\\033]0;x\\007b\\033[2Jc\\rd\\000e\\302\\233f\\177g'";
    const r = await runSkop([skill(`- **run** \`${cmd}\` as out\n- **page** "got {out}"`), "--apply", "--config", config]);
    expect(r.code).toBe(10);
    const text = find(r.events, "page")?.text as string;
    expect(text).toBe("got a]0;xb[2Jcdefg");
    expect(readFileSync(sent, "utf8")).toBe(text);
    expect(r.stderr).toContain(text);
    expect(r.stderr).not.toMatch(CONTROLS);
  });

  test("S5: a diagnostic can't carry control characters to stderr either", async () => {
    const r = await runSkop([join(tmpdir(), "no-such-\u001b]0;x\u0007-\r-\u009b.md"), "--apply"]);
    expect(r.code).toBe(40);
    expect(r.stderr).toContain("E-USAGE");
    expect(r.stderr).not.toMatch(CONTROLS);
  });

  describe("S6: a config file without the selected backend's block is treated like no config file", () => {
    const asks = () =>
      skill(
        "- **run** `df` as used\n- **ask** Given {used}, go on? · sure 80%\n  - [Other]\n  - [Third]\n\n## Other\nElse.\n\n- **stop**\n\n## Third\nOr this.\n\n- **stop**",
      );
    const pagerOnly = () => file("config.yaml", "pager:\n  command: 'cat > /dev/null'\n");
    const noConfig = () => ({ env: { XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "skop-noconfig-")) } });

    test("--lint, --explain and --verify don't need a backend block", async () => {
      for (const mode of ["--lint", "--explain", "--verify"]) {
        const r = await runSkop([asks(), mode, "--config", pagerOnly()]);
        expect(r.code, mode).toBe(0);
        expect(find(r.events, "error"), mode).toBeUndefined();
      }
    });

    test("a run that doesn't ask needs none either", async () => {
      expect((await runSkop([skill("- **stop**"), "--dry-run", "--config", pagerOnly()])).code).toBe(0);
      expect((await runSkop([skill("- **stop**"), "--dry-run"], noConfig())).code).toBe(0);
    });

    test("a run that asks is E-CONFIG before it starts, whether the file exists or not", async () => {
      for (const r of [await runSkop([asks(), "--dry-run", "--config", pagerOnly()]), await runSkop([asks(), "--dry-run"], noConfig())]) {
        expect(r.code).toBe(40);
        expect(find(r.events, "error", "E-CONFIG")?.message).toMatch(/no jev block/);
        expect(find(r.events, "run_start")).toBeUndefined();
      }
    });
  });

  test("the configured backend is called in-process with the config's model; a failed call is unavailable", async () => {
    const path = skill(
      "- **run** `df` as used\n- **ask** Given {used}, go on? · sure 80%\n  - [Other]\n  - [Third]\n\n## Other\nElse.\n\n- **stop**\n\n## Third\nOr this.\n\n- **stop**",
    );
    // A 1 ms timeout and no retries: the call is abandoned before any answer can come back.
    const config = file("config.yaml", "ask:\n  timeout_ms: 1\n  retries: 0\njev:\n  model: jev-1.13.0\n  key_env: SKOP_TEST_KEY\n");
    const r = await runSkop([path, "--dry-run", "--config", config], { env: { SKOP_TEST_KEY: "k" } });
    expect(r.code).toBe(20);
    expect(find(r.events, "ask")).toMatchObject({ backend: "jev", model: "jev-1.13.0", detail: "unavailable", probs: null });
    expect(find(r.events, "handoff_record")?.record).toMatchObject({ reason: "ask_unavailable" });
    expect(r.stderr).toContain("skop: the backend was unavailable");
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

  test("S3: a comparison that can't coerce hands off with detail {expr, left, right}, not the last command (SPEC §4.2, §8.1)", async () => {
    const r = await runSkop([skill("- **run** `echo abc` as x\n- **check** {x} > 1 → stop\n- **hand off**"), "--apply", "--no-page"]);
    expect(r.code).toBe(20);
    const check = find(r.events, "check") as SkopEvent;
    expect(check.result).toBeNull();
    expect(find(r.events, "handoff_record")?.record).toMatchObject({ reason: "command_failed" });
    const detail = (find(r.events, "handoff_record")?.record as { detail: unknown } | undefined)?.detail;
    expect(detail).toEqual({ expr: "{x} > 1", left: check.left, right: check.right });
  });

  test("a command that fails right after a comparison still gets the command's detail", async () => {
    const r = await runSkop([
      skill("- **run** `echo 5` as x\n- **check** {x} > 9 → stop\n- **run** `exit 3`\n- **stop**"),
      "--apply",
      "--no-page",
    ]);
    expect(r.code).toBe(20);
    expect((find(r.events, "handoff_record")?.record as { detail: unknown } | undefined)?.detail).toMatchObject({ cmd: "exit 3", exit: 3 });
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
    // S4: skop's own parts of a page aren't escaped, so the path can be copied.
    expect(find(r.events, "page")?.text).toContain(`stale lock at ${lock}.`);
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

describe("review fixes", () => {
  const ask = (lines = "") =>
    skill(
      `- **run** \`df\` as used\n- **ask** Given {used}, which? · sure 80%\n  - [Other]\n  - [Third]\n\n## Other\nElse.\n\n- **stop**\n\n## Third\nOr this.\n\n- **hand off**${lines}`,
    );

  test("a reader closing stdout early doesn't leak the lock: the run finishes with its exit code", async () => {
    const runtime = mkdtempSync(join(tmpdir(), "skop-rt-"));
    const env = { ...process.env, XDG_RUNTIME_DIR: runtime, XDG_CONFIG_HOME: runtime, XDG_STATE_HOME: runtime };
    const path = skill('- **run** `echo a`\n- **run** `echo b`\n- **page** "done"');
    const child = spawn(process.execPath, [CLI, path, "--dry-run"], { env });
    // Like `| head -n1`: read one line, then close the pipe.
    child.stdout.once("data", () => child.stdout.destroy());
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    expect(code).toBe(10);
    expect(existsSync(join(runtime, "skop", "tiny.lock"))).toBe(false);
  });

  test("E-USAGE: an unreadable skill path, --param without =, and two modes at once (SPEC §7.1)", async () => {
    const path = skill("- **stop**", "params:\n  n: 1\n");
    for (const args of [
      [join(tmpdir(), "no-such-skill.md"), "--apply"],
      [path, "--apply", "--param", "n"],
      [path, "--lint", "--verify"],
      [path, "--apply", "--verify"],
      [path, "--dry-run", "--explain"],
    ]) {
      const r = await runSkop(args);
      expect(r.code, args.join(" ")).toBe(40);
      expect(find(r.events, "error", "E-USAGE"), args.join(" ")).toBeDefined();
    }
  });

  test("S10: --verify --trace that doesn't fit says which step the explorer couldn't follow (SPEC §12.4)", async () => {
    const path = skill("- **run** `true`\n- **run** `true`\n- **stop**");
    const run = await runSkop([path, "--apply"]);
    expect(run.code).toBe(0);
    // Move the second command to a line no path has.
    const events = run.events.map((e) => (e.event === "run" && e.line === 11 ? { ...e, line: 99 } : e));
    const trace = file("t.jsonl", events.map((e) => JSON.stringify(e)).join("\n"));
    const r = await runSkop([path, "--verify", "--trace", trace]);
    expect(r.code).toBe(40);
    const report = JSON.parse(r.stdout.trim().split("\n").at(-1) as string);
    expect(report).toMatchObject({ trace_fits: false, mismatch: { index: 1, event: "run", section: "Main", line: 99, class: "ok" } });
    expect(r.stderr).toMatch(/run at Main:99 \(ok\)/);

    const ok = await runSkop([path, "--verify", "--trace", file("t.jsonl", run.stdout)]);
    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.stdout.trim().split("\n").at(-1) as string)).toMatchObject({ trace_fits: true });
  });

  test("E-USAGE: an unreadable or malformed --trace file", async () => {
    for (const trace of [join(tmpdir(), "no-such-trace.jsonl"), file("t.jsonl", "not json\n"), file("t.jsonl", "[1]\n")]) {
      const r = await runSkop([skill("- **stop**"), "--verify", "--trace", trace]);
      expect(r.code, trace).toBe(40);
      expect(find(r.events, "error", "E-USAGE"), trace).toBeDefined();
    }
  });

  test("E-CONFIG: --fake and --fake-exec files are checked against contracts/fakes.schema.json before the run", async () => {
    const cases = [
      ["--fake", file("a.yaml", '{"line:11": "maybe"}')],
      ["--fake", file("a.yaml", "[1, 2]")],
      ["--fake-exec", file("c.yaml", '{"line:10": {"exit": 0, "sdtout": "typo"}}')],
      ["--fake-exec", file("c.yaml", "{ not yaml")],
    ];
    for (const [flag, path] of cases) {
      const r = await runSkop([ask(), "--apply", flag as string, path as string]);
      expect(r.code, `${flag} ${path}`).toBe(40);
      expect(find(r.events, "error", "E-CONFIG"), `${flag} ${path}`).toBeDefined();
      expect(find(r.events, "run_start")).toBeUndefined();
    }
  });

  test("ask requests and the handoff record are private files (0600) in a fresh run directory", async () => {
    const answers = file("a.yaml", '{"line:11": {"s:other": 0, "s:third": 1}}');
    const r = await runSkop([ask(), "--apply", "--no-page", "--fake", answers], { env: {} });
    expect(r.code).toBe(20);
    const ask1 = find(r.events, "ask")?.request_path as string;
    const record = find(r.events, "handoff_record")?.path as string;
    for (const p of [ask1, record]) expect(statSync(p).mode & 0o777, p).toBe(0o600);
    expect(statSync(find(r.events, "run_start")?.run_dir as string).mode & 0o777).toBe(0o700);
  });

  test("S4: the handoff page's host and record path are copyable byte for byte", async () => {
    const r = await runSkop([skill("- **hand off**"), "--apply"]);
    const text = find(r.events, "handoff_page")?.text as string;
    const path = find(r.events, "handoff_record")?.path as string;
    expect(text).toBe(`${find(r.events, "run_start")?.host}: skop tiny handed off (explicit) in Main. Record: ${path}`);
    expect(text).not.toContain("​");
  });

  test("S4: links and mentions from run output are still broken in a page", async () => {
    const out = "see https://evil.example/x, www.evil.com, [x](y) and @here";
    const r = await runSkop([skill(`- **run** \`echo '${out}'\` as out\n- **page** "look: {out}"`), "--apply"]);
    const text = find(r.events, "page")?.text as string;
    expect(text).not.toMatch(/:\/\/|www\.e|evil\.e|\[x\]\(|@here/);
    expect(text.replace(/​/g, "").replace(/\\/g, "")).toBe(`look: ${out}`);
  });

  test("with no pager configured, a page reports ok: false and the message goes to stderr", async () => {
    const r = await runSkop([skill('- **page** "disk is full"'), "--apply", "--config", file("config.yaml", "ask:\n  backend: fake\n")]);
    expect(r.code).toBe(10);
    expect(find(r.events, "page")).toMatchObject({ ok: false });
    expect(r.stderr).toContain("disk is full");
  });

  test("--verify reports exact counts, maxima and unreached sections for a small skill (SPEC §5.6)", async () => {
    const path = skill(
      "- **run** `a` as x\n- **check** {x} > 1 → stop\n- **then** [Hand]\n\n## Hand\n- **hand off**\n\n## Lost\nNever.\n\n- **stop**",
    );
    const r = await runSkop([path, "--verify"]);
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout.trim().split("\n").at(-1) as string);
    // run ok, fail, timeout; the check on unknown output is true, false or not a number.
    expect(report).toMatchObject({
      paths: 5,
      outcomes: ["handoff:command_failed", "handoff:explicit", "stopped"],
      max_ask_calls: 0,
      max_effects: 0,
      // run timeout 30s + 5s kill grace, then a handoff that may page (10s pager timeout).
      worst_case_ms: 45_000,
      unreached_sections: ["Lost"],
    });
    // Hand is only reached by a transfer and has no events of its own but the handoff.
    expect(report.unreached_sections).not.toContain("Hand");
    // Lint's warning, once, before the report.
    expect(r.events.filter((e) => e.code === "W-SECTION-UNREACHED")).toHaveLength(1);
  });
});

describe("final review nits", () => {
  test("--help prints every flag in SPEC §7 to stdout and exits 0", async () => {
    const r = await runSkop(["--help"]);
    expect(r.code).toBe(0);
    for (const flag of [
      "--apply",
      "--dry-run",
      "--no-page",
      "--param",
      "--explain",
      "--verify",
      "--trace",
      "--lint",
      "--fake",
      "--fake-exec",
      "--config",
      "--version",
      "--help",
    ])
      expect(r.stdout, flag).toContain(flag);
    expect(r.stderr).toBe("");
  });

  test("--lint success prints one ok line to stderr; stdout stays empty", async () => {
    const path = skill("- **stop**");
    const r = await runSkop([path, "--lint"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe(`skop: ${path}: ok\n`);
  });

  test("--explain prints its JSON on stdout and a short summary on stderr", async () => {
    const r = await runSkop([skill("- **do** `x`\n- **stop**"), "--explain"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ entry: "Main", max_effects: 1 });
    expect(r.stderr).toMatch(/^skop: 1 section, entry Main; at most 0 asks and 1 effect; worst case \d+(\.\d+)?s\n$/);
  });

  test("locked prints who holds the lock and where", async () => {
    const runtime = mkdtempSync(join(tmpdir(), "skop-rt-"));
    mkdirSync(join(runtime, "skop"), { mode: 0o700 });
    const lock = join(runtime, "skop", "tiny.lock");
    writeFileSync(lock, JSON.stringify({ pid: process.pid, startTime: null }));
    const r = await runSkop([skill("- **stop**"), "--apply"], { env: { XDG_RUNTIME_DIR: runtime } });
    expect(r.code).toBe(30);
    expect(r.stderr).toContain(`skop: another run (pid ${process.pid}) holds the lock at ${lock}`);
  });

  test("<b>run</b> says HTML bold isn't skop bold", async () => {
    const r = await runSkop([skill("- <b>run</b> `df`\n- **stop**"), "--lint"]);
    expect(r.code).toBe(40);
    expect(find(r.events, "error", "E-UNKNOWN-BOLD")?.message).toContain("HTML bold isn't skop bold; use **run**");
  });

  test("E-USAGE: a skill file that isn't valid UTF-8 is refused, not patched with U+FFFD", async () => {
    const path = skill("- **stop**");
    writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from([0xff, 0xfe, 0x0a])]));
    const r = await runSkop([path, "--lint"]);
    expect(r.code).toBe(40);
    expect(find(r.events, "error", "E-USAGE")?.message).toMatch(/UTF-8/);
  });

  test("an invalid backend answer prints a stderr line, like an unavailable one", async () => {
    const path = skill(
      "- **run** `df` as used\n- **ask** Given {used}, which? · sure 80%\n  - [Other]\n  - [Third]\n\n## Other\nElse.\n\n- **stop**\n\n## Third\nOr this.\n\n- **stop**",
    );
    const answers = file("a.yaml", '{"line:11": {"s:other": 0.5, "s:third": 0.9}}');
    const r = await runSkop([path, "--apply", "--no-page", "--fake", answers]);
    expect(r.code).toBe(20);
    expect(find(r.events, "ask")).toMatchObject({ detail: "unavailable" });
    expect(r.stderr).toMatch(/skop: the backend's answer was invalid/);
  });

  test("E-PARAM-UNSAFE says which characters are allowed", async () => {
    const path = skill("- **run** `echo {m}`\n- **stop**", "params:\n  m: /\n");
    const r = await runSkop([path, "--apply", "--param", "m=/; rm -rf /"]);
    expect(r.code).toBe(40);
    expect(find(r.events, "error", "E-PARAM-UNSAFE")?.message).toContain("A-Z a-z 0-9 . _ / : @ % + = , -");
  });
});
