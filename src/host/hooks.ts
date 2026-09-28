// Plan-mode approval (docs/design/plan-mode.md, item 7). The person approves a plan in their coding
// agent, not in skope, and the agent must not be able to approve its own plan. So the approval is
// written by a hook the agent's tool runs as the user when the person approves:
//
//   - Claude Code: PostToolUse on ExitPlanMode, which runs only once the person approves.
//   - Codex: UserPromptSubmit, when the prompt is Codex's "Implement the plan." (approving a plan in
//     Codex sends that message; there is no approval event).
//
// `skope --plan-approved` is that hook. The approved plan names a skope plan file and its effects
// hash (`skope plan: PATH HASH12`); the hook approves that file only if its effects still have
// that hash, so a plan changed after the person saw it doesn't run. Because the agent could run
// the command itself, it checks the tool's own transcript for the approval too. It never blocks
// the agent: problems go to stderr, and it exits 0.
//
// `skope --install-hooks` adds the hook to ~/.claude/settings.json and ~/.codex/config.toml.

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { lint } from "../lint.js";
import { preprocess } from "../preprocess/index.js";
import { plainText } from "../runner/events.js";
import { effectsOf, writeApproval } from "./effects.js";
import { pinnedStates, planChanges, repoRoot } from "./plan.js";

/** What Codex sends when the person approves a plan (codex-rs/tui/src/chatwidget/plan_implementation.rs). */
export const CODEX_APPROVAL = "Implement the plan.";
const PLAN_LINE = /skope plan: (\S+) ([0-9a-f]{12})\b/g;

export const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
export const codexDir = () => process.env.CODEX_HOME || join(homedir(), ".codex");

/** The last `skope plan: PATH HASH12` line in a text. */
export function planLine(text: string): { path: string; hash: string } | null {
  const all = [...text.matchAll(PLAN_LINE)];
  const m = all.at(-1);
  return m ? { path: m[1] as string, hash: m[2] as string } : null;
}

const inside = (root: string, p: string) => {
  try {
    const r = relative(realpathSync(root), realpathSync(p));
    return r !== "" && !r.startsWith("..") && !isAbsolute(r);
  } catch {
    return false;
  }
};

const lines = (path: string) =>
  readFileSync(path, "utf8")
    .split("\n")
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as unknown];
      } catch {
        return [];
      }
    });

/** Every object nested in `v`, depth first. */
function* objects(v: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(v)) for (const x of v) yield* objects(x);
  else if (v !== null && typeof v === "object") {
    yield v as Record<string, unknown>;
    for (const x of Object.values(v)) yield* objects(x);
  }
}

/**
 * Claude Code: this is the transcript's latest ExitPlanMode call, and it wasn't rejected. Being the
 * latest means an older approval can't be replayed for a newer plan.
 */
export function claudeApproved(transcript: string, toolUseId: string): string | null {
  if (!inside(claudeDir(), transcript)) return `the transcript isn't in ${claudeDir()}`;
  let latest: unknown = null;
  for (const o of objects(lines(transcript))) {
    if (o.type === "tool_use" && o.name === "ExitPlanMode") latest = o.id;
    if (o.type === "tool_result" && o.tool_use_id === toolUseId && o.is_error === true) return "the person rejected that plan";
  }
  if (latest === null) return "the transcript has no ExitPlanMode call";
  return latest === toolUseId ? null : "that isn't the latest plan the person was shown";
}

/**
 * Each approval approves one plan: a ledger in the agent's own config directory (which the agent
 * can't write without asking) records the approvals already used. False if `key` was used.
 */
