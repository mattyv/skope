import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { CoreProgram, Stmt } from "../../src/contracts.gen.js";

export const FRONTMATTER = ["---", "name: test", "description: a test skill", "---", "A skope skill.", "```skope", "format: 1", "```"].join(
  "\n",
);
export const BODY_START = FRONTMATTER.split("\n").length + 1; // 9: first body line

/** Builds a full SKILL.md from body lines (joined with the standard frontmatter). */
export function skillMd(...bodyLines: string[]): string {
  return `${FRONTMATTER}\n${bodyLines.join("\n")}`;
}

// The same validator settings as tests/contracts.test.ts.
const Ajv2020 = createRequire(import.meta.url)("ajv/dist/2020").default;
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const schema = JSON.parse(readFileSync(new URL("../../contracts/core-program.schema.json", import.meta.url), "utf8"));
const validate = ajv.compile(schema);

/** Schema errors for a program, or null when it's valid. */
export function schemaErrors(program: CoreProgram): string | null {
  return validate(program) ? null : JSON.stringify(validate.errors);
}

/** Every statement's src, including those in for-each bodies. */
export function stmtLines(program: CoreProgram): number[] {
  const out: number[] = [];
  const walk = (body: Stmt[]) => {
    for (const s of body) {
      out.push(s.src);
      if ("for_each" in s) walk(s.for_each.body);
    }
  };
  for (const s of Object.values(program.sections)) if ("body" in s) walk(s.body);
  return out;
}
