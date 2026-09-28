// The plan-mode approval hook (docs/design/plan-mode.md, item 7): `skope --plan-approved` approves
// a skope plan when the person approves it in Claude Code or Codex, and only then; and
// `skope --install-hooks` puts it in their settings.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { installClaudeHook, installCodexHook, planLine } from "../../src/host/hooks.js";
import { runSkope } from "../acceptance/lib/cli.js";

const CLI = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

const PLAN = `---
name: tiny-plan
description: a test plan
---
A skope skill.
\`\`\`skope
format: 1
kind: plan
\`\`\`

## Change
Edit a.txt.

- **edit** \`a.txt\`
  \`\`\`old
  old
  \`\`\`
  \`\`\`new
  new
  \`\`\`
- **stop**
`;

/** A repo with the plan, a Claude Code and a Codex config dir, and the plan's effects hash. */
function world() {
  const root = mkdtempSync(join(tmpdir(), "skope-hooks-"));
  const repo = join(root, "repo");
  mkdirSync(join(repo, ".skope", "plans"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repo });
  writeFileSync(join(repo, "a.txt"), "old\n");
  const plan = join(repo, ".skope", "plans", "tiny.md");
  writeFileSync(plan, PLAN);
  const claude = join(root, "claude");
  const codex = join(root, "codex");
  mkdirSync(join(claude, "projects", "p"), { recursive: true });
  mkdirSync(join(codex, "sessions"), { recursive: true });
  const env = { ...process.env, CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex };
  const effects = spawnSync(process.execPath, [CLI, plan, "--effects"], { env, encoding: "utf8" });
  const hash = (JSON.parse(effects.stdout.trim()).effects_hash as string).slice(7, 19);
  const line = `skope plan: .skope/plans/tiny.md ${hash}`;
  const hook = (input: unknown) =>
    spawnSync(process.execPath, [CLI, "--plan-approved"], { env, input: JSON.stringify(input), encoding: "utf8" });
  const approved = () => existsSync(join(repo, ".skope", "plans", "tiny-plan.approval.json"));
  return { root, repo, plan, claude, codex, env, hash, line, hook, approved };
}

const jsonl = (...xs: unknown[]) => `${xs.map((x) => JSON.stringify(x)).join("\n")}\n`;
const exitPlan = (id: string) => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "ExitPlanMode", input: {} }] } });

function claudeHook(w: ReturnType<typeof world>, opts: { id?: string; transcript?: string; plan?: string } = {}) {
  const id = opts.id ?? "toolu_1";
  const transcript = opts.transcript ?? join(w.claude, "projects", "p", "s.jsonl");
  if (!opts.transcript) writeFileSync(transcript, jsonl(exitPlan(id)));
  return w.hook({
    hook_event_name: "PostToolUse",
    tool_name: "ExitPlanMode",
    tool_use_id: id,
    cwd: w.repo,
    transcript_path: transcript,
    tool_input: { plan: opts.plan ?? `Remove the old line.\n\n${w.line}\n` },
    tool_response: { plan: opts.plan ?? `Remove the old line.\n\n${w.line}\n` },
  });
}

describe("Claude Code: PostToolUse on ExitPlanMode", () => {
  test("approves the named plan, tells the agent how to run it, and the run then goes ahead", async () => {
    const w = world();
    const before = await runSkope([w.plan, "--apply"], { env: { CLAUDE_CONFIG_DIR: w.claude } });
    expect(before.events.find((e) => e.event === "error")).toMatchObject({ code: "E-NOT-APPROVED" });

    const r = claudeHook(w);
    expect(r.status).toBe(0);
    expect(w.approved()).toBe(true);
    expect(JSON.parse(r.stdout).hookSpecificOutput).toMatchObject({
      hookEventName: "PostToolUse",
      additionalContext: expect.stringContaining("--apply"),
    });
    const run = await runSkope([w.plan, "--apply", "--no-page"]);
    expect(run.events.at(-1)).toMatchObject({ outcome: "stopped" });
    expect(readFileSync(join(w.repo, "a.txt"), "utf8")).toBe("new\n");
  });

  test.each([
    [
      "a plan changed after the person saw it",
      (w: ReturnType<typeof world>) => claudeHook(w, { plan: w.line.replace(w.hash, "0".repeat(12)) }),
      "changed after",
    ],
    [
      "a transcript outside Claude Code's directory",
      (w: ReturnType<typeof world>) => {
        const t = join(w.root, "fake.jsonl");
        writeFileSync(t, jsonl(exitPlan("toolu_1")));
        return claudeHook(w, { transcript: t });
      },
      "isn't in",
    ],
    [
      "a rejected plan",
      (w: ReturnType<typeof world>) => {
        const t = join(w.claude, "projects", "p", "r.jsonl");
        const rejected = {
          type: "user",
          message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", is_error: true, content: "rejected" }] },
        };
        writeFileSync(t, jsonl(exitPlan("toolu_1"), rejected));
        return claudeHook(w, { transcript: t });
      },
      "rejected",
    ],
    [
      "an older approval replayed",
      (w: ReturnType<typeof world>) => {
        const t = join(w.claude, "projects", "p", "o.jsonl");
        writeFileSync(t, jsonl(exitPlan("toolu_1"), exitPlan("toolu_2")));
        return claudeHook(w, { transcript: t, id: "toolu_1" });
      },
      "latest",
    ],
  ])("doesn't approve %s", (_, go, why) => {
    const w = world();
    const r = go(w);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(why);
    expect(w.approved()).toBe(false);
  });

  test("an approval works once", () => {
    const w = world();
    claudeHook(w);
    expect(w.approved()).toBe(true);
    const again = claudeHook(w, { transcript: join(w.claude, "projects", "p", "s.jsonl") });
    expect(again.stderr).toContain("already used");
  });

  test("a plan that isn't a skope plan, or another tool, is none of its business", () => {
    const w = world();
    const r = claudeHook(w, { plan: "Just prose, no skope line." });
    expect([r.status, r.stdout, r.stderr]).toEqual([0, "", ""]);
    const other = w.hook({ hook_event_name: "PostToolUse", tool_name: "Bash", cwd: w.repo });
    expect([other.status, other.stdout]).toEqual([0, ""]);
  });
});

