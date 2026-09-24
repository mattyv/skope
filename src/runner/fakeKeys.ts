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
  code: "W-FAKE-UNUSED" | "E-FAKE-AMBIGUOUS";
  key: string;
  message: string;
}

const STABLE = /^(.+)\.([a-z_][a-z0-9_]*)$/;

/** A statement the fake file can answer: its line and what a stable key can call it. */
interface Target {
  src: number;
  /** The variable it binds, if any. */
  binds?: string;
  ask: boolean;
}

/** The statements in a body, loops included, that `kind`'s fake handler answers. */
function targets(body: Stmt[], kind: FakeKind): Target[] {
  return body.flatMap((st): Target[] => {
    if ("for_each" in st) return targets(st.for_each.body as Stmt[], kind);
    if (kind === "answers") {
      if (!("ask" in st)) return [];
      const a = st.ask;
      return [{ src: st.src, binds: a.yesno?.as ?? a.one_of?.as ?? a.score?.as, ask: true }];
    }
    if ("run" in st) return [{ src: st.src, binds: st.run.as, ask: false }];
    if ("do" in st || "if_yes" in st) return [{ src: st.src, ask: false }];
    if ("check" in st && "succeeds" in st.check.cond) return [{ src: st.src, ask: false }];
    return [];
  });
}

/**
 * The fake file with every stable key rewritten to `line:N`, and what's
 * wrong with its keys. A stable key replaces a `line:N` key for the same
 * statement. A key whose section part names no section isn't a stable key:
 * it stays an exact-text key, since a command like `./fix.sh` has the same
 * shape.
 */
export function resolveFakeKeys<T extends Record<string, unknown>>(
  program: CoreProgram,
  doc: T,
  kind: FakeKind,
): { doc: T; issues: FakeKeyIssue[] } {
  const bySection = new Map<string, Target[]>();
  for (const [id, s] of Object.entries(program.sections)) if ("body" in s) bySection.set(id, targets(s.body, kind));
  const lines = new Set([...bySection.values()].flat().map((t) => t.src));

  const issues: FakeKeyIssue[] = [];
  const out: Record<string, unknown> = {};
  const stable: [string, string][] = [];
  for (const [key, value] of Object.entries(doc)) {
    const line = /^line:(\d+)$/.exec(key);
    if (line) {
      if (!lines.has(Number(line[1])))
        issues.push({ code: "W-FAKE-UNUSED", key, message: `${kind} key ${key}: no statement on line ${line[1]} uses it` });
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
    const hits = found.filter((t) => (name === "ask" ? t.ask : t.binds === name));
    const what = name === "ask" ? "asks" : `statements that bind ${name}`;
    if (hits.length === 0) issues.push({ code: "W-FAKE-UNUSED", key, message: `${kind} key ${key}: section ${m[1]} has no ${what}` });
    else if (hits.length > 1)
      issues.push({
        code: "E-FAKE-AMBIGUOUS",
        key,
        message: `${kind} key ${key}: section ${m[1]} has ${hits.length} ${what} (lines ${hits.map((t) => t.src).join(", ")}); key them by line:N or text`,
      });
    else stable.push([`line:${(hits[0] as Target).src}`, key]);
  }
  // Stable keys go last, so they win over a line:N key for the same statement.
  for (const [lineKey, key] of stable) out[lineKey] = doc[key];
  return { doc: out as T, issues };
}
