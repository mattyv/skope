import { isAbsolute } from "node:path";

interface Hunk {
  oldStart: number;
  newStart: number;
  oldLines: string[];
  newLines: string[];
  oldNoNewline: boolean;
  newNoNewline: boolean;
}

export interface FilePatch {
  path: string;
  beforeExists: boolean;
  afterExists: boolean;
  hunks: Hunk[];
  text: string;
}

export function safePatchPath(path: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: reject unsafe filenames
  if (!path || isAbsolute(path) || /[\\\x00-\x1f\x7f]/.test(path) || path.split("/").some((s) => s === ".." || s === ".git" || s === ""))
    throw new Error(`unsafe patch path: ${JSON.stringify(path)}`);
  return path;
}

function header(line: string, prefix: string): string | null {
  let path = line.slice(4).split("\t")[0] as string;
  if (path.startsWith('"')) path = JSON.parse(path) as string;
  if (path === "/dev/null") return null;
  if (!path.startsWith(prefix)) throw new Error(`patch header must use ${prefix} or /dev/null`);
  return safePatchPath(path.slice(2));
}

/** Parse ordinary unified/git text diffs. Unsupported metadata is refused, never ignored. */
export function parsePatch(text: string): FilePatch[] {
  if (text.includes("\0")) throw new Error("binary patches are not supported");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const files: FilePatch[] = [];
  let i = 0;
  while (i < lines.length) {
    // Git's content-only metadata doesn't change what the patch does.
    while (/^(diff --git |index |(?:new|deleted) file mode 100644$)/.test(lines[i] ?? "")) i++;
    const start = i;
    if (!lines[i]?.startsWith("--- ") || !lines[i + 1]?.startsWith("+++ "))
      throw new Error(`expected unified diff headers at line ${i + 1}; binary, rename, and mode changes are not supported`);
    const before = header(lines[i++] as string, "a/");
    const after = header(lines[i++] as string, "b/");
    if (before === null && after === null) throw new Error("a patch must name a file");
    if (before !== null && after !== null && before !== after)
      throw new Error("rename patches are not supported; use a delete and a create");
    const path = before ?? (after as string);
    if (files.some((f) => f.path === path)) throw new Error(`duplicate patch for ${path}`);
    const hunks: Hunk[] = [];
    while (lines[i]?.startsWith("@@ ")) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(lines[i++] as string);
      if (!m) throw new Error(`invalid hunk header in ${path}`);
      const oldCount = Number(m[2] ?? 1);
      const newCount = Number(m[4] ?? 1);
      const oldStart = Number(m[1]);
      const newStart = Number(m[3]);
      if (
        ![oldCount, newCount, oldStart, newStart].every(Number.isSafeInteger) ||
        (oldCount > 0 && oldStart === 0) ||
        (newCount > 0 && newStart === 0)
      )
        throw new Error(`invalid hunk range in ${path}`);
      const h: Hunk = { oldStart, newStart, oldLines: [], newLines: [], oldNoNewline: false, newNoNewline: false };
      let last = "";
      while (h.oldLines.length < oldCount || h.newLines.length < newCount || lines[i] === "\\ No newline at end of file") {
        const line = lines[i++];
        if (line === "\\ No newline at end of file") {
          if (!last) throw new Error(`misplaced newline marker in ${path}`);
          if (last !== "+") h.oldNoNewline = true;
          if (last !== "-") h.newNoNewline = true;
          last = "";
          continue;
        }
        if (line === undefined || ![" ", "+", "-"].includes(line[0] ?? "")) throw new Error(`incomplete hunk in ${path}`);
        last = line[0] as string;
        if (last !== "+") {
          if (h.oldNoNewline) throw new Error(`text after end-of-file marker in ${path}`);
          h.oldLines.push(line.slice(1));
        }
        if (last !== "-") {
          if (h.newNoNewline) throw new Error(`text after end-of-file marker in ${path}`);
          h.newLines.push(line.slice(1));
        }
        if (h.oldLines.length > oldCount || h.newLines.length > newCount) throw new Error(`hunk count mismatch in ${path}`);
      }
      hunks.push(h);
    }
    if (before !== null && after !== null && hunks.length === 0) throw new Error(`patch has no hunks: ${path}`);
    files.push({ path, beforeExists: before !== null, afterExists: after !== null, hunks, text: `${lines.slice(start, i).join("\n")}\n` });
  }
  if (!files.length) throw new Error("the diff contains no file changes");
  return files;
}

