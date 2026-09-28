// A harness for plan-mode scenarios (tests/e2e/README.md): a repository, Claude Code and Codex
// config directories, and a simulated session in each tool that does what the real one does:
// write the transcript the way the tool does, call `skope --plan-approved` as the tool's hook
// would, and run the plan as an agent would. Everything goes through the built CLI.

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CLI = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

export type Event = { event: string } & Record<string, unknown>;
export interface Result {
  code: number | null;
  stdout: string;
  stderr: string;
  events: Event[];
  error?: Event;
}

/** A repository with `files` (git unless `git: false`), and the agent tools' config directories. */
export function world(files: Record<string, string | Buffer>, opts: { git?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "skope-e2e-"));
  const repo = join(root, "repo");
  mkdirSync(repo);
  if (opts.git !== false) execFileSync("git", ["init", "-q"], { cwd: repo });
  for (const [p, c] of Object.entries(files)) write(p, c);
  const claude = join(root, "claude");
  const codex = join(root, "codex");
  mkdirSync(join(claude, "projects", "p"), { recursive: true });
  mkdirSync(join(claude, "plans"), { recursive: true });
  mkdirSync(join(codex, "sessions"), { recursive: true });
  const config = join(root, "config.yaml");
  writeFileSync(config, `state_dir: ${join(root, "state")}\npager:\n  command: "cat > /dev/null"\n`);
  const env = { ...process.env, CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex, SKOPE_CALLER: "agent" };
  delete (env as Record<string, string | undefined>).SKOPE_RECORD;

  function write(rel: string, content: string | Buffer) {
    const p = join(repo, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  const read = (rel: string) => readFileSync(join(repo, rel), "utf8");
  const exists = (rel: string) => existsSync(join(repo, rel));

  /** Runs the CLI as the agent would, from `cwd` (default: the repository root). */
  function skope(args: string[], cwd = repo, input?: string): Result {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env, input, encoding: "utf8" });
    const events = r.stdout
      .split("\n")
      .filter((l) => l.startsWith("{"))
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as Event];
        } catch {
          return [];
        }
      });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr, events, error: events.find((e) => e.event === "error") };
  }

  return { root, repo, claude, codex, config, env, write, read, exists, skope };
}
export type World = ReturnType<typeof world>;

/** A skope plan: frontmatter, the skope block, then `body` (sections). */
export const plan = (name: string, body: string) =>
  `---\nname: ${name}\ndescription: a test plan\n---\n\n# ${name}\n\n*A skope plan.*\n\n\`\`\`skope\nformat: 1\nkind: plan\n\`\`\`\n\n${body.trim()}\n`;

/** `- **edit** \`path\`` with its old and new blocks. */
export const edit = (path: string, old: string, neu: string) =>
  `- **edit** \`${path}\`\n  \`\`\`old\n${indent(old)}  \`\`\`\n  \`\`\`new\n${indent(neu)}  \`\`\``;
export const create = (path: string, text: string) => `- **create** \`${path}\`\n  \`\`\`new\n${indent(text)}  \`\`\``;
const indent = (s: string) =>
  s
    .split("\n")
    .filter((l, i, a) => i < a.length - 1 || l !== "")
    .map((l) => `  ${l}\n`)
    .join("");

const jsonl = (x: unknown) => `${JSON.stringify(x)}\n`;

interface Session {
  tool: "claude" | "codex";
  /** The plan file and the path the agent names in the `skope plan:` line. */
  file: string;
  path: string;
  write(md: string): void;
  /** Lint, --effects, and put the plan with its `skope plan:` line in front of the person. */
  present(): { hash: string; line: string; lint: Result };
  approve(opts?: { cwd?: string }): Result;
  reject(): void;
  apply(extra?: string[], cwd?: string): Result;
}

