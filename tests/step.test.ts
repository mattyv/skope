import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { ANSWERS, COMMON_FIELDS, EVENT_FIELDS, REASONS } from "../src/step.js";

const dfy = readFileSync(new URL("../core/Step.dfy", import.meta.url), "utf8");
const event = JSON.parse(readFileSync(new URL("../contracts/event.schema.json", import.meta.url), "utf8"));

// Constructor names of a Dafny datatype, e.g. `datatype Reason = A | B(x: int)`.
function ctors(name: string): string[] {
  const m = dfy.match(new RegExp(`datatype ${name}\\s*=([\\s\\S]*?)(?=\\n\\s*\\n|\\n\\s*(?:datatype|predicate|function)\\b)`));
  if (!m) throw new Error(`no datatype ${name} in core/Step.dfy`);
  let body = (m[1] ?? "").replace(/\/\/.*$/gm, "");
  // Strip argument lists, innermost first, so nested parentheses go too.
  for (let prev = ""; prev !== body; ) [prev, body] = [body, body.replace(/\([^()]*\)/g, "")];
  return body
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

const snake = (s: string) => s.replace(/(?<!^)([A-Z])/g, "_$1").toLowerCase();

describe("core/host interface (SPEC §5.2)", () => {
  test("handoff reasons match in Dafny, TypeScript and the event contract", () => {
    expect(ctors("Reason").map(snake)).toEqual([...REASONS]);
    expect(event.$defs.outcome.properties.reason.enum).toEqual([...REASONS, null]);
  });

  test("every Dafny request and response has a TypeScript counterpart", () => {
    expect(ctors("Next")).toEqual(["Exec", "AskNext", "PageNext", "Choose", "Done"]);
    expect(Object.keys(ANSWERS)).toEqual(["exec", "ask", "page", "choose", "done"]);
    expect(ctors("Response")).toEqual(["NoResponse", "ExecResult", "AskAnswer", "AskFailed", "PageResult", "Picked", "DeadlineExceeded"]);
    expect(ctors("Outcome")).toEqual(["Stopped", "Paged", "Handoff"]);
  });

  test("every event field is filled in by exactly one of the core and the host", () => {
    const shapes = event.oneOf.map((r: { $ref: string }) => event.$defs[r.$ref.split("/").pop() as string]);
    const common = [...COMMON_FIELDS.core, ...COMMON_FIELDS.host, "event"];
    const kinds = shapes.map((s: { properties: { event: { const: string } } }) => s.properties.event.const);
    expect(Object.keys(EVENT_FIELDS).sort()).toEqual([...kinds].sort());
    for (const s of shapes) {
      const kind = s.properties.event.const as string;
      const { core, host } = EVENT_FIELDS[kind] as { core: string[]; host: string[] };
      expect(
        core.filter((f) => host.includes(f)),
        kind,
      ).toEqual([]);
      expect([...common, ...core, ...host].sort(), kind).toEqual(Object.keys(s.properties).sort());
    }
  });

  test("the Dafny core events are the ones the table gives the core", () => {
    const bodies = ctors("EventBody").map((c) => snake(c.replace(/Ev$/, "")));
    const fromCore = Object.entries(EVENT_FIELDS)
      .filter(([, f]) => f.core.length > 0)
      .map(([k]) => k);
    // RunEv and CheckCmdEv, EffectStartEv and so on map one to one; Outcome is `outcome`.
    expect(bodies.sort()).toEqual(fromCore.sort());
  });
});
