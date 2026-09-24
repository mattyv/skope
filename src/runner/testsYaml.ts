// tests.yaml (docs/design/skill-tests.md, SPEC §7.3): scenarios that don't
// need their own directory under tests/. Beside SKILL.md, it holds optional
// shared `defaults` and a non-empty map of `scenarios`, each the merge of
// those defaults with its own `commands`/`answers` (key by key, the
// scenario's own value winning), plus expect.yaml's fields at its own top
// level, with no `expect:` wrapper.

import { type Expect, expectError } from "./expect.js";

export interface TestsYamlScenario {
  name: string;
  expect: Expect;
  commands: unknown;
  answers?: unknown;
}

export type TestsYamlRow = { scenario: TestsYamlScenario } | { name: string; invalid: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Directory-name rules (SPEC §7.3): non-empty, no `/`, not starting with `.`. */
const validName = (n: string) => n.length > 0 && !n.includes("/") && !n.startsWith(".");

const TOP_KEYS = ["defaults", "scenarios"];
const DEFAULTS_KEYS = ["commands", "answers"];

const scenarioNames = (doc: Obj): string[] => (isObj(doc.scenarios) ? Object.keys(doc.scenarios) : []);

/** Why the document's own shape isn't a valid tests.yaml (everything but each scenario's own
 * content), and the scenario names it names, so a document-level problem can be reported against
 * each of them rather than just once, when they're known. */
function shapeError(doc: unknown): { why: string; names: string[] } | null {
  if (!isObj(doc)) return { why: "the file must be a mapping", names: [] };
  const extra = Object.keys(doc).find((k) => !TOP_KEYS.includes(k));
  if (extra !== undefined) return { why: `unknown key ${extra}`, names: scenarioNames(doc) };
  if (!("scenarios" in doc)) return { why: "scenarios is required", names: [] };
  if (!isObj(doc.scenarios) || Object.keys(doc.scenarios).length === 0) return { why: "scenarios must be a non-empty mapping", names: [] };
  const names = scenarioNames(doc);
  if ("defaults" in doc) {
    if (!isObj(doc.defaults)) return { why: "defaults must be a mapping", names };
    const dExtra = Object.keys(doc.defaults).find((k) => !DEFAULTS_KEYS.includes(k));
    if (dExtra !== undefined) return { why: `unknown key defaults.${dExtra}`, names };
    for (const k of DEFAULTS_KEYS)
      if (k in doc.defaults && !isObj((doc.defaults as Obj)[k])) return { why: `defaults.${k} must be a mapping`, names };
  }
  return null;
}

function readScenario(
  name: string,
  raw: unknown,
  defaults: { commands?: Obj; answers?: Obj },
  folderNames: ReadonlySet<string>,
): TestsYamlRow {
  if (!validName(name)) return { name, invalid: "a scenario name must not be empty, contain /, or start with ." };
  if (folderNames.has(name)) return { name, invalid: `tests/${name} is also a folder scenario; rename one` };
  if (!isObj(raw)) return { name, invalid: "a scenario must be a mapping" };
  const { commands, answers, ...rest } = raw;
  if (commands !== undefined && !isObj(commands)) return { name, invalid: "commands must be a mapping" };
  if (answers !== undefined && !isObj(answers)) return { name, invalid: "answers must be a mapping" };
  const why = expectError(rest);
  if (why !== null) return { name, invalid: why };
  const hasAnswers = defaults.answers !== undefined || answers !== undefined;
  return {
    scenario: {
      name,
      expect: rest as Expect,
      commands: { ...defaults.commands, ...(commands as Obj | undefined) },
      answers: hasAnswers ? { ...defaults.answers, ...(answers as Obj | undefined) } : undefined,
    },
  };
}

/** Every scenario a parsed tests.yaml document defines, merged with its defaults, or why each one
 * can't be used. `folderNames` are the tests/ folder scenarios already found next to it: a
 * tests.yaml scenario with the same name is invalid rather than silently picked over. */
export function readTestsYaml(doc: unknown, folderNames: ReadonlySet<string>): TestsYamlRow[] {
  const bad = shapeError(doc);
  if (bad !== null) {
    // Nothing can be told apart from the document alone: one invalid entry stands for it all.
    if (bad.names.length === 0) return [{ name: "tests.yaml", invalid: bad.why }];
    return bad.names.map((name) => ({ name, invalid: bad.why }));
  }
  const d = doc as Obj;
  const defaults = (d.defaults ?? {}) as { commands?: Obj; answers?: Obj };
  const scenarios = d.scenarios as Record<string, unknown>;
  return Object.entries(scenarios).map(([name, raw]) => readScenario(name, raw, defaults, folderNames));
}
