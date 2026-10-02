import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { approvePlan } from "../../src/host/hooks.js";
import { unifiedDiff } from "../../src/host/plan.js";
import { runSkope } from "../acceptance/lib/cli.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "skope-generation-"));
  const base = join(dir, "base");
  const tree = join(dir, "prototype");
  mkdirSync(base);
  mkdirSync(tree);
  execFileSync("git", ["init", "-q"], { cwd: base });
  const output = join(base, ".skope", "plans", "change.md");
  const claude = join(dir, "claude");
  const env = { CLAUDE_CONFIG_DIR: claude, CODEX_HOME: join(dir, "codex"), SKOPE_CALLER: "agent" };
  const config = join(dir, "config.yaml");
  writeFileSync(config, `state_dir: ${dir}/state\nask:\n  backend: fake\n`, { mode: 0o600 });
  const put = (root: string, path: string, text: string | Buffer) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text, { mode: 0o644 });
  };
  const generate = (...extra: string[]) => runSkope(["plan", "--from-tree", tree, "--base", base, "--output", output, ...extra], { env });
  const run = (...flags: string[]) => runSkope([output, "--config", config, ...flags], { env });
  const approve = async () => {
    const r = await run("--effects");
    const hash = (JSON.parse(r.stdout.trim().split("\n").at(-1) as string).effects_hash as string).slice(7);
    expect(approvePlan(output, hash, claude)).toBeNull();
  };
  return { dir, base, tree, output, env, put, generate, run, approve };
}

