// Stable fake keys (docs/design/skill-tests.md): `Section.var` and
// `Section.ask` name a statement by its section and what it binds, so
// inserting a line doesn't move them the way it moves `line:N`. Before a
// run, each stable key is rewritten to the `line:N` key of the one
// statement it names, and the fake handlers look it up as before.
//
// Which key wins when several match one statement: a stable key, then
// `line:N`, then the exact text, as before. A stable key must name exactly
// one statement (E-FAKE-AMBIGUOUS otherwise), and a stable or `line:N` key
// that names none is reported as unused (W-FAKE-UNUSED). An exact-text key
// can't be checked before the run: its text is only known after
// interpolation.

import type { CoreProgram, Section } from "../contracts.gen.js";
import { sectionId } from "../preprocess/slug.js";

type Stmt = Section["body"][number];
export type FakeKind = "commands" | "answers";

export interface FakeKeyIssue {
  code: "W-FAKE-UNUSED" | "E-FAKE-UNUSED" | "E-FAKE-AMBIGUOUS";
  key: string;
  message: string;
}

// The section part reads like a heading: it starts with a letter or digit and has no `/`, so a
// script path such as `./fix.sh` or `bin/fix.sh` is never a stable key.
const STABLE = /^([\p{L}\p{N}][^/]*)\.([a-z_][a-z0-9_]*)$/u;

/** A statement the fake file can answer: its line and what a stable key can call it. */
interface Target {
  src: number;
  /** The variable it binds, if any. */
  binds?: string;
  ask: boolean;
  /** What an exact-text key for it could be: its command or question with any value for each variable. */
  text?: RegExp;
}

type Parts = { lit?: string; var?: string }[];
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A pattern for the text `parts` can interpolate to: literals as written, a variable as anything. */
const template = (parts: unknown): RegExp | undefined =>
  Array.isArray(parts)
    ? new RegExp(`^${(parts as Parts).map((p) => (typeof p.lit === "string" ? escapeRegExp(p.lit) : "[\\s\\S]*")).join("")}$`)
    : undefined;
// `do step` runs an action item's command: any of them could be the text.
const ANY = /[\s\S]*/;

/** The statements in a body, loops included, that `kind`'s fake handler answers. */
function targets(body: Stmt[], kind: FakeKind): Target[] {
  return body.flatMap((st): Target[] => {
    if ("for_each" in st) return targets(st.for_each.body as Stmt[], kind);
    if (kind === "answers") {
      if (!("ask" in st)) return [];
      const a = st.ask;
      return [{ src: st.src, binds: a.yesno?.as ?? a.one_of?.as ?? a.score?.as, ask: true, text: template(a.question) }];
    }
    const cmd = (body: unknown) => {
      const b = body as { cmd?: unknown; item?: string } | undefined;
      return b?.item !== undefined ? ANY : template(b?.cmd);
    };
    if ("run" in st) return [{ src: st.src, binds: st.run.as, ask: false, text: cmd(st.run) }];
    if ("do" in st) return [{ src: st.src, ask: false, text: cmd(st.do) }];
    if ("if_yes" in st) return [{ src: st.src, ask: false, text: cmd(st.if_yes.run ?? st.if_yes.do) }];
    if ("check" in st && "succeeds" in st.check.cond) return [{ src: st.src, ask: false, text: template(st.check.cond.succeeds) }];
    return [];
  });
}

/**
 * The fake file with every stable key rewritten to `line:N`, and what's
 * wrong with its keys. A stable key replaces a `line:N` key for the same
 * statement. A key whose section part names no section isn't a stable key:
 * it stays an exact-text key. One that names a section but nothing in it
 * stays an exact-text key too, with a warning: a command like `fix.sh` in a
 * skill with a `## Fix` section has the same shape. Under --test that's an
 * error unless some command or question could interpolate to the key. `.ask` means the
 * section's ask only in answer files; in command files it's a variable
 * named `ask`.
 */