/** Exact positions and exact context: no offsets, fuzz, or partial writes. */
function apply(text: string | null, patch: FilePatch, reverse: boolean): string | null {
  const exists = reverse ? patch.afterExists : patch.beforeExists;
  const afterExists = reverse ? patch.beforeExists : patch.afterExists;
  if ((text !== null) !== exists) throw new Error(`${patch.path}: file existence does not match the patch`);
  const lines = text === null || text === "" ? [] : text.replace(/\n$/, "").split("\n");
  const out: string[] = [];
  let position = 0;
  let noNewline = text !== null && text !== "" && !text.endsWith("\n");
  for (const h of patch.hunks) {
    const old = reverse ? h.newLines : h.oldLines;
    const next = reverse ? h.oldLines : h.newLines;
    const oldStart = reverse ? h.newStart : h.oldStart;
    const newStart = reverse ? h.oldStart : h.newStart;
    const at = old.length === 0 ? oldStart : oldStart - 1;
    const newAt = next.length === 0 ? newStart : newStart - 1;
    if (at < position || at > lines.length || at + old.length > lines.length)
      throw new Error(`${patch.path}: hunk position does not match`);
    if (old.some((line, n) => lines[at + n] !== line)) throw new Error(`${patch.path}: hunk context does not match`);
    const oldNoNewline = reverse ? h.newNoNewline : h.oldNoNewline;
    const newNoNewline = reverse ? h.oldNoNewline : h.newNoNewline;
    const touchesEnd = at + old.length === lines.length;
    if (oldNoNewline && !touchesEnd) throw new Error(`${patch.path}: newline marker is not at end of file`);
    if (touchesEnd && old.length && oldNoNewline !== noNewline) throw new Error(`${patch.path}: final newline does not match`);
    out.push(...lines.slice(position, at));
    if (out.length !== newAt) throw new Error(`${patch.path}: new hunk position does not match`);
    out.push(...next);
    if (newNoNewline && !touchesEnd) throw new Error(`${patch.path}: new newline marker is not at end of file`);
    if (touchesEnd) noNewline = newNoNewline;
    position = at + old.length;
  }
  out.push(...lines.slice(position));
  if (!afterExists) {
    if (out.length) throw new Error(`${patch.path}: deletion patch leaves content`);
    return null;
  }
  return out.length ? `${out.join("\n")}${noNewline ? "" : "\n"}` : "";
}

export function patchText(
  text: string | null,
  path: string,
  diff: string,
): { result: "applied"; after: string | null } | { result: "already_applied" } {
  const files = parsePatch(diff);
  const patch = files[0] as FilePatch;
  if (files.length !== 1 || patch.path !== path) throw new Error(`${path}: the diff must contain exactly this file`);
  let forward: string | null | undefined;
  let forwardError: unknown;
  try {
    forward = apply(text, patch, false);
  } catch (err) {
    forwardError = err;
  }
  let reversed = false;
  try {
    const before = apply(text, patch, true);
    reversed = apply(before, patch, false) === text;
  } catch {
    /* not already applied */
  }
  // Insertions can still match their old context after application. Prefer
  // the reverse image for those; deletion-only reverse matches are weaker.
  const grows = patch.hunks.reduce((n, h) => n + h.newLines.length - h.oldLines.length, 0) > 0;
  if (reversed && (forwardError !== undefined || grows)) return { result: "already_applied" };
  if (forwardError !== undefined) throw forwardError;
  return { result: "applied", after: forward ?? null };
}
