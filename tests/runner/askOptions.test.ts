// Static option ids for an ask (docs/design/skill-tests.md): what derived
// answers (src/runner/deriveAnswers.ts) score, matching what the core hands
// out as `ask` event option ids.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { CoreProgram } from "../../src/contracts.gen.js";
import { preprocess } from "../../src/preprocess/index.js";
import { askOptionIds, asksError, chosenOptionId, findAsk } from "../../src/runner/askOptions.js";
import { askLine } from "../../src/runner/fakeKeys.js";
import { ROOT } from "../acceptance/lib/scenarios.js";

function program(md: string): CoreProgram {
  const r = preprocess(md);
  if (!("program" in r)) throw new Error(JSON.stringify(r.errors));
  return r.program;
}
const diskFull = program(readFileSync(`${ROOT}/fixtures/disk-full/SKILL.md`, "utf8"));

const askOn = (p: CoreProgram, key: string) => {
  const line = askLine(p, key);
  if (line === null) throw new Error(`${key} doesn't name an ask`);
  const ask = findAsk(p, line);
  if (!ask) throw new Error(`no ask on line ${line}`);
  return ask;
};

describe("findAsk", () => {
  test("the ask statement on the line an asks key names", () => {
    const ask = findAsk(diskFull, askLine(diskFull, "Triage") as number);
    expect(ask?.sections?.length).toBe(4);
  });

  test("undefined for a line with no ask", () => {
    expect(findAsk(diskFull, 999999)).toBeUndefined();
  });

  test("finds an ask nested in a for each loop", () => {
    expect(findAsk(diskFull, askLine(diskFull, "Clean up") as number)).toBeDefined();
  });
});

describe("askOptionIds", () => {
  test("a section-options ask: each option's section id", () => {
    expect(askOptionIds(diskFull, askOn(diskFull, "Triage"))).toEqual(["s:clean_up", "s:restart", "s:page", "s:investigate"]);
  });

  test("a one-of ask: each list item's value", () => {
    expect(askOptionIds(diskFull, askOn(diskFull, "Restart.service"))).toEqual(["nginx", "rsyslog", "myapp-worker", "myapp-api"]);
  });

  test("a yes/no ask: yes and no", () => {
    expect(askOptionIds(diskFull, askOn(diskFull, "Clean up"))).toEqual(["yes", "no"]);
  });
});

describe("chosenOptionId", () => {
  test("a section option: the label's section id", () => {
    expect(chosenOptionId(askOn(diskFull, "Triage"), "Restart")).toBe("s:restart");
  });

  test("a one-of item: the value as written", () => {
    expect(chosenOptionId(askOn(diskFull, "Restart.service"), "myapp-worker")).toBe("myapp-worker");
  });

  test("a yes/no answer: as written", () => {
    expect(chosenOptionId(askOn(diskFull, "Clean up"), "yes")).toBe("yes");
  });
});

describe("asksError", () => {
  test("names the first asks entry whose chosen isn't an option, with the options", () => {
    expect(asksError(diskFull, { Triage: { chosen: "Restart" }, "Restart.service": { chosen: "myapp-worker" } })).toBeNull();
    expect(asksError(diskFull, { "Restart.service": { chosen: "myapp" } })).toBe(
      "asks.Restart.service.chosen: myapp isn't an option; the options are nginx, rsyslog, myapp-worker, myapp-api",
    );
  });

  test("an asks key that names no single ask is reported", () => {
    expect(asksError(diskFull, { Nowhere: { chosen: "x" } })).toBe("asks.Nowhere doesn't name exactly one ask");
  });
});
