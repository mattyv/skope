// Plan changes (docs/design/plan-mode.md): `edit`, `create` and `delete`, applied by the host.
// To the core each is a `do` of its descriptor; the host applies it here, by the statement's
// line, and never runs it as a command.
//
// Rules: the path stays inside the root (no `..`, no absolute path, nothing under `.git/`, no
// symlink out); text files only (no NUL bytes, valid UTF-8, one kind of line ending); an edit's
// old text matches whole lines, exactly once unless `all`; a change that's already in place counts
// as applied, so a plan can be re-run after a partial failure. Writes go to a temp file that's
// renamed over the original, keeping its mode.

import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { patchText } from "./patch.js";

export interface Change {
  op: "edit" | "create" | "delete" | "patch";
  path: string;
  old?: string;
  new?: string;
  all?: boolean;
  patch?: string;
}

export type ChangeResult = { result: "applied" | "already_applied" } | { result: "failed"; message: string };

class Refused extends Error {}

const inside = (root: string, p: string) => {
  const r = relative(root, p);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};

/** The real path the change may touch, or why not. */
function target(root: string, path: string): string {
  const segs = path.split(/[/\\]/);
  if (isAbsolute(path) || segs.includes("..")) throw new Refused(`${path}: the path must be relative and stay inside ${root}`);
  const realRoot = realpathSync(root);
  const abs = join(realRoot, path);
  // The nearest part that exists decides where symlinks lead.
  let probe = abs;
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  const real = join(realpathSync(probe), relative(probe, abs));
  if (!inside(realRoot, real)) throw new Refused(`${path}: resolves outside ${realRoot}`);
  const rel = relative(realRoot, real);
  if (rel === ".git" || rel.startsWith(`.git${sep}`)) throw new Refused(`${path}: skope never changes files under .git`);
  if (existsSync(abs) && lstatSync(abs).isSymbolicLink() && !inside(realRoot, realpathSync(abs)))
    throw new Refused(`${path}: a symlink that leads outside ${realRoot}`);
  return real;
}

function readText(path: string, file: string): { text: string; eol: "\n" | "\r\n"; finalNewline: boolean } {
  const buf = readFileSync(file);
  if (buf.includes(0)) throw new Refused(`${path}: a binary file (it has NUL bytes)`);
  const raw = buf.toString("utf8");
  if (!raw.isWellFormed() || Buffer.from(raw, "utf8").compare(buf) !== 0) throw new Refused(`${path}: not valid UTF-8`);
  const crlf = (raw.match(/\r\n/g) ?? []).length;
  const lf = (raw.match(/\n/g) ?? []).length - crlf;
  if (crlf > 0 && lf > 0) throw new Refused(`${path}: mixed line endings (${crlf} CRLF, ${lf} LF)`);
  const eol = crlf > 0 ? "\r\n" : "\n";
  const text = eol === "\r\n" ? raw.replace(/\r\n/g, "\n") : raw;
  const finalNewline = text === "" || text.endsWith("\n");
  return { text, eol, finalNewline };
}

/** Where `needle` (whole lines, ending in a newline) starts at a line start in `text`. */
function lineMatches(text: string, needle: string): number[] {
  const at: number[] = [];
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) if (i === 0 || text[i - 1] === "\n") at.push(i);
  return at;
}

const withNewline = (s: string) => (s === "" || s.endsWith("\n") ? s : `${s}\n`);

function writeText(file: string, text: string, eol: "\n" | "\r\n", finalNewline: boolean, mode?: number) {
  let out = finalNewline ? text : text.replace(/\n$/, "");
  if (eol === "\r\n") out = out.replace(/\n/g, "\r\n");
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.skope-tmp-${randomUUID()}`;
  try {
    // Exclusive creation refuses an existing path, including a symlink. The random name also
    // keeps another process from preparing the path before skope opens it.
    writeFileSync(tmp, out, { flag: "wx", mode: mode ?? 0o644 });
    if (mode !== undefined) chmodSync(tmp, mode);
    renameSync(tmp, file);
  } finally {
    rmSync(tmp, { force: true });
  }
}

/**
 * What a change does to a file's text (null: no file), with line endings already normalised to
 * `\n`. Pure, so the static diff and the stale check use the same rules as a run. Throws Refused.
 */
export function changeText(text: string | null, c: Change): { result: "applied"; after: string | null } | { result: "already_applied" } {
  if (c.op === "patch") {
    try {
      return patchText(text, c.path, c.patch ?? "");
    } catch (err) {
      throw new Refused((err as Error).message);
    }
  }
  if (c.op === "delete") return text === null ? { result: "already_applied" } : { result: "applied", after: null };
  const content = withNewline(c.new ?? "");
  if (c.op === "create") {
    if (text === null) return { result: "applied", after: content };
    if (withNewline(text) === content) return { result: "already_applied" };
    throw new Refused(`${c.path}: already exists with other content`);
  }
  if (text === null) throw new Refused(`${c.path}: no such file`);
  const finalNewline = text === "" || text.endsWith("\n");
  text = withNewline(text);
  const old = withNewline(c.old ?? "");
  const hits = lineMatches(text, old);
  if (hits.length === 0) {
    // Already applied: the old text is gone and the new text is there, once.
    if (content !== "" && lineMatches(text, content).length === 1) return { result: "already_applied" };
    throw new Refused(`${c.path}: the old text isn't in the file (as whole lines)`);
  }
  if (hits.length > 1 && !c.all) throw new Refused(`${c.path}: the old text is there ${hits.length} times; add \`· all\` or more context`);
  let out = "";
  let from = 0;
  for (const i of c.all ? hits : hits.slice(0, 1)) {
    if (i < from) continue; // overlapping matches: the earlier one wins
    out += text.slice(from, i) + content;
    from = i + old.length;
  }
  const after = out + text.slice(from);
  return { result: "applied", after: finalNewline ? after : after.replace(/\n$/, "") };
}

/** A file's text as a change sees it (null if there's no file), or why it can't be changed. */
export function currentText(root: string, path: string): string | null {
  const file = target(root, path);
  if (!existsSync(file)) return null;
  if (statSync(file).isDirectory()) throw new Refused(`${path}: a directory, not a file`);
  return readText(path, file).text;
}

export { Refused };

export function applyChange(root: string, c: Change): ChangeResult {
  try {
    const file = target(root, c.path);
    const exists = existsSync(file);
    if (exists && statSync(file).isDirectory()) throw new Refused(`${c.path}: a directory, not a file`);
    const before = exists ? readText(c.path, file) : null;
    const r = changeText(before?.text ?? null, c);
    if (r.result === "already_applied") return r;
    if (r.after === null) unlinkSync(file);
    else if (before)
      writeText(file, r.after, before.eol, c.op === "patch" ? r.after.endsWith("\n") : before.finalNewline, statSync(file).mode & 0o7777);
    else writeText(file, r.after, "\n", c.op === "patch" ? r.after.endsWith("\n") : true);
    return { result: "applied" };
  } catch (err) {
    if (err instanceof Refused) return { result: "failed", message: err.message };
    return { result: "failed", message: `${c.path}: ${(err as Error).message}` };
  }
}
