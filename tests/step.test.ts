import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { ANSWERS, REASONS } from "../src/step.js";

const dfy = readFileSync(new URL("../core/Step.dfy", import.meta.url), "utf8");
const event = JSON.parse(readFileSync(new URL("../contracts/event.schema.json", import.meta.url), "utf8"));

// Constructor names of a Dafny datatype, e.g. `datatype Reason = A | B(x: int)`.
function ctors(name: string): string[] {
  const m = dfy.match(new RegExp(`datatype ${name}\\s*=([\\s\\S]*?)(?=\\n\\s*\\n|\\n\\s*(?:datatype|predicate|function)\\b)`));
  if (!m) throw new Error(`no datatype ${name} in core/Step.dfy`);
  const body = (m[1] ?? "").replace(/\/\/.*$/gm, "").replace(/\([^()]*\)/g, "");
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
});
