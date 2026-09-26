// Cross-checks the core program examples in contracts/examples/ against the SKILL.md they were
// compiled from: every statement's `src` line must actually contain the text that statement
// claims to be. This catches an example that's schema-valid but no longer matches its source
// (e.g. a `src` that drifted, or a number silently edited in the JSON but not the Markdown).

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const read = (p: string) => JSON.parse(readFileSync(new URL(`../contracts/${p}`, import.meta.url), "utf8"));
const readSkill = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").split("\n");

type Part = { lit: string } | { var: string };

// Renders `parts` the way the source Markdown would show a variable: `{name}`.
const partsText = (parts: Part[]): string => parts.map((p) => ("lit" in p ? p.lit : `{${p.var}}`)).join("");

const cases: { name: string; core: string; skill: string }[] = [
  { name: "disk-full", core: "examples/disk-full.core.json", skill: "fixtures/disk-full/SKILL.md" },
  { name: "cert-expiry", core: "examples/cert-expiry.core.json", skill: "fixtures/cert-expiry/SKILL.md" },
  { name: "error-triage", core: "examples/error-triage.core.json", skill: "fixtures/error-triage/SKILL.md" },
];

for (const { name, core, skill } of cases) {
  describe(`${name}: contracts/${core} matches ${skill}`, () => {
    const program = read(core);
    const lines = readSkill(skill);
    const sections = program.sections;

    // Collects one assertion per statement/heading/item. `atStart` means the line must *start*
    // with `text` (params); otherwise `text` just has to appear somewhere on the line.
    const checks: { what: string; src: number; text: string; atStart: boolean }[] = [];
    const add = (what: string, src: number, text: string, atStart = false) => checks.push({ what, src, text, atStart });

    function walkStmt(s: any, ctx: string) {
      if (s.run) {
        add(`${ctx} run`, s.src, partsText(s.run.cmd));
      } else if (s.do) {
        if (s.do.cmd) add(`${ctx} do`, s.src, partsText(s.do.cmd));
        else if (s.do.item) add(`${ctx} do item`, s.src, s.do.item);
      } else if (s.check) {
        const cond = s.check.cond;
        if (cond.succeeds) add(`${ctx} check succeeds`, s.src, partsText(cond.succeeds));
        // cond.cmp (a `{var} OP {var}` comparison) isn't checked: rendering the operator back
        // into Markdown text isn't worth the complexity for what it would catch.
      } else if (s.ask) {
        add(`${ctx} ask question`, s.src, partsText(s.ask.question));
        add(`${ctx} ask sure`, s.src, `sure ${s.ask.sure}%`);
        if (s.ask.sections) {
          for (const opt of s.ask.sections) add(`${ctx} ask option`, opt.src, `[${sections[opt.section].name}]`);
        }
      } else if (s.for_each) {
        for (const b of s.for_each.body) walkStmt(b, `${ctx} for_each`);
      } else if (s.if_yes) {
        if (s.if_yes.run) add(`${ctx} if_yes run`, s.src, partsText(s.if_yes.run.cmd));
        if (s.if_yes.do) {
          if (s.if_yes.do.cmd) add(`${ctx} if_yes do`, s.src, partsText(s.if_yes.do.cmd));
          else if (s.if_yes.do.item) add(`${ctx} if_yes do item`, s.src, s.if_yes.do.item);
        }
      } else if (s.page) {
        add(`${ctx} page`, s.src, partsText(s.page));
      }
      // then / stop / hand_off carry no text of their own to check beyond their heading target,
      // which is covered by the section-heading checks below.
    }

    // Section headings, and each section's body or lists.
    for (const [id, section] of Object.entries<any>(sections)) {
      add(`section ${id} heading`, section.src, `## ${section.name}`);
      if (section.body) {
        for (const s of section.body) walkStmt(s, `${id}`);
      }
      if (section.lists) {
        for (const list of section.lists) {
          for (const item of list.items) {
            if ("value" in item) add(`${id} list item`, item.src, item.value);
            else if ("action" in item) {
              add(`${id} list item label`, item.src, item.action.label);
              add(`${id} list item cmd`, item.src, partsText(item.action.cmd));
            }
          }
        }
      }
    }

    // params: `  name:` at the front of its frontmatter line.
    for (const [pname, pval] of Object.entries<any>(program.params)) {
      add(`param ${pname}`, pval.src, `  ${pname}:`, true);
    }

    // entry: its line is the heading of the entry section.
    add("entry", program.entry.src, `## ${sections[program.entry.section].name}`);

    test(`collected ${checks.length} checks`, () => {
      expect(checks.length).toBeGreaterThan(0);
    });

    for (const { what, src, text, atStart } of checks) {
      test(`${what} (line ${src})`, () => {
        const line = lines[src - 1];
        expect(line, `line ${src} doesn't exist in ${skill}`).toBeDefined();
        if (atStart) {
          expect(
            (line ?? "").startsWith(text),
            `expected line ${src} (${JSON.stringify(line)}) to start with ${JSON.stringify(text)}`,
          ).toBe(true);
        } else {
          expect((line ?? "").includes(text), `expected line ${src} (${JSON.stringify(line)}) to contain ${JSON.stringify(text)}`).toBe(
            true,
          );
        }
      });
    }
  });
}
