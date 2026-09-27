// Contracts (PLAN.md §3): every example validates, and the schema rejects
// malformed programs, so it can't pass by accepting everything.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
// @ts-expect-error: a plain .mjs build script with no type declarations
import { generate } from "../scripts/gen-types.mjs";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020").default;
const read = (p: string) => JSON.parse(readFileSync(new URL(`../contracts/${p}`, import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
for (const f of ["core-program", "ask", "fakes", "event"]) ajv.addSchema(read(`${f}.schema.json`));
const schema = (f: string, def = "") => {
  const v = ajv.getSchema(`https://github.com/mattyv/skope/contracts/${f}.schema.json${def}`);
  if (!v) throw new Error(`no schema ${f}${def}`);
  return v;
};
const validate = schema("core-program");

// Shared by every describe block that needs to break the disk-full example in one way.
const base = () => read("examples/disk-full.core.json");
const triage = (p: any) => p.sections["s:triage"].body;

describe("core program schema (SPEC §5.1)", () => {
  for (const name of ["disk-full", "cert-expiry", "error-triage"]) {
    test(`${name} example is valid`, () => {
      expect(validate(read(`examples/${name}.core.json`)), JSON.stringify(validate.errors)).toBe(true);
    });
  }

  test("a prose-only section, with no lists, is valid", () => {
    const p = read("examples/disk-full.core.json");
    p.sections["s:background"] = { name: "Background", src: 90, lists: [] };
    expect(validate(p), JSON.stringify(validate.errors)).toBe(true);
  });

  // Each case breaks the disk-full example in one way.
  const broken: [string, (p: any) => void][] = [
    ["an unknown statement", (p) => triage(p).push({ src: 99, frobnicate: {} })],
    ["an ask with two forms", (p) => (triage(p)[4].ask.yesno = { as: "_yn" })],
    ["an ask with no form", (p) => delete triage(p)[4].ask.sections],
    ["a section id without the s: prefix", (p) => (p.entry.section = "triage")],
    ["an id that isn't a slug", (p) => (p.entry.section = "s:Triage")],
    ["a list reference as a bare id", (p) => (p.sections["s:clean_up"].body[0].for_each.list = "s:cleanups")],
    ["a check with neither a target nor an else", (p) => (triage(p)[1].check.then = null)],
    [
      "an if_yes run with a binding",
      (p) => (p.sections["s:clean_up"].body[0].for_each.body[1].if_yes = { run: { cmd: [], as: "x" }, else: null }),
    ],
    ["a param without its line", (p) => delete p.params.mount.src],
    ["a section with both a body and lists", (p) => (p.sections["s:triage"].lists = [])],
    ["an if_yes with both run and do", (p) => (p.sections["s:clean_up"].body[0].for_each.body[1].if_yes.run = { cmd: [] })],
    ["a run with no else", (p) => delete triage(p)[0].else],
    ["a src of zero", (p) => (triage(p)[0].src = 0)],
    ["a percent sign left on a number", (p) => (triage(p)[1].check.cond.cmp.r = { num: "85%" })],
    ["a sure above 100", (p) => (triage(p)[4].ask.sure = 101)],
    ["a format other than 1", (p) => (p.format = 2)],
    // Mutation-testing regression cases (skope-h review): each of these pins a rule a broader
    // schema would still satisfy, so it only fails if that rule is loosened.
    ["a skill name with an uppercase letter", (p) => (p.skill = "Disk-Full")],
    ["a run_timeout_ms of zero", (p) => (p.limits.run_timeout_ms = 0)],
    ["a param name that isn't a valid identifier", (p) => (p.params["1bad"] = { str: "x", src: 1 })],
    ["a src that isn't an integer", (p) => (triage(p)[0].src = 23.5)],
    ["a for_each list reference that isn't a slug", (p) => (p.sections["s:clean_up"].body[0].for_each.list = { section: "s:Not_Valid!" })],
    ["a lit part with an extra property", (p) => (triage(p)[0].run.cmd[0] = { lit: "df --output=pcent ", extra: true })],
    ["a sure below zero", (p) => (triage(p)[4].ask.sure = -1)],
    ["an if_yes with neither run nor do", (p) => (p.sections["s:clean_up"].body[0].for_each.body[1].if_yes = { else: null })],
    ["a hand_off with extra properties", (p) => (p.sections["s:investigate"].body[0].hand_off = { extra: 1 })],
    ["a skip with extra properties", (p) => (triage(p)[3].else = { skip: { extra: 1 } })],
    ["an unknown top-level key", (p) => (p.bogus = 1)],
  ];
  for (const [what, breakIt] of broken) {
    test(`rejects ${what}`, () => {
      const p = base();
      breakIt(p);
      expect(validate(p)).toBe(false);
    });
  }
});

describe("the standalone stop statement (SPEC §4.x)", () => {
  const stmtStop = schema("core-program", "#/$defs/stmtStop");

  test("a bare stop statement is valid", () => {
    expect(stmtStop({ src: 1, stop: {} }), JSON.stringify(stmtStop.errors)).toBe(true);
  });

  test("rejects a stop with extra properties", () => {
    expect(stmtStop({ src: 1, stop: { extra: 1 } })).toBe(false);
  });
});

describe("error-code contract (SPEC §7.1)", () => {
  test("every code has a stage and a meaning", () => {
    const codes: { code: string; stage: string; meaning: string }[] = read("error-codes.json");
    expect(codes.length).toBeGreaterThan(40);
    for (const c of codes) {
      expect(c.code).toMatch(/^[EW]-[A-Z-]+$/);
      expect(["parse", "lint", "args", "runtime", "warning"]).toContain(c.stage);
      expect(c.meaning.length).toBeGreaterThan(0);
    }
  });
});

describe("backend request and answer (SPEC §6.1)", () => {
  const request = schema("ask", "#/$defs/request");
  const answer = schema("ask", "#/$defs/answer");
  const output = schema("ask", "#/$defs/output");
  const req = {
    kind: "choice",
    question: "Given `used`, what's the best next step?",
    guidance: null,
    options: [
      { id: "s:clean_up", label: "Clean up", description: "Run cleanups least risky first." },
      { id: "s:page", label: "Page", description: null },
    ],
    context: { used: "91%" },
    timeout_ms: 2000,
  };

  test("the spec's request and answer shapes are valid", () => {
    expect(request(req)).toBe(true);
    expect(answer({ probs: { "s:clean_up": 0.82, "s:page": 0.18 }, backend: "jev", model: "jev-1.13.0", ms: 94 })).toBe(true);
    expect(answer({ probs: { A: 0.5 }, unassigned: 0.3, backend: "openrouter", model: "m", ms: 3 })).toBe(true);
  });

  test("an out-of-range answer still fits the contract, so the core can reject it (P5)", () => {
    expect(answer({ probs: { yes: 1.1, no: -0.1 }, backend: "jev", model: "m", ms: 1 })).toBe(true);
  });

  test("skope-ask prints an answer or a failure, never both", () => {
    expect(output({ error: "request_too_large", detail: "413 from jev", backend: "jev", model: "jev-1.13.0" })).toBe(true);
    expect(output({ probs: { yes: 1, no: 0 }, backend: "jev", model: "m", ms: 1 })).toBe(true);
    expect(output({ error: "timeout", detail: "", backend: "jev" })).toBe(false);
    expect(output({ probs: { yes: 1 }, backend: "jev", model: "m", ms: 1, error: "unavailable", detail: "" })).toBe(false);
  });

  test("malformed shapes are rejected", () => {
    expect(request({ ...req, kind: "multi" })).toBe(false);
    expect(request({ ...req, options: [req.options[0]] })).toBe(false);
    expect(request({ ...req, context: { used: 91 } })).toBe(false);
    expect(answer({ probs: { yes: "high" }, backend: "jev", model: "m", ms: 1 })).toBe(false);
    expect(answer({ probs: {}, backend: "jev", model: "m" })).toBe(false);
  });

  test("rejects a zero timeout_ms on the request", () => {
    expect(request({ ...req, timeout_ms: 0 })).toBe(false);
  });

  test("rejects a negative ms on the answer", () => {
    expect(answer({ probs: { yes: 1 }, backend: "jev", model: "m", ms: -1 })).toBe(false);
  });

  test("rejects an unknown property on the request", () => {
    expect(request({ ...req, bogus: 1 })).toBe(false);
  });
});

describe("fake files (SPEC §5.4, §6.2)", () => {
  const answers = schema("fakes", "#/$defs/answers");
  const commands = schema("fakes", "#/$defs/commands");

  test("valid answers and commands", () => {
    expect(answers({ "line:27": { "s:clean_up": 0.9, "s:page": 0.1 }, "Is it worth it?": "unsure", "line:46": "unavailable" })).toBe(true);
    expect(commands({ "df -h": { exit: 0, stdout: "91%" }, "line:47": { exit: null, timed_out: true, ms: 30000 } })).toBe(true);
    expect(
      commands({
        "df -h": [
          { exit: 0, stdout: "91%" },
          { exit: 0, stdout: "78%" },
        ],
      }),
    ).toBe(true);
  });

  test("malformed fakes are rejected", () => {
    expect(answers({ q: "maybe" })).toBe(false);
    expect(answers({ q: "invalid" })).toBe(false);
    expect(commands({ "df -h": [] })).toBe(false);
    expect(answers({ q: {} })).toBe(false);
    expect(commands({ "df -h": { stdout: "91%" } })).toBe(false);
    expect(commands({ "df -h": { exit: 0, colour: "red" } })).toBe(false);
  });

  test("rejects an empty key", () => {
    expect(commands({ "": { exit: 0 } })).toBe(false);
    expect(answers({ "": "unsure" })).toBe(false);
  });

  test("rejects a non-boolean timed_out", () => {
    expect(commands({ "df -h": { exit: 0, timed_out: "yes" } })).toBe(false);
  });
});

describe("log events (SPEC §10)", () => {
  const event = schema("event");
  const base = { ts: "2026-09-23T10:00:00Z", run_id: "r-1", skill: "disk-full", skill_hash: `sha256:${"a".repeat(64)}`, host: "h" };

  test("valid events", () => {
    expect(event({ ...base, event: "would_do", section: "Clean up", line: 38, cmd: "apt-get clean" })).toBe(true);
    expect(event({ ...base, event: "effect_end", cmd: "x", exit: null, ms: 30000, timed_out: true })).toBe(true);
    expect(event({ ...base, event: "error", code: "E-TAINT", stage: "lint", file: "SKILL.md", line: 14, message: "…" })).toBe(true);
  });

  test("unknown events, missing fields and stray fields are rejected", () => {
    expect(event({ ...base, event: "ran", cmd: "x" })).toBe(false);
    expect(event({ ...base, event: "effect_end", cmd: "x" })).toBe(false);
    expect(event({ ...base, event: "would_do", cmd: "x", bogus: 1 })).toBe(false);
    expect(event({ ...base, event: "error", code: "W-NOPE", stage: "lint", message: "m" })).toBe(false);
    expect(event({ ...base, ts: "yesterday", event: "would_do", cmd: "x" })).toBe(false);
    expect(event({ ...base, event: "warning", code: "W-SECTION-UNREACHED", stage: "warning", message: "m" })).toBe(false);
    expect(
      event({
        ...base,
        event: "run_start",
        params: {},
        dry_run: true,
        caller: "person",
        run_dir: "d",
        skope_version: "0.1.0",
        skope_build: `sha256:${"a".repeat(64)}`,
      }),
    ).toBe(false);
    const end = { ...base, event: "outcome", outcome: "handoff", ask_calls: 0, effects: 0, dry_run: true };
    expect(event({ ...end, reason: "gave_up" })).toBe(false);
    expect(event({ ...end, reason: "gate_failed" })).toBe(true);
  });

  const examples = readFileSync(new URL("../contracts/examples/events.jsonl", import.meta.url), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

  test("every example in contracts/examples/events.jsonl is valid", () => {
    for (const e of examples) expect(event(e), JSON.stringify(e)).toBe(true);
  });

  test("the examples cover every event kind in the schema", () => {
    const kinds = read("event.schema.json").oneOf.map((r: { $ref: string }) => r.$ref.split("/").pop());
    expect(new Set(examples.map((e) => e.event))).toEqual(new Set(kinds));
  });

  // Mutation-testing regression cases (skope-h review): each pins a rule a looser schema would
  // still satisfy.
  test("rejects a skill_hash that isn't 64 lowercase hex digits", () => {
    expect(event({ ...base, skill_hash: "sha256:zz", event: "would_do", cmd: "x" })).toBe(false);
  });

  test("an error's stage can't be 'warning' (that's the warning event's business)", () => {
    expect(event({ ...base, event: "error", code: "E-TAINT", stage: "warning", message: "m" })).toBe(false);
  });

  test("stdout_tail over 2048 chars is rejected, for run and check_cmd", () => {
    const long = "x".repeat(2049);
    const runFields = {
      cmd: "x",
      exit: 0,
      ms: 1,
      timed_out: false,
      truncated: false,
      stdout_hash: `sha256:${"a".repeat(64)}`,
      after_would_do: false,
    };
    expect(event({ ...base, event: "run", ...runFields, stdout_tail: long })).toBe(false);
    expect(event({ ...base, event: "check_cmd", ...runFields, stdout_tail: long })).toBe(false);
  });

  test("an outcome with an unknown reason", () => {
    expect(event({ ...base, event: "outcome", outcome: "handoff", reason: "gave_up", ask_calls: 0, effects: 0, dry_run: true })).toBe(
      false,
    );
  });

  test("an outcome with an unknown outcome value is rejected", () => {
    expect(event({ ...base, event: "outcome", outcome: "bogus", reason: null, ask_calls: 0, effects: 0, dry_run: null })).toBe(false);
  });

  describe("every required field, for every event kind, is enforced", () => {
    const eventSchema = read("event.schema.json");
    const kinds: string[] = eventSchema.oneOf.map((r: { $ref: string }) => r.$ref.split("/").pop());
    for (const kind of kinds) {
      const def = eventSchema.$defs[kind];
      const sample = examples.find((e) => e.event === kind);
      if (!sample) throw new Error(`no example in events.jsonl for event kind ${kind}`);
      for (const field of def.required as string[]) {
        test(`${kind} rejects a missing ${field}`, () => {
          const e = { ...sample };
          delete e[field];
          expect(event(e), `${kind} without ${field} should be rejected`).toBe(false);
        });
      }
    }
  });
});

describe("generated TypeScript types", () => {
  test("src/contracts.gen.ts is up to date with the schemas (run: node scripts/gen-types.mjs)", async () => {
    const committed = readFileSync(new URL("../src/contracts.gen.ts", import.meta.url), "utf8");
    expect(committed).toBe(await generate());
  });
});
