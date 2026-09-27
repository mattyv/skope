// A skill's scope (SPEC §7.4): every command it could ever run, listed before it runs, and the
// approval that pins that list. The taint rule (§3.5) is what makes the list finite: a command
// may only hold literals, params, built-ins, and items from the skill's own lists, never output.
// So each command is written out with its list variables expanded to every item; params and
// built-ins stay as `{name}`, since the caller sets them and the safe-value check bounds them.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CoreProgram, Section } from "../contracts.gen.js";

type Stmt = Section["body"][number];
type Parts = ({ lit: string } | { var: string })[];

export interface Command {
  /** `do` changes things; `run` is meant to be read-only, but runs even in a dry run. */
  kind: "run" | "do";
  cmd: string;
  /** Sections it can run from. */
  sections: string[];
}

export interface Effects {
  skill: string;
  hash: string;
  commands: Command[];
  /** Param defaults, for reading. */
  params: Record<string, string | number>;
  /** Params that reach a command with no fixed choices: they stay `{name}`, any value that passes the safe-value check. */
  open_params: string[];
}

/** Every value a list-bound variable can take: a list's items, or its action items' commands. */
function listItems(program: CoreProgram, section: string): { values: string[]; actions: Parts[] } {
  const s = program.sections[section];
  const items = s && "lists" in s ? s.lists.flatMap((l) => l.items) : [];
  return {
    values: items.flatMap((i) => ("value" in i ? [i.value as string] : "action" in i ? [i.action.label] : [])),
    actions: items.flatMap((i) => ("action" in i ? [i.action.cmd as Parts] : [])),
  };
}

/** A command's text for each combination of its list-bound variables. */
function render(parts: Parts, lists: Map<string, string[]>): string[] {
  let out = [""];
  for (const p of parts) {
    const values = "lit" in p ? [p.lit] : (lists.get(p.var) ?? [`{${p.var}}`]);
    out = out.flatMap((prefix) => values.map((v) => prefix + v));
  }
  return out;
}

export function effectsOf(program: CoreProgram, choices: Record<string, (string | number)[]> = {}): Effects {
  const found = new Map<string, Command>();
  const add = (kind: Command["kind"], cmd: string, section: string) => {
    const key = `${kind}\0${cmd}`;
    const c = found.get(key) ?? { kind, cmd, sections: [] };
    if (!c.sections.includes(section)) c.sections.push(section);
    found.set(key, c);
  };
  const bodies = Object.values(program.sections).flatMap((s) => ("body" in s ? [s] : []));
  const each = (body: Stmt[], f: (st: Stmt) => void) => {
    for (const st of body) {
      f(st);
      if ("for_each" in st) each(st.for_each.body as Stmt[], f);
    }
  };

  // Variables live for the whole run, so a list-bound one (a one-of answer, a for-each item) can
  // reach a command in any section. Collect every list each name is bound from, skill-wide.
  // A param with fixed choices can only be one of them, so it expands like a list.
  const lists = new Map<string, string[]>(Object.entries(choices).map(([k, v]) => [k, v.map(String)]));
  const loops = new Map<string, Parts[]>();
  const bind = <T>(m: Map<string, T[]>, name: string, values: T[]) => m.set(name, [...new Set([...(m.get(name) ?? []), ...values])]);
  for (const s of bodies)
    each(s.body, (st) => {
      if ("ask" in st && st.ask.one_of) bind(lists, st.ask.one_of.as, listItems(program, st.ask.one_of.list.section).values);
      if ("for_each" in st) {
        const { values, actions } = listItems(program, st.for_each.list.section);
        bind(lists, st.for_each.var, values);
        bind(loops, st.for_each.var, actions);
      }
    });

  for (const s of bodies)
    each(s.body, (st) => {
      const cmd = (kind: Command["kind"], b: { cmd?: unknown; item?: string } | undefined) => {
        if (!b) return;
        const templates = b.item !== undefined ? (loops.get(b.item) ?? []) : [b.cmd as Parts];
        for (const parts of templates) for (const t of render(parts, lists)) add(kind, t, s.name);
      };
      if ("run" in st) cmd("run", st.run as { cmd?: unknown; item?: string });
      if ("do" in st) cmd("do", st.do as { cmd?: unknown; item?: string });
      if ("if_yes" in st) {
        cmd("run", st.if_yes.run as { cmd?: unknown; item?: string } | undefined);
        cmd("do", st.if_yes.do as { cmd?: unknown; item?: string } | undefined);
      }
      if ("check" in st && "succeeds" in st.check.cond) cmd("run", { cmd: st.check.cond.succeeds });
    });

  const commands = [...found.values()].sort((a, b) => (a.kind === b.kind ? a.cmd.localeCompare(b.cmd) : a.kind === "do" ? -1 : 1));
  // The hash pins what could run, not where: moving a command or rewording prose keeps the approval.
  const hash = `sha256:${createHash("sha256")
    .update(JSON.stringify(commands.map((c) => [c.kind, c.cmd])))
    .digest("hex")}`;
  const params = Object.fromEntries(Object.entries(program.params).map(([k, v]) => [k, "int" in v ? v.int : v.str]));
  const open_params = Object.keys(program.params)
    .filter((k) => !Object.hasOwn(choices, k) && commands.some((c) => c.cmd.includes(`{${k}}`)))
    .sort();
  return { skill: program.skill, hash, commands, params, open_params };
}