export function resolveFakeKeys<T extends Record<string, unknown>>(
  program: CoreProgram,
  doc: T,
  kind: FakeKind,
  /** `--test`: an unused key is an error, and so are two keys for one statement. */
  strict = false,
): { doc: T; issues: FakeKeyIssue[] } {
  const unused = strict ? "E-FAKE-UNUSED" : "W-FAKE-UNUSED";
  const bySection = new Map<string, Target[]>();
  for (const [id, s] of Object.entries(program.sections)) if ("body" in s) bySection.set(id, targets(s.body, kind));
  const all = [...bySection.values()].flat();
  const lines = new Set(all.map((t) => t.src));
  // A `do step` could run any action item, so their commands are what its text can be.
  const actions = Object.values(program.sections).flatMap((sec) =>
    "lists" in sec ? sec.lists.flatMap((l) => l.items.flatMap((i) => ("action" in i ? [template(i.action.cmd)] : []))) : [],
  );
  const texts = [...all.map((t) => t.text), ...actions].filter((r): r is RegExp => r !== undefined && r !== ANY);
  const couldBeText = (key: string) => texts.some((r) => r.test(key));

  const issues: FakeKeyIssue[] = [];
  const out: Record<string, unknown> = {};
  const stable: [string, string][] = [];
  for (const [key, value] of Object.entries(doc)) {
    const line = /^line:(\d+)$/.exec(key);
    if (line) {
      if (!lines.has(Number(line[1])))
        issues.push({ code: unused, key, message: `${kind} key ${key}: no statement on line ${line[1]} uses it` });
      out[key] = value;
      continue;
    }
    const m = STABLE.exec(key);
    const found = m ? bySection.get(sectionId(m[1] as string)) : undefined;
    if (!m || !found) {
      out[key] = value;
      continue;
    }
    const name = m[2] as string;
    const asks = name === "ask" && kind === "answers";
    const hits = found.filter((t) => (asks ? t.ask : t.binds === name));
    const what = asks ? "asks" : `statements that bind ${name}`;
    if (hits.length === 0) {
      issues.push({
        // Under --test, still only a warning when it is some statement's exact text.
        code: couldBeText(key) ? "W-FAKE-UNUSED" : unused,
        key,
        message: `${kind} key ${key}: section ${m[1]} has no ${what}; it's still matched as exact text`,
      });
      out[key] = value;
    } else if (hits.length > 1)
      issues.push({
        code: "E-FAKE-AMBIGUOUS",
        key,
        message: `${kind} key ${key}: section ${m[1]} has ${hits.length} ${what} (lines ${hits.map((t) => t.src).join(", ")}); key them by line:N or text`,
      });
    else stable.push([`line:${(hits[0] as Target).src}`, key]);
  }
  // Stable keys go last, so they win over a line:N key for the same statement.
  for (const [lineKey, key] of stable) {
    if (strict && Object.hasOwn(out, lineKey))
      issues.push({
        code: "E-FAKE-AMBIGUOUS",
        key,
        message: `${kind} key ${key} names line ${lineKey.slice(5)}, which another key also answers; under --test each statement takes one key`,
      });
    out[lineKey] = doc[key];
  }
  return { doc: out as T, issues };
}

/** The line of the ask an `asks` key (docs/design/skill-tests.md) names: `Section` (its only ask)
 * or `Section.var` (the ask that binds var), or null if it doesn't name exactly one. */
export function askLine(program: CoreProgram, key: string): number | null {
  for (const k of [key, `${key}.ask`]) {
    const { doc, issues } = resolveFakeKeys(program, { [k]: true }, "answers", true);
    const lineKey = Object.keys(doc).find((d) => /^line:\d+$/.test(d));
    if (lineKey && issues.length === 0) return Number(lineKey.slice(5));
  }
  return null;
}

/** The pattern an answers.yaml key would need to match to answer the ask on line `src` by its
 * exact text, or undefined if there's no ask there. Used to tell whether an existing literal key
 * already answers an ask a derived answer (src/runner/deriveAnswers.ts) would otherwise add. */
export function answerTemplate(program: CoreProgram, src: number): RegExp | undefined {
  for (const s of Object.values(program.sections)) {
    if (!("body" in s)) continue;
    const found = targets(s.body, "answers").find((t) => t.src === src);
    if (found) return found.text;
  }
  return undefined;
}

/** The line of the one statement a fake key names: a `line:N` key, a stable key, or exact text
 * only one statement's command or question could be. Null when it names none or several. Lets a
 * tests.yaml scenario override a default written with a different kind of key. */
export function keyLine(program: CoreProgram, key: string, kind: FakeKind): number | null {
  const line = /^line:(\d+)$/.exec(key);
  if (line) return Number(line[1]);
  const { doc } = resolveFakeKeys(program, { [key]: true }, kind, false);
  const lineKey = Object.keys(doc).find((d) => /^line:\d+$/.test(d));
  if (lineKey) return Number(lineKey.slice(5));
  const hits = Object.values(program.sections)
    .flatMap((s) => ("body" in s ? targets(s.body, kind) : []))
    .filter((t) => t.text?.test(key));
  return hits.length === 1 ? (hits[0] as Target).src : null;
}
