// Semantic lint (SPEC §7.1): core program JSON through the Dafny core's
// SkopCheck. Findings come back ordered by line, then code.

import { toAst } from "./ast.js";
import { gen } from "./core.js";

export type Finding = { code: string; line: number };

const findings = (s: any): Finding[] =>
  [...s].map((e: any) => ({ code: e.dtor_code.toVerbatimString(false), line: e.dtor_src.toNumber() }));

/** Lint errors and warnings. Throws Unsupported on JSON the core program contract doesn't allow. */
export function lint(program: unknown): { errors: Finding[]; warnings: Finding[] } {
  const p = toAst(program);
  const [errors, warnings] = gen.SkopCheck.__default.LintAll(p);
  return { errors: findings(errors), warnings: findings(warnings) };
}