/** One line per command added (`+`) or removed (`-`) between two effect sets. */
export function diffEffects(before: Pick<Effects, "commands"> | null, after: Effects): string[] {
  const key = (c: Pick<Command, "kind" | "cmd">) => `${c.kind.padEnd(3)}  ${c.cmd}`;
  const old = new Set((before?.commands ?? []).map(key));
  const now = new Set(after.commands.map(key));
  return [...[...now].filter((k) => !old.has(k)).map((k) => `+ ${k}`), ...[...old].filter((k) => !now.has(k)).map((k) => `- ${k}`)];
}

/** Readable lines for --effects and --approve. */
export function describe(e: Effects): string[] {
  const changes = e.commands.filter((c) => c.kind === "do").length;
  const lines = [
    `skope: ${e.skill} can run ${e.commands.length} command${e.commands.length === 1 ? "" : "s"}, ${changes} of them changing things (${e.hash.slice(0, 19)}…)`,
  ];
  for (const c of e.commands) lines.push(`  ${c.kind.padEnd(3)}  ${c.cmd}    [${c.sections.join(", ")}]`);
  const params = Object.entries(e.params);
  if (params.length > 0) lines.push(`  params (the caller can set): ${params.map(([k, v]) => `${k}=${v}`).join(" ")}`);
  if (e.open_params.length > 0)
    lines.push(`  open params in commands (any safe value; give them choices to pin them): ${e.open_params.join(", ")}`);
  return lines;
}

export interface Approval {
  skill: string;
  effects_hash: string;
  commands: Command[];
  approved_at: string;
  approved_by: string | null;
}

const approvalPath = (dir: string, skill: string) => join(dir, `${skill}.approval.json`);

/** The skill's approval in `dir`, or null if there's none. Throws on a file that isn't one. */
export function readApproval(dir: string, skill: string): Approval | null {
  let text: string;
  try {
    text = readFileSync(approvalPath(dir, skill), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const a = JSON.parse(text) as Approval;
  if (typeof a.effects_hash !== "string" || !Array.isArray(a.commands)) throw new Error(`${approvalPath(dir, skill)} isn't an approval`);
  return a;
}

/** Writes the approval, replacing any older one in one step. Returns its path. */
export function writeApproval(dir: string, e: Effects): string {
  mkdirSync(dir, { recursive: true });
  const path = approvalPath(dir, e.skill);
  const approval: Approval = {
    skill: e.skill,
    effects_hash: e.hash,
    commands: e.commands,
    approved_at: new Date().toISOString(),
    approved_by: process.env.USER ?? process.env.LOGNAME ?? null,
  };
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(approval, null, 2)}\n`);
  renameSync(tmp, path);
  return path;
}
