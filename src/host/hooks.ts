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

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { lint } from "../lint.js";
import { preprocess } from "../preprocess/index.js";
import { plainText } from "../runner/events.js";
import { effectsOf, writeApproval } from "./effects.js";
import { pinnedStates, planChanges, repoRoot } from "./plan.js";

/** What Codex sends when the person approves a plan (codex-rs/tui/src/chatwidget/plan_implementation.rs). */
export const CODEX_APPROVAL = "Implement the plan.";
const PLAN_LINE = /skope plan: (\S+) ([0-9a-f]{64})\b/g;
/** The start of Codex's "clear context and implement" message, which carries the plan itself (plan_implementation.rs). */
export const CODEX_CLEAR_CONTEXT =
  "A previous agent produced the plan below to accomplish the user's task. Implement the plan in a fresh context";

export const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
export const codexDir = () => process.env.CODEX_HOME || join(homedir(), ".codex");

/** The last `skope plan: PATH HASH` line in a text (HASH: the plan's whole sha256 effects hash, in hex). */
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
 * Claude Code: the transcript records the latest ExitPlanMode call, its successful result, and the
 * same plan the hook is about to approve. An older or still-pending call cannot approve a plan.
 */
export function claudeApproved(transcript: string, toolUseId: string, plan: { path: string; hash: string }): string | null {
  if (!inside(claudeDir(), transcript)) return `the transcript isn't in ${claudeDir()}`;
  let latest: unknown = null;
  let proposed: string | null = null;
  let returned: string | null = null;
  let succeeded = false;
  for (const entry of lines(transcript)) {
    if (entry === null || typeof entry !== "object") continue;
    const e = entry as { type?: unknown; message?: { content?: unknown } };
    const blocks = e.message?.content;
    if (!Array.isArray(blocks)) continue;
    for (const o of blocks) {
      if (o === null || typeof o !== "object") continue;
      if (e.type === "assistant" && o.type === "tool_use" && o.name === "ExitPlanMode") {
        latest = o.id;
        const input = o.input as { plan?: unknown } | undefined;
        if (o.id === toolUseId) proposed = typeof input?.plan === "string" ? input.plan : null;
      }
      if (e.type === "user" && o.type === "tool_result" && o.tool_use_id === toolUseId) {
        if (o.is_error === true) return "the person rejected that plan";
        succeeded = true;
        // Claude may put the person's edited plan in the result. Use that when it is recorded.
        returned =
          [...objects(o.content)]
            .flatMap((x) => Object.values(x).filter((v): v is string => typeof v === "string"))
            .find((v) => planLine(v) !== null) ?? (typeof o.content === "string" ? o.content : null);
      }
    }
  }
  if (latest === null) return "the transcript has no ExitPlanMode call";
  if (latest !== toolUseId) return "that isn't the latest plan the person was shown";
  if (!succeeded) return "the transcript has no successful ExitPlanMode result";
  const reviewed = planLine(returned ?? proposed ?? "");
  if (!reviewed) return "the transcript has no skope plan line for that approval";
  return reviewed.path === plan.path && reviewed.hash === plan.hash ? null : "the hook's plan differs from the approved transcript";
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

const NO_PLAN_LINE = "the approved plan has no skope plan line";

/** The text of a Codex transcript entry's user message, if it is one. */
function userText(entry: unknown): string | null {
  for (const o of objects(entry))
    if (o.role === "user") {
      const texts = [...objects(o)].flatMap((x) => (typeof x.text === "string" ? [x.text] : []));
      return texts.join("\n") || (typeof o.content === "string" ? o.content : "");
    }
  return null;
}

/**
 * Codex: the transcript's last user message is the approval, and the plan is the one the person
 * approved: the last `<proposed_plan>` before that message ("Implement the plan."), or the plan
 * inside it (the clear-context message). Returns the plan line and a key for the approval, or why
 * not. Fails closed if the transcript doesn't have the message yet.
 */
export function codexApproved(transcript: string): { key: string; plan: { path: string; hash: string } } | string {
  if (!inside(codexDir(), transcript)) return `the transcript isn't in ${codexDir()}`;
  const entries = lines(transcript);
  let at = -1;
  for (let i = entries.length - 1; i >= 0 && at < 0; i--) if (userText(entries[i]) !== null) at = i;
  const approval = at < 0 ? "" : (userText(entries[at]) ?? "").trim();
  let source: string | null = null;
  if (approval === CODEX_APPROVAL) {
    for (let i = at - 1; i >= 0 && source === null; i--) {
      const m = [...JSON.stringify(entries[i]).matchAll(/<proposed_plan>([\s\S]*?)<\/proposed_plan>/g)].at(-1);
      if (m) source = JSON.parse(`"${m[1]}"`) as string;
    }
    if (source === null) return "no plan was proposed before the approval";
  } else if (approval.startsWith(CODEX_CLEAR_CONTEXT)) source = approval;
  else return "the transcript's last user message isn't a plan approval";
  const plan = planLine(source);
  if (!plan) return NO_PLAN_LINE;
  return { key: `${realpathSync(transcript)}:${at}`, plan };
}

/** Where an agent's tool keeps approvals of skope plans: in its own config directory, which the
 * agent can't write without asking, never in the repository. */
export const planApprovalsDir = (agentDir: string) => join(agentDir, "skope", "approvals");
/** A plan's approval file name: from its real path, so each plan file has its own. */
export const planApprovalName = (file: string) => `plan-${createHash("sha256").update(realpathSync(file)).digest("hex").slice(0, 32)}`;

/** Approves `file` into `agentDir` if it's a plan whose effects hash is `hash`. Null on success, else why not. */
export function approvePlan(file: string, hash: string, agentDir: string): string | null {
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
  if (effects.hash !== `sha256:${hash}`)
    return `${file} changed after the person saw it (its effects are ${effects.hash.slice(7, 19)}…, the approved plan said ${hash.slice(0, 12)}…)`;
  writeApproval(
    planApprovalsDir(agentDir),
    effects,
    pinnedStates(repoRoot(dirname(resolve(file))), planChanges(program)),
    planApprovalName(file),
  );
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
  let plan: { path: string; hash: string } | null;
  let check: () => string | null;
  let agentDir: string;
  let claude = false;
  if (event === "PostToolUse" && input.tool_name === "ExitPlanMode") {
    // The approved text, after any edits the person made (tool_response.plan), else what was proposed.
    const resp = input.tool_response as { plan?: unknown } | undefined;
    const inp = input.tool_input as { plan?: unknown } | undefined;
    plan = planLine(typeof resp?.plan === "string" ? resp.plan : typeof inp?.plan === "string" ? inp.plan : "");
    const id = String(input.tool_use_id ?? "");
    check = () =>
      claudeApproved(transcript, id, plan as { path: string; hash: string }) ??
      (useOnce(claudeDir(), id) ? null : "that approval was already used");
    agentDir = claudeDir();
    claude = true;
  } else if (
    event === "UserPromptSubmit" &&
    typeof input.prompt === "string" &&
    (input.prompt.trim() === CODEX_APPROVAL || input.prompt.startsWith(CODEX_CLEAR_CONTEXT))
  ) {
    // Only what the transcript says the person approved counts, never the hook's input.
    const r = codexApproved(transcript);
    if (typeof r === "string") {
      if (r !== NO_PLAN_LINE) say(`didn't approve the plan: ${r}`);
      return 0;
    }
    plan = r.plan;
    check = () => (useOnce(codexDir(), r.key) ? null : "that approval was already used");
    agentDir = codexDir();
  } else return 0; // not a plan approval
  if (!plan) return 0; // not a skope plan
  const why = check() ?? approvePlan(resolve(repoRoot(cwd), plan.path), plan.hash, agentDir);
  if (why !== null) {
    say(`didn't approve ${plan.path}: ${why}`);
    return 0;
  }
  const next = `skope approved ${plan.path}. Run it with: SKOPE_CALLER=agent skope ${plan.path} --apply`;
  say(`approved ${plan.path}`);
  if (claude) out(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: next } })}\n`);
  else out(`${next}\n`);
  return 0;
}

/** How a hook should run this skope: the standalone binary, or node with this CLI script. */
export function selfCommand(): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  // npm's bin is a symlink to the script: resolve it, or the hook would run node with no script.
  const script = process.argv[1] ? realpathSync(process.argv[1]) : undefined;
  return script?.endsWith(".js")
    ? `${q(process.execPath)} ${q(resolve(script))} --plan-approved`
    : `${q(process.execPath)} --plan-approved`;
}

/** Adds the hook to Claude Code's settings.json. Replaces an older skope hook. Returns what it did. */
export function installClaudeHook(dir: string, command: string): string {
  const path = join(dir, "settings.json");
  const settings = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>) : {};
  const isObj = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isObj(settings) || (settings.hooks !== undefined && !isObj(settings.hooks)))
    throw new Error(`${path} isn't shaped as expected; add the hook by hand (see SPEC §4.9)`);
  settings.hooks ??= {};
  const hooks = settings.hooks as Record<string, unknown[]>;
  if (hooks.PostToolUse !== undefined && !Array.isArray(hooks.PostToolUse))
    throw new Error(`${path}: hooks.PostToolUse isn't a list; add the hook by hand (see SPEC §4.9)`);
  hooks.PostToolUse ??= [];
  const post = hooks.PostToolUse as { matcher?: string; hooks?: { type: string; command: string }[] }[];
  const ours = (h: { command?: string }) => h.command?.includes("--plan-approved") === true;
  for (const entry of post) entry.hooks = (entry.hooks ?? []).filter((h) => !ours(h));
  hooks.PostToolUse = post.filter((e) => (e.hooks ?? []).length > 0);
  (hooks.PostToolUse as unknown[]).push({ matcher: "ExitPlanMode", hooks: [{ type: "command", command }] });
  writeAtomic(path, `${JSON.stringify(settings, null, 2)}\n`);
  return path;
}

/** Writes a temp file beside `path` and renames it over, so a crash never leaves half a config. */
function writeAtomic(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.skope-${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/** Adds the hook to Codex's config.toml, unless it's there. Codex asks the person to trust it (/hooks). */
export function installCodexHook(dir: string, command: string): string {
  const path = join(dir, "config.toml");
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (text.includes("--plan-approved")) return path;
  // A second UserPromptSubmit table would be a duplicate key if the file declares one inline: say what to add instead.
  if (/UserPromptSubmit/.test(text))
    throw new Error(
      `${path} already has UserPromptSubmit hooks; add this to them by hand: { type = "command", command = ${JSON.stringify(command)} }`,
    );
  const block = [
    "",
    "# skope: approve a skope plan when the person approves it in plan mode (skope --install-hooks)",
    "[[hooks.UserPromptSubmit]]",
    "[[hooks.UserPromptSubmit.hooks]]",
    'type = "command"',
    `command = ${JSON.stringify(command)}`,
    "",
  ].join("\n");
  writeAtomic(path, `${text.replace(/\n*$/, "\n")}${block}`);
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
