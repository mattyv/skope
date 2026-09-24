// Static option ids for an ask (docs/design/skill-tests.md): the ids the
// core assigns without running anything, from the program's own AST. Used
// to build derived answers.yaml entries from expect.yaml's `asks`
// (src/runner/deriveAnswers.ts).

import type { Ask, CoreProgram, Section } from "../contracts.gen.js";
import { sectionId } from "../preprocess/slug.js";

type Stmt = Section["body"][number];

/** The ask statement on line `src`, searching every section's body, loops included. */
export function findAsk(program: CoreProgram, src: number): Ask | undefined {
  const inBody = (body: Stmt[]): Ask | undefined => {
    for (const st of body) {
      if ("for_each" in st) {
        const found = inBody(st.for_each.body as Stmt[]);
        if (found) return found;
      } else if ("ask" in st && st.src === src) {
        return st.ask;
      }
    }
    return undefined;
  };
  for (const sec of Object.values(program.sections)) {
    if (!("body" in sec)) continue;
    const found = inBody(sec.body);
    if (found) return found;
  }
  return undefined;
}

/** Every option id `ask` can be answered with, in the core's own order: a section option is its
 * section id, a one-of item its value, yes/no `"yes"`/`"no"`, and a Score level its level id. */
export function askOptionIds(program: CoreProgram, ask: Ask): string[] {
  if (ask.sections) return ask.sections.map((s) => s.section);
  if (ask.yesno) return ["yes", "no"];
  if (ask.score) return ask.score.rubric.map((r) => String(r.level));
  if (ask.one_of) {
    const list = program.sections[ask.one_of.list.section];
    const items = list && "lists" in list ? list.lists.flatMap((l) => l.items) : [];
    return items.filter((i): i is { src: number; value: string } => "value" in i).map((i) => i.value);
  }
  return [];
}

/** The option id an `asks.<key>.chosen` value (a label, item value, yes/no, or Score level) names
 * for `ask`: a section option compares by section id, everything else by the value as written. */
export function chosenOptionId(ask: Ask, chosen: string | number): string {
  return ask.sections ? sectionId(String(chosen)) : String(chosen);
}