describe("Codex: UserPromptSubmit with the approval message", () => {
  const session = (w: ReturnType<typeof world>, ...xs: unknown[]) => {
    const t = join(w.codex, "sessions", `s${Math.random()}.jsonl`);
    writeFileSync(t, jsonl(...xs));
    return t;
  };
  const say = (role: string, text: string) => ({
    type: "response_item",
    payload: { type: "message", role, content: [{ type: "input_text", text }] },
  });
  const submit = (w: ReturnType<typeof world>, transcript: string) =>
    w.hook({ hook_event_name: "UserPromptSubmit", prompt: "Implement the plan.", cwd: w.repo, transcript_path: transcript });

  test("approves the plan the transcript last proposed, once", () => {
    const w = world();
    const t = session(w, say("assistant", `<proposed_plan>\n${w.line}\n</proposed_plan>`), say("user", "Implement the plan."));
    expect(submit(w, t).status).toBe(0);
    expect(w.approved()).toBe(true);
    expect(submit(w, t).stderr).toContain("already used");
  });

  test("doesn't approve without the person's message after the plan", () => {
    const w = world();
    const t = session(w, say("user", "Implement the plan."), say("assistant", `<proposed_plan>\n${w.line}\n</proposed_plan>`));
    expect(submit(w, t).stderr).toContain("isn't its approval");
    expect(w.approved()).toBe(false);
  });

  test("any other prompt is none of its business", () => {
    const w = world();
    const r = w.hook({ hook_event_name: "UserPromptSubmit", prompt: "hello", cwd: w.repo, transcript_path: "" });
    expect([r.status, r.stdout, r.stderr]).toEqual([0, "", ""]);
  });
});

describe("--install-hooks", () => {
  test("adds the Claude Code hook, keeping other settings, and replaces its own on a re-install", () => {
    const dir = mkdtempSync(join(tmpdir(), "skope-claude-"));
    writeFileSync(
      join(dir, "settings.json"),
      JSON.stringify({ model: "x", hooks: { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "lint" }] }] } }),
    );
    installClaudeHook(dir, "skope --plan-approved");
    installClaudeHook(dir, "/new/skope --plan-approved");
    const s = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
    expect(s.model).toBe("x");
    expect(s.hooks.PostToolUse).toEqual([
      { matcher: "Bash", hooks: [{ type: "command", command: "lint" }] },
      { matcher: "ExitPlanMode", hooks: [{ type: "command", command: "/new/skope --plan-approved" }] },
    ]);
  });

  test("adds the Codex hook once", () => {
    const dir = mkdtempSync(join(tmpdir(), "skope-codex-"));
    writeFileSync(join(dir, "config.toml"), 'model = "x"\n');
    installCodexHook(dir, "skope --plan-approved");
    installCodexHook(dir, "skope --plan-approved");
    const text = readFileSync(join(dir, "config.toml"), "utf8");
    expect(text.startsWith('model = "x"\n')).toBe(true);
    expect(text.match(/\[\[hooks\.UserPromptSubmit\]\]/g)).toHaveLength(1);
    expect(text).toContain('command = "skope --plan-approved"');
  });

  test("installs for each agent that's set up; a named one even if not", () => {
    const root = mkdtempSync(join(tmpdir(), "skope-agents-"));
    const env = { ...process.env, CLAUDE_CONFIG_DIR: join(root, "claude"), CODEX_HOME: join(root, "codex") };
    mkdirSync(join(root, "claude"));
    const r = spawnSync(process.execPath, [CLI, "--install-hooks"], { env, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(existsSync(join(root, "claude", "settings.json"))).toBe(true);
    expect(existsSync(join(root, "codex", "config.toml"))).toBe(false);
    mkdirSync(join(root, "codex"));
    expect(spawnSync(process.execPath, [CLI, "--install-hooks", "codex"], { env }).status).toBe(0);
    expect(readFileSync(join(root, "codex", "config.toml"), "utf8")).toContain("--plan-approved");
    expect(spawnSync(process.execPath, [CLI, "--install-hooks", "vim"], { env }).status).toBe(40);
  });
});

test("planLine takes the last skope plan line", () => {
  expect(planLine("skope plan: a.md 111111111111\nlater\nskope plan: b.md abcdef012345")).toEqual({ path: "b.md", hash: "abcdef012345" });
  expect(planLine("no plan here")).toBeNull();
});