export function useOnce(dir: string, key: string): boolean {
  const path = join(dir, "skope", "used-approvals");
  const used = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  if (used.includes(key)) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${[...used.filter(Boolean).slice(-999), key].join("\n")}\n`, { mode: 0o600 });
  return true;
}

/** Codex: the transcript's last user message is the approval, after the plan line. Returns the
 * approval's position as its key, or why not. */
export function codexApproved(transcript: string): { key: string } | string {
  if (!inside(codexDir(), transcript)) return `the transcript isn't in ${codexDir()}`;
  const entries = lines(transcript);
  let lastPlan = -1;
  let lastApproval = -1;
  entries.forEach((entry, i) => {
    if (JSON.stringify(entry).match(PLAN_LINE)) lastPlan = i;
    for (const o of objects(entry))
      if (o.role === "user" && JSON.stringify(o).includes(CODEX_APPROVAL)) {
        lastApproval = i;
        break;
      }
  });
  if (lastPlan < 0) return "the transcript has no skope plan line";
  return lastApproval > lastPlan
    ? { key: `${realpathSync(transcript)}:${lastApproval}` }
    : "the transcript's last user message after the plan isn't its approval";
}

/** Approves `file` if it's a plan whose effects hash starts with `hash`. Null on success, else why not. */
export function approvePlan(file: string, hash: string): string | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    return `can't read ${file}: ${(err as Error).message}`;
  }
  const parsed = preprocess(text);
  if ("errors" in parsed) return `${file} doesn't parse: ${parsed.errors.map((e) => `${e.code} at line ${e.line}`).join(", ")}`;
  const { program, choices } = parsed;
  const found = lint(program);
  if (found.errors.length > 0) return `${file} doesn't lint: ${found.errors.map((e) => `${e.code} at line ${e.line}`).join(", ")}`;
  if (program.kind !== "plan") return `${file} isn't a plan (kind: plan)`;
  const effects = effectsOf(program, choices);
  if (!effects.hash.startsWith(`sha256:${hash}`))
    return `${file} changed after the person saw it (its effects are ${effects.hash.slice(7, 19)}, the approved plan said ${hash})`;
  const dir = dirname(resolve(file));
  writeApproval(dir, effects, pinnedStates(repoRoot(dir), planChanges(program)));
  return null;
}

