// What a plan does to files, worked out without running it (docs/design/plan-mode.md): the static
// diff that --effects --diff prints, and the file states --approve pins so a run can refuse files
// that changed since the person approved (E-PLAN-STALE). Both apply the plan's changes in document
// order to in-memory copies, with the same rules a run uses (src/runner/change.ts).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { CoreProgram, Section } from "../contracts.gen.js";
import { type Change, changeText, currentText } from "../runner/change.js";

/** The git work tree `dir` is in, else `dir` itself: what a plan's paths are relative to. */
export function repoRoot(dir: string): string {
  try {
    return (
      execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() ||
      dir
    );
  } catch {
    return dir;
  }
}

/** Claude writes plans under its config directory in plan mode. For those plans, use the
 * repository the agent is working in; plans elsewhere retain their file-based root. */
export function rootForPlan(file: string, cwd: string, claudeConfigDir: string): string {
  try {
    const rel = relative(realpathSync(join(claudeConfigDir, "plans")), realpathSync(file));
    if (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)) return realpathSync(repoRoot(cwd));
  } catch {
    // No Claude plans directory, or this isn't a file in it.
  }
  // A plan in `.skope/plans/` belongs to the folder holding `.skope`, git work tree or not.
  const dir = dirname(resolve(file));
  const home = basename(dir) === "plans" && basename(dirname(dir)) === ".skope" ? dirname(dirname(dir)) : dir;
  return realpathSync(repoRoot(home));
}

/** Every change in the plan, in document order, loops included. */
export function planChanges(program: CoreProgram): Change[] {
  const out: Change[] = [];
  const walk = (body: Section["body"]) => {
    for (const st of body) {
      if ("change" in st) out.push(st.change as Change);
      if ("for_each" in st) walk(st.for_each.body as Section["body"]);
    }
  };
  for (const s of Object.values(program.sections)) if ("body" in s) walk(s.body);
  return out;
}

const sha = (t: string | null) => (t === null ? "none" : `sha256:${createHash("sha256").update(t).digest("hex")}`);

/**
 * Each touched file's text now, then after each of its changes in order. A change that can't apply
 * in the simulation ends that file's list: a run would stop there too.
 */
export function fileSteps(root: string, changes: Change[]): Map<string, { texts: (string | null)[]; error: string | null }> {
  const out = new Map<string, { texts: (string | null)[]; error: string | null }>();
  for (const c of changes) {
    let f = out.get(c.path);
    if (!f) {
      try {
        f = { texts: [currentText(root, c.path)], error: null };
      } catch (err) {
        f = { texts: [], error: (err as Error).message };
      }
      out.set(c.path, f);
    }
    if (f.error !== null) continue;
    try {
      const r = changeText(f.texts.at(-1) ?? null, c);
      if (r.result === "applied") f.texts.push(r.after);
    } catch (err) {
      f.error = (err as Error).message;
    }
  }
  return out;
}

/** A file's hash as the pins record it, or null if it can't be read. */
export function fileHash(root: string, path: string): string | null {
  try {
    return sha(currentText(root, path));
  } catch {
    return null;
  }
}

/** For --approve: each touched file's hash now and after each of its changes. */
export function pinnedStates(root: string, changes: Change[]): Record<string, string[]> {
  return Object.fromEntries([...fileSteps(root, changes)].map(([p, f]) => [p, f.texts.map(sha)]));
}

/** Files whose content is none of the states the approval pinned: changed by someone else since. */
export function staleFiles(root: string, pinned: Record<string, string[]>): string[] {
  return Object.entries(pinned)
    .filter(([path, states]) => {
      try {
        return !states.includes(sha(currentText(root, path)));
      } catch {
        return true;
      }
    })
    .map(([path]) => path);
}

/** One unified diff of the whole plan, file by file, as if every change applied in order. */
export function planDiff(root: string, changes: Change[]): string {
  const out: string[] = [];
  for (const [path, f] of fileSteps(root, changes)) {
    if (f.error !== null) out.push(`# ${path}: ${f.error}`);
    const before = f.texts[0] ?? null;
    const after = f.texts.at(-1) ?? null;
    if (f.texts.length > 1) out.push(unifiedDiff(path, before, after));
  }
  return out.join("");
}

/** A unified diff with 3 lines of context. Plans change little per file, so a plain LCS on the
 * part between the common prefix and suffix is fast enough. */
export function unifiedDiff(path: string, before: string | null, after: string | null): string {
  const a = before === null ? [] : before.replace(/\n$/, "").split("\n");
  const b = after === null ? [] : after.replace(/\n$/, "").split("\n");
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const am = a.slice(pre, a.length - suf);
  const bm = b.slice(pre, b.length - suf);
  // LCS table over the middle, flat: L(i, j) is the LCS length of am[i..] and bm[j..].
  const n = am.length;
  const m = bm.length;
  const T = new Uint32Array((n + 1) * (m + 1));
  const L = (i: number, j: number) => T[i * (m + 1) + j] as number;
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) T[i * (m + 1) + j] = am[i] === bm[j] ? L(i + 1, j + 1) + 1 : Math.max(L(i + 1, j), L(i, j + 1));
  type Op = { t: " " | "-" | "+"; s: string; ai: number; bi: number };
  const ops: Op[] = [];
  const at = (xs: string[], k: number) => xs[k] as string;
  for (let k = 0; k < pre; k++) ops.push({ t: " ", s: at(a, k), ai: k, bi: k });
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && am[i] === bm[j]) ops.push({ t: " ", s: at(am, i), ai: pre + i++, bi: pre + j++ });
    else if (i < n && (j === m || L(i + 1, j) >= L(i, j + 1))) ops.push({ t: "-", s: at(am, i), ai: pre + i++, bi: pre + j });
    else ops.push({ t: "+", s: at(bm, j), ai: pre + i, bi: pre + j++ });
  }
  for (let k = 0; k < suf; k++) ops.push({ t: " ", s: at(a, a.length - suf + k), ai: a.length - suf + k, bi: b.length - suf + k });

  const lines = [`--- ${before === null ? "/dev/null" : `a/${path}`}`, `+++ ${after === null ? "/dev/null" : `b/${path}`}`];
  const changed = ops.map((o, k) => (o.t === " " ? -1 : k)).filter((k) => k >= 0);
  let h = 0;
  while (h < changed.length) {
    const start = Math.max(0, (changed[h] as number) - 3);
    let end = Math.min(ops.length, (changed[h] as number) + 4);
    while (h + 1 < changed.length && (changed[h + 1] as number) - 3 <= end) end = Math.min(ops.length, (changed[++h] as number) + 4);
    h++;
    const hunk = ops.slice(start, end);
    const aLen = hunk.filter((o) => o.t !== "+").length;
    const bLen = hunk.filter((o) => o.t !== "-").length;
    const aStart = aLen === 0 ? (hunk[0]?.ai ?? 0) : (hunk.find((o) => o.t !== "+")?.ai ?? 0) + 1;
    const bStart = bLen === 0 ? (hunk[0]?.bi ?? 0) : (hunk.find((o) => o.t !== "-")?.bi ?? 0) + 1;
    lines.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`, ...hunk.map((o) => o.t + o.s));
  }
  return `${lines.join("\n")}\n`;
}
