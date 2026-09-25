// What ships inside skope: `skope --demo`, `skope --install-skill` and the npm postinstall that
// runs it (SPEC §5.5, §7), and the shipped write-skope-skill itself: its example skill and tests.yaml must pass, or the skill teaches
// something skope rejects.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(ROOT, "dist", "cli.js");
const SOURCE = join(ROOT, "skills", "write-skope-skill", "SKILL.md");

function skope(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
}

describe("skope --install-skill", () => {
  test("src/embedded.gen.ts is up to date with the skill (run: node scripts/gen-embedded.mjs)", async () => {
    const { generate } = await import(join(ROOT, "scripts", "gen-embedded.mjs"));
    expect(readFileSync(join(ROOT, "src", "embedded.gen.ts"), "utf8")).toBe(generate());
  });

  test("writes the skill into the directory given", () => {
    const dir = mkdtempSync(join(tmpdir(), "skope-skills-"));
    const r = skope(["--install-skill", dir]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(readFileSync(join(dir, "write-skope-skill", "SKILL.md"), "utf8")).toBe(readFileSync(SOURCE, "utf8"));
  });

  test("defaults to $CLAUDE_CONFIG_DIR/skills, and replaces an older copy", () => {
    const claude = mkdtempSync(join(tmpdir(), "skope-claude-"));
    mkdirSync(join(claude, "skills", "write-skope-skill"), { recursive: true });
    writeFileSync(join(claude, "skills", "write-skope-skill", "SKILL.md"), "old");
    expect(skope(["--install-skill"], { CLAUDE_CONFIG_DIR: claude }).status).toBe(0);
    expect(readFileSync(join(claude, "skills", "write-skope-skill", "SKILL.md"), "utf8")).toBe(readFileSync(SOURCE, "utf8"));
  });

  test("with a skill file or another option, it's a usage error", () => {
    expect(skope(["x/SKILL.md", "--install-skill"]).status).toBe(40);
    expect(skope(["--install-skill", "a", "b"]).status).toBe(40);
    expect(skope(["--install-skill", "--lint"]).status).toBe(40);
  });

  test("a directory it can't write fails with 50 and says where", () => {
    const file = join(mkdtempSync(join(tmpdir(), "skope-skills-")), "not-a-dir");
    writeFileSync(file, "");
    const r = skope(["--install-skill", file]);
    expect(r.status).toBe(50);
    expect(r.stderr).toContain("couldn't install the write-skope-skill skill");
  });
});

describe("skope --demo", () => {
  test("writes a skill whose tests pass and whose fake run works, with no config or key", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "skope-demo-")), "demo");
    const home = mkdtempSync(join(tmpdir(), "skope-home-"));
    const env = { HOME: home, XDG_CONFIG_HOME: join(home, "config"), XDG_STATE_HOME: join(home, "state") };
    const r = skope(["--demo", dir], env);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain(`cd ${dir}\n  skope SKILL.md --verify`);
    expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toBe(readFileSync(join(ROOT, "fixtures", "disk-full", "SKILL.md"), "utf8"));

    const test = skope([join(dir, "SKILL.md"), "--test"], env);
    expect(test.stderr).toMatch(/\d+ passed, 0 failed, 0 invalid/);
    expect(test.status).toBe(0);
    expect(skope([join(dir, "SKILL.md"), "--verify"], env).status).toBe(0);

    const run = skope(
      [join(dir, "SKILL.md"), "--dry-run", "--fake", join(dir, "answers.yaml"), "--fake-exec", join(dir, "commands.yaml")],
      env,
    );
    expect(run.status).toBe(0);
    const events = run.stdout
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(events.find((e) => e.event === "would_do")?.cmd).toBe("systemctl restart myapp-worker");
    expect(events.at(-1)).toMatchObject({ event: "outcome", outcome: "stopped" });
    expect(events.some((e) => e.event === "warning")).toBe(false);
  });

  test("never overwrites: an existing directory is a usage error", () => {
    const dir = mkdtempSync(join(tmpdir(), "skope-demo-"));
    const r = skope(["--demo", dir]);
    expect(r.status).toBe(40);
    expect(r.stderr).toContain("already exists");
  });
});

describe("npm postinstall", () => {
  const postinstall = (env: Record<string, string>) =>
    spawnSync(process.execPath, [join(ROOT, "scripts", "postinstall.mjs")], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", HOME: mkdtempSync(join(tmpdir(), "skope-home-")), ...env },
    });

  test("a global install puts the skill in Claude Code's skills directory", () => {
    const claude = mkdtempSync(join(tmpdir(), "skope-claude-"));
    expect(postinstall({ npm_config_global: "true", CLAUDE_CONFIG_DIR: claude }).status).toBe(0);
    expect(existsSync(join(claude, "skills", "write-skope-skill", "SKILL.md"))).toBe(true);
  });

  test("a local install, SKOPE_NO_SKILL, or no Claude Code installs nothing, and still succeeds", () => {
    const claude = mkdtempSync(join(tmpdir(), "skope-claude-"));
    expect(postinstall({ CLAUDE_CONFIG_DIR: claude }).status).toBe(0);
    expect(postinstall({ npm_config_global: "true", SKOPE_NO_SKILL: "1", CLAUDE_CONFIG_DIR: claude }).status).toBe(0);
    expect(existsSync(join(claude, "skills"))).toBe(false);
    const missing = join(claude, "nope");
    expect(postinstall({ npm_config_global: "true", CLAUDE_CONFIG_DIR: missing }).status).toBe(0);
    expect(existsSync(missing)).toBe(false);
  });
});

describe("the write-skope-skill example", () => {
  // The first ```yaml block is its tests.yaml and the ````markdown block (four backticks, since
  // the skill holds a ```skope block) its skill.
  const text = readFileSync(SOURCE, "utf8");
  const block = (fence: string, lang: string) =>
    (new RegExp(`^${fence}${lang}\\n([\\s\\S]*?)^${fence}$`, "m").exec(text) as RegExpExecArray)[1] as string;
  const dir = mkdtempSync(join(tmpdir(), "skope-example-"));
  writeFileSync(join(dir, "SKILL.md"), block("````", "markdown"));
  writeFileSync(join(dir, "tests.yaml"), block("```", "yaml"));

  test("lints clean", () => {
    const r = skope([join(dir, "SKILL.md"), "--lint"]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('"W-');
  });

  test("passes every scenario in its tests.yaml", () => {
    const r = skope([join(dir, "SKILL.md"), "--test"]);
    expect(r.stderr).toMatch(/\d+ passed, 0 failed, 0 invalid/);
    expect(r.status).toBe(0);
  });
});