/** `skope --plan-approved`: the hook. Always exits 0; says what it did on stderr (and, for Claude Code, as context). */
export function planApproved(stdin: string, out: (s: string) => void, err: (s: string) => void): number {
  const say = (s: string) => err(plainText(`skope: ${s}\n`));
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(stdin) as Record<string, unknown>;
  } catch {
    say("--plan-approved is a hook: it reads the hook's JSON on stdin (skope --install-hooks sets it up)");
    return 0;
  }
  const event = input.hook_event_name;
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  const transcript = typeof input.transcript_path === "string" ? input.transcript_path : "";
  let text: string;
  let check: () => string | null;
  let claude = false;
  if (event === "PostToolUse" && input.tool_name === "ExitPlanMode") {
    // The approved text, after any edits the person made (tool_response.plan), else what was proposed.
    const resp = input.tool_response as { plan?: unknown } | undefined;
    const inp = input.tool_input as { plan?: unknown } | undefined;
    text = typeof resp?.plan === "string" ? resp.plan : typeof inp?.plan === "string" ? inp.plan : "";
    const id = String(input.tool_use_id ?? "");
    check = () => claudeApproved(transcript, id) ?? (useOnce(claudeDir(), id) ? null : "that approval was already used");
    claude = true;
  } else if (
    event === "UserPromptSubmit" &&
    typeof input.prompt === "string" &&
    input.prompt.trim().startsWith(CODEX_APPROVAL.slice(0, -1))
  ) {
    // "Implement the plan." carries no plan text; the clear-context variant carries the plan itself.
    let transcriptText = "";
    try {
      transcriptText = readFileSync(transcript, "utf8");
    } catch {}
    text = input.prompt.includes("skope plan:") ? input.prompt : transcriptText;
    check = () => {
      if (input.prompt !== CODEX_APPROVAL) return inside(codexDir(), transcript) ? null : `the transcript isn't in ${codexDir()}`;
      const r = codexApproved(transcript);
      if (typeof r === "string") return r;
      return useOnce(codexDir(), r.key) ? null : "that approval was already used";
    };
  } else return 0; // not a plan approval
  const plan = planLine(text);
  if (!plan) return 0; // not a skope plan
  const file = resolve(cwd, plan.path);
  const why = check() ?? approvePlan(file, plan.hash);
  if (why !== null) {
    say(`didn't approve ${plan.path}: ${why}`);
    return 0;
  }
  const next = `skope approved ${plan.path} (${plan.hash}). Run it with: SKOPE_CALLER=agent skope ${plan.path} --apply`;
  say(`approved ${plan.path}`);
  if (claude) out(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: next } })}\n`);
  else out(`${next}\n`);
  return 0;
}

/** How a hook should run this skope: the standalone binary, or node with this CLI script. */
export function selfCommand(): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const script = process.argv[1];
  return script?.endsWith(".js")
    ? `${q(process.execPath)} ${q(resolve(script))} --plan-approved`
    : `${q(process.execPath)} --plan-approved`;
}

/** Adds the hook to Claude Code's settings.json. Replaces an older skope hook. Returns what it did. */
export function installClaudeHook(dir: string, command: string): string {
  const path = join(dir, "settings.json");
  const settings = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>) : {};
  settings.hooks ??= {};
  const hooks = settings.hooks as Record<string, unknown[]>;
  hooks.PostToolUse ??= [];
  const post = hooks.PostToolUse as { matcher?: string; hooks?: { type: string; command: string }[] }[];
  const ours = (h: { command?: string }) => h.command?.includes("--plan-approved") === true;
  for (const entry of post) entry.hooks = (entry.hooks ?? []).filter((h) => !ours(h));
  hooks.PostToolUse = post.filter((e) => (e.hooks ?? []).length > 0);
  (hooks.PostToolUse as unknown[]).push({ matcher: "ExitPlanMode", hooks: [{ type: "command", command }] });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  return path;
}

/** Adds the hook to Codex's config.toml, unless it's there. Codex asks the person to trust it (/hooks). */
export function installCodexHook(dir: string, command: string): string {
  const path = join(dir, "config.toml");
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (text.includes("--plan-approved")) return path;
  const block = [
    "",
    "# skope: approve a skope plan when the person approves it in plan mode (skope --install-hooks)",
    "[[hooks.UserPromptSubmit]]",
    "[[hooks.UserPromptSubmit.hooks]]",
    'type = "command"',
    `command = ${JSON.stringify(command)}`,
    "",
  ].join("\n");
  writeFileSync(path, `${text.replace(/\n*$/, "\n")}${block}`);
  return path;
}

/** `skope --install-hooks [claude|codex]`: both, for the agents that are set up here, unless one is named. */
export function installHooks(which?: string): number {
  if (which !== undefined && which !== "claude" && which !== "codex") {
    process.stderr.write("skope: --install-hooks takes claude or codex, or nothing for both\n");
    return 40;
  }
  const command = selfCommand();
  let done = 0;
  const targets = [
    { name: "claude", dir: claudeDir(), install: installClaudeHook, note: "" },
    { name: "codex", dir: codexDir(), install: installCodexHook, note: "; trust it in Codex with /hooks" },
  ];
  for (const t of targets) {
    if (which !== undefined && which !== t.name) continue;
    if (which === undefined && !existsSync(t.dir)) continue;
    try {
      const path = t.install(t.dir, command);
      process.stderr.write(plainText(`skope: installed the plan-approval hook in ${path}${t.note}\n`));
      done++;
    } catch (err) {
      process.stderr.write(plainText(`skope: couldn't install the hook in ${t.dir}: ${(err as Error).message}\n`));
      return 50;
    }
  }
  if (done === 0) process.stderr.write(plainText(`skope: neither ${claudeDir()} nor ${codexDir()} exists; nothing to install into\n`));
  return 0;
}