/** Claude Code: the plan is Claude's own plan file; approval is PostToolUse on ExitPlanMode. */
export function claudeSession(w: World, name: string): Session {
  const file = join(w.claude, "plans", `${name}.md`);
  const transcript = join(w.claude, "projects", "p", `${name}.jsonl`);
  writeFileSync(transcript, "");
  let calls = 0;
  let current: { id: string; line: string } | null = null;
  return {
    tool: "claude",
    file,
    path: file,
    write: (md) => writeFileSync(file, md),
    present() {
      const lint = w.skope([file, "--lint"]);
      const effects = w.skope([file, "--effects", "--diff"]);
      const hash = String(JSON.parse(effects.stdout.trim().split("\n").at(-1) as string).effects_hash).slice(7);
      const line = `skope plan: ${file} ${hash}`;
      current = { id: `toolu_${name}_${++calls}`, line };
      // The tool call reaches the transcript as the agent makes it; its result only once the person decides.
      appendFileSync(
        transcript,
        jsonl({ type: "assistant", message: { content: [{ type: "tool_use", id: current.id, name: "ExitPlanMode", input: {} }] } }),
      );
      return { hash, line, lint };
    },
    approve(opts = {}) {
      if (!current) throw new Error("present the plan first");
      const text = `Here's the plan.\n\n${current.line}\n`;
      const r = w.skope(
        ["--plan-approved"],
        w.repo,
        JSON.stringify({
          hook_event_name: "PostToolUse",
          tool_name: "ExitPlanMode",
          tool_use_id: current.id,
          cwd: opts.cwd ?? w.repo,
          transcript_path: transcript,
          tool_input: { plan: text, planFilePath: file },
          tool_response: { plan: text, filePath: file },
        }),
      );
      // Claude writes the result after the hook has run.
      appendFileSync(
        transcript,
        jsonl({
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: current.id,
                content: [{ type: "text", text: `User has approved your plan.\n\n${text}` }],
              },
            ],
          },
        }),
      );
      return r;
    },
    reject() {
      if (!current) throw new Error("present the plan first");
      appendFileSync(
        transcript,
        jsonl({
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: current.id, is_error: true, content: "The user doesn't want to proceed." }],
          },
        }),
      );
    },
    apply: (extra = [], cwd = w.repo) => w.skope([file, "--apply", "--no-page", "--config", w.config, ...extra], cwd),
  };
}

/** Codex: the plan is in the repository; approving sends "Implement the plan." (UserPromptSubmit). */
export function codexSession(w: World, name: string, opts: { clearContext?: boolean } = {}): Session {
  const path = `.skope/plans/${name}.md`;
  const file = join(w.repo, path);
  const transcript = join(w.codex, "sessions", `${name}.jsonl`);
  writeFileSync(transcript, "");
  let current: string | null = null;
  const message = (role: string, text: string) =>
    jsonl({
      type: "response_item",
      payload: { type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text }] },
    });
  return {
    tool: "codex",
    file,
    path,
    write: (md) => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, md);
    },
    present() {
      const lint = w.skope([path, "--lint"]);
      const effects = w.skope([path, "--effects", "--diff"]);
      const hash = String(JSON.parse(effects.stdout.trim().split("\n").at(-1) as string).effects_hash).slice(7);
      current = `skope plan: ${path} ${hash}`;
      appendFileSync(transcript, message("assistant", `<proposed_plan>\nHere's the plan.\n\n${current}\n</proposed_plan>`));
      return { hash, line: current, lint };
    },
    approve(o = {}) {
      if (!current) throw new Error("present the plan first");
      const prompt = opts.clearContext
        ? `A previous agent produced the plan below to accomplish the user's task. Implement the plan in a fresh context.\n\n${current}\n`
        : "Implement the plan.";
      // Codex writes the person's message to the session before the hook runs.
      appendFileSync(transcript, message("user", prompt));
      return w.skope(
        ["--plan-approved"],
        w.repo,
        JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd: o.cwd ?? w.repo, transcript_path: transcript }),
      );
    },
    reject() {
      if (!current) throw new Error("present the plan first");
      appendFileSync(transcript, message("user", "No, keep planning."));
    },
    apply: (extra = [], cwd = w.repo) => w.skope([path, "--apply", "--no-page", "--config", w.config, ...extra], cwd),
  };
}

export const sessions = { claude: claudeSession, codex: codexSession } as const;