describe("prototype and diff plan generation", () => {
  test("creates a compact plan, leaves the base unchanged, applies exact changes and re-runs", async () => {
    const s = setup();
    s.put(s.base, "file.txt", "same\nold\nsame\nold\n");
    s.put(s.tree, "file.txt", "same\nnew\nsame\nold\n");
    s.put(s.base, "deleted.txt", "remove\n");
    s.put(s.tree, "added.txt", "created without newline");
    const generated = await s.generate("--check", "grep -q new file.txt");
    expect(generated.code, generated.stderr).toBe(0);
    expect(generated.stdout).toMatch(/skope plan: .* [0-9a-f]{64}/);
    expect(generated.stdout).not.toContain("@@");
    expect(readFileSync(join(s.base, "file.txt"), "utf8")).toContain("old");
    expect(existsSync(join(s.base, "added.txt"))).toBe(false);
    expect(readFileSync(s.output, "utf8")).toContain("**patch**");
    expect((await s.run("--lint")).code).toBe(0);
    expect((await s.run("--apply")).code).toBe(40);
    await s.approve();
    const applied = await s.run("--apply");
    expect(applied.code, applied.stderr).toBe(0);
    expect(applied.stderr).toContain("3 changes applied, 0 already in place; 1 check passed");
    expect(readFileSync(join(s.base, "file.txt"))).toEqual(readFileSync(join(s.tree, "file.txt")));
    expect(readFileSync(join(s.base, "added.txt"))).toEqual(readFileSync(join(s.tree, "added.txt")));
    expect(existsSync(join(s.base, "deleted.txt"))).toBe(false);
    const repeated = await s.run("--apply", "--stream");
    expect(repeated.code, repeated.stderr).toBe(0);
    expect(repeated.stdout).toBe("");
    expect(repeated.stderr).toContain("0 changes applied, 3 already in place; 1 check passed");
    const dirs = readdirSync(join(s.dir, "state", "runs"));
    expect(dirs.length).toBeGreaterThan(0);
  });

  test("an altered patch or altered source cannot use an earlier approval", async () => {
    const s = setup();
    s.put(s.base, "a.txt", "old\n");
    s.put(s.tree, "a.txt", "new\n");
    expect((await s.generate()).code).toBe(0);
    await s.approve();
    const original = readFileSync(s.output, "utf8");
    writeFileSync(s.output, original.replace("+new", "+different"));
    expect((await s.run("--apply")).stderr).toContain("E-NOT-APPROVED");
    writeFileSync(s.output, original);
    s.put(s.base, "a.txt", "outside change\n");
    expect((await s.run("--apply")).stderr).toContain("E-PLAN-STALE");
    expect(readFileSync(join(s.base, "a.txt"), "utf8")).toBe("outside change\n");
  });

  test("a failing check produces a log, summary, and persistent JSONL even in readable mode", async () => {
    const s = setup();
    s.put(s.base, "a.txt", "old\n");
    s.put(s.tree, "a.txt", "new\n");
    expect((await s.generate("--check", "printf failure >&2; exit 3")).code).toBe(0);
    await s.approve();
    const r = await s.run("--apply", "--stream");
    expect(r.code, r.stderr).toBe(20);
    expect(r.stderr).toContain("1 change applied, 0 already in place; 0 checks passed, 1 failed");
    const path = /Details for continuing: (.*)/.exec(r.stderr)?.[1] as string;
    const record = JSON.parse(readFileSync(path, "utf8"));
    expect(record.detail.exit).toBe(3);
    expect(readFileSync(record.detail.log, "utf8")).toContain("failure");
    const events = readFileSync(join(path, "..", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.find((e) => e.event === "change")).toMatchObject({ op: "patch", result: "applied" });
    expect(events.at(-1)).toMatchObject({ event: "outcome", outcome: "handoff" });
  });

  test("imports a diff file by content, so later edits to the source diff do not change the plan", async () => {
    const s = setup();
    s.put(s.base, "a.txt", "old\n");
    const diff = join(s.dir, "changes.diff");
    writeFileSync(diff, unifiedDiff("a.txt", "old\n", "new\n"));
    const r = await runSkope(["plan", "--from-diff", diff, "--base", s.base, "--output", s.output], { env: s.env });
    expect(r.code, r.stderr).toBe(0);
    const plan = readFileSync(s.output, "utf8");
    writeFileSync(diff, "tampered");
    expect(readFileSync(s.output, "utf8")).toBe(plan);
    await s.approve();
    expect((await s.run("--apply")).code).toBe(0);
    expect(readFileSync(join(s.base, "a.txt"), "utf8")).toBe("new\n");
  });

  test("compact review keeps the same approval marker and lists every real command", async () => {
    const s = setup();
    s.put(s.base, "a.txt", "old\n");
    s.put(s.tree, "a.txt", "new\n");
    const generated = await s.generate("--check", "echo checking");
    const reviewed = await runSkope(["plan", s.output, "--review"], { env: s.env });
    expect(reviewed.code).toBe(0);
    expect(reviewed.stdout).toBe(generated.stdout);
    expect(reviewed.stdout).toContain("echo checking");
    expect(reviewed.stdout).not.toContain("-old");
    const full = await runSkope(["plan", s.output, "--review", "--diff"], { env: s.env });
    expect(full.code, full.stderr).toBe(0);
    expect(full.stdout.match(/--- a\/a.txt/g)).toHaveLength(1);
    expect(full.stdout).toContain("-old\n+new");
  });

  test("ignores build output and refuses overwriting an existing plan", async () => {
    const s = setup();
    for (const root of [s.base, s.tree]) s.put(root, ".gitignore", "dist/\n");
    s.put(s.base, "a.txt", "old\n");
    s.put(s.tree, "a.txt", "new\n");
    s.put(s.tree, "dist/output.txt", "ignore me\n");
    expect((await s.generate()).code).toBe(0);
    expect(readFileSync(s.output, "utf8")).not.toContain("dist/output");
    const original = readFileSync(s.output);
    expect((await s.generate()).code).toBe(40);
    expect(readFileSync(s.output)).toEqual(original);
  });

  test.each(["binary", "symlink", "mode", "line endings"])("refuses %s prototype changes", async (kind) => {
    const s = setup();
    s.put(s.base, "a.txt", "old\n");
    s.put(s.tree, "a.txt", "new\n");
    if (kind === "binary") s.put(s.tree, "a.txt", Buffer.from([0, 1, 2]));
    if (kind === "symlink") symlinkSync(join(s.base, "a.txt"), join(s.tree, "outside"));
    if (kind === "mode") chmodSync(join(s.tree, "a.txt"), 0o755);
    if (kind === "line endings") s.put(s.tree, "a.txt", "new\r\n");
    const r = await s.generate();
    expect(r.code, r.stderr).toBe(40);
    expect(existsSync(s.output)).toBe(false);
    expect(readFileSync(join(s.base, "a.txt"), "utf8")).toBe("old\n");
  });
});

test("generation widens ambiguous insertion context instead of skipping the intended edit", async () => {
  const s = setup();
  s.put(s.base, "a.txt", "same\nsame\nsame\nsame\nsame\nsame\nsame\nsame\n");
  s.put(s.tree, "a.txt", "same\nsame\nsame\nsame\nsame\nsame\nsame\nsame\nsame\n");
  const r = await s.generate();
  expect(r.code, r.stderr).toBe(0);
  await s.approve();
  const applied = await s.run("--apply");
  expect(applied.code, applied.stderr).toBe(0);
  expect(readFileSync(join(s.base, "a.txt"))).toEqual(readFileSync(join(s.tree, "a.txt")));
  const repeated = await s.run("--apply");
  expect(repeated.code, repeated.stderr).toBe(0);
  expect(readFileSync(join(s.base, "a.txt"))).toEqual(readFileSync(join(s.tree, "a.txt")));
});

test("a nested prototype is excluded from base changes", async () => {
  const s = setup();
  const nested = join(s.base, "scratch");
  mkdirSync(nested);
  s.put(s.base, "a.txt", "old\n");
  s.put(nested, "a.txt", "new\n");
  const r = await runSkope(["plan", "--from-tree", nested, "--base", s.base, "--output", s.output], { env: s.env });
  expect(r.code, r.stderr).toBe(0);
  expect(readFileSync(s.output, "utf8")).not.toContain("scratch/");
  expect(readFileSync(join(nested, "a.txt"), "utf8")).toBe("new\n");
});
